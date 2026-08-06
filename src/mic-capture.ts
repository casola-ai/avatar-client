import { ClockMap } from './clock-map';
import {
  encodeMicFrameHeader,
  MIC_FRAME_HEADER_BYTES,
  MIC_FRAME_HEADER_VERSION,
  type MicFrameHeader,
  VIDEO_MEDIA_TIME_UNKNOWN,
} from './mic-frame-header';
import { decodePcmDownlinkFrame } from './pcm-downlink';
import { PcmPlayer } from './pcm-player';

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600;
const PREROLL_FRAMES = 20;

export interface Turn {
  text: string;
  reply: string;
  language?: string;
  speechId?: string;
}

interface TextWaiter {
  resolve: (turn: Turn) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface MicHandlers {
  /** Fired after the microphone socket is open and its hello/preroll frames have been sent. */
  onReady?: () => void;
  onPartial?: (text: string) => void;
  onTurn?: (turn: Turn) => void;
  onError?: (err: unknown) => void;
  onAudioBlocked?: () => void;
  /** Fired once per flushed 100ms frame with the capture-instant calibration for that frame's
   *  first sample (specs/av-sync-timestamps-notes.md section 2/3). Groundwork only for now —
   *  not yet sent over the wire; a later phase builds the header from this and prepends it in
   *  flushFrame(). */
  onFrameTimestamp?: (info: {
    micSeq: number;
    videoMediaTimeMs: number;
    captureEpochMs: number;
  }) => void;
}

function clamp16(x: number): number {
  const v = Math.round(x * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}

/** The section-2 calibration step, extracted as a pure function so it's directly unit-testable
 *  without a real AudioContext/DOM: given a frame's (latency-compensated) capture instant on the
 *  AudioContext clock and the audio-clock calibration built up so far, look up the corresponding
 *  performance.now()-domain instant, then ask `getVideoMediaTimeMs` (typically
 *  MsePlayer.mediaTimeAt) what the avatar video was showing at that same instant. Returns null
 *  only when the audio clock map has no samples yet (never in practice — flushFrame always
 *  records one immediately before calling this). */
export function computeFrameTimestamp(
  frameStartContextTime: number,
  inputLatencySeconds: number,
  audioClockMap: ClockMap,
  getVideoMediaTimeMs: ((performanceTimeMs: number) => number | null) | undefined,
  timeOrigin: number
): { videoMediaTimeMs: number; captureEpochMs: number } | null {
  const performanceTimeMs = audioClockMap.at(frameStartContextTime - inputLatencySeconds);
  if (performanceTimeMs === null) return null;
  const rawVideoMediaTimeMs = getVideoMediaTimeMs?.(performanceTimeMs) ?? null;
  return {
    videoMediaTimeMs:
      rawVideoMediaTimeMs === null ? VIDEO_MEDIA_TIME_UNKNOWN : Math.round(rawVideoMediaTimeMs),
    captureEpochMs: timeOrigin + performanceTimeMs,
  };
}

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private ws: WebSocket | null = null;
  private player: PcmPlayer | null = null;
  private wsReady: Promise<void> | null = null;
  private resolveWsReady: (() => void) | null = null;
  private rejectWsReady: ((error: Error) => void) | null = null;
  private textSequence = 0;
  private readonly textWaiters = new Map<string, TextWaiter>();
  private handlers: MicHandlers = {};
  private inRate = 48000;

  private resTail = new Float32Array(0);
  private resPos = 0;
  private readonly frame = new Int16Array(FRAME_SAMPLES);
  private frameLen = 0;
  private closed = false;
  private muted = false;
  private pcmCallCount = 0;
  // Section-2 calibration state — see computeFrameTimestamp().
  private readonly audioClockMap = new ClockMap();
  private inputLatencySeconds = 0;
  private frameStartContextTime = 0;
  // Named micSeq (not seq/frameSeq) — the server-side tracer already uses frame_seq for an
  // unrelated concept (the video-timeline index); this is just a monotonic per-connection
  // counter over outgoing /mic_stream frames.
  private micSeq = 0;
  private getVideoMediaTimeMs: ((performanceTimeMs: number) => number | null) | undefined;
  // ASR language pin (box language NAMES, e.g. ['English'] or ['Chinese','English']).
  // [] = the box default (auto-detect across its configured set). Mutable mid-session.
  private langs: string[] = [];
  // Preferred REPLY language (BCP-47). undefined = never sent (the box keeps its session
  // default, e.g. the JWT claim); '' = explicit clear. Mutable mid-session.
  private responseLanguage: string | undefined;

  // Returns the live MediaStream so the caller can pass it to start(), avoiding
  // a second getUserMedia call (which causes a second permission prompt on Firefox).
  static async ensurePermission(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('mediaDevices unavailable');
      err.name = 'NotSupportedError';
      throw err;
    }
    // echoCancellation MUST stay ON (desktop + mobile): the browser/OS hardware AEC cancels the
    // avatar's speaker output at the acoustic source — the dominant echo path, and the only one that
    // works without headphones. Any box-side server AEC is a backstop, not a replacement. Do NOT set
    // false. noiseSuppression/autoGainControl stay OFF (AGC pumps mic levels and hurts ASR).
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  }

  async start(
    wsUrl: string,
    lang: string,
    handlers: MicHandlers = {},
    workletUrl = '/mic-worklet.js',
    stream?: MediaStream,
    dev = false,
    langs: string[] = [],
    responseLanguage?: string,
    // Typically MsePlayer.mediaTimeAt — kept as a plain function (not an MsePlayer reference) so
    // MicCapture stays decoupled/testable. undefined = no video calibration source wired up;
    // computeFrameTimestamp() then reports the wire's VIDEO_MEDIA_TIME_UNKNOWN sentinel.
    getVideoMediaTimeMs?: (performanceTimeMs: number) => number | null
  ): Promise<void> {
    this.handlers = handlers;
    this.langs = langs;
    this.responseLanguage = responseLanguage;
    this.getVideoMediaTimeMs = getVideoMediaTimeMs;
    // Reuse the pre-fetched stream from ensurePermission() to avoid a second
    // getUserMedia call (and second permission prompt on Firefox).
    if (stream) {
      this.stream = stream;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    }

    // Match AudioContext sample rate to the capture track's native rate so
    // createMediaStreamSource doesn't receive a mismatched stream (Firefox does
    // not resample — it emits silence; Chrome resamples transparently).
    const track = this.stream.getAudioTracks()[0];
    const settings = track?.getSettings();
    const nativeRate = settings?.sampleRate;
    // Not in lib.dom's MediaTrackSettings — inconsistently reported (Chrome sometimes; often
    // absent on Firefox/Safari). Best-effort mic-hardware input-latency compensation (section 5);
    // 0 (no correction) when unavailable rather than guessing.
    this.inputLatencySeconds =
      (settings as (MediaTrackSettings & { latency?: number }) | undefined)?.latency ?? 0;
    const ctx = new AudioContext(nativeRate ? { sampleRate: nativeRate } : {});
    this.ctx = ctx;

    if (dev) {
      console.log(
        '[mic] AudioContext state=',
        ctx.state,
        'sampleRate=',
        ctx.sampleRate,
        'trackRate=',
        nativeRate,
        'settings=',
        settings
      );
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* Will retry on next user gesture */
      }
      if (dev) console.log('[mic] AudioContext state after resume=', ctx.state);
    }

    this.inRate = ctx.sampleRate;
    await ctx.audioWorklet.addModule(workletUrl);

    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, 'mic-fwd');
    this.node = node;
    node.port.onmessage = (e) => {
      const { data, contextTime } = e.data as { data: Float32Array; contextTime: number };
      this.onPcm(data, contextTime, dev);
    };

    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(node).connect(sink).connect(ctx.destination);

    this.openWs(wsUrl, lang, dev, true);
  }

  /** Open only the fallback's in-band control/audio socket. This is created after `/mse`
   * advertises poster-pcm, so receive-only GPU sessions retain their legacy no-mic behavior. */
  startReceiveOnly(
    wsUrl: string,
    lang: string,
    handlers: MicHandlers = {},
    dev = false,
    langs: string[] = [],
    responseLanguage?: string
  ): void {
    this.handlers = handlers;
    this.langs = langs;
    this.responseLanguage = responseLanguage;
    this.openWs(wsUrl, lang, dev, false);
  }

  private openWs(wsUrl: string, lang: string, dev: boolean, sendPreroll: boolean): void {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.wsReady = new Promise<void>((resolve, reject) => {
      this.resolveWsReady = resolve;
      this.rejectWsReady = reject;
    });
    void this.wsReady.catch(() => {});
    ws.addEventListener('open', () => {
      // response_language only when the app set one — key-present means "explicit client pick"
      // to the edge, which would otherwise keep the session JWT's claim default.
      ws.send(
        JSON.stringify({
          op: 'hello',
          lang,
          langs: this.langs,
          engine: 'default',
          ...(this.responseLanguage !== undefined
            ? { response_language: this.responseLanguage }
            : {}),
          accept_audio: ['pcm16'],
        })
      );
      this.resolveWsReady?.();
      this.resolveWsReady = null;
      this.rejectWsReady = null;
      if (!sendPreroll) return;
      // Preroll ships before any real audio has flowed through onPcm/flushFrame — there's no
      // capture-instant calibration for it yet (audioClockMap has no samples), so its header
      // carries the video-unknown sentinel rather than a bogus value. Same micSeq counter as
      // real frames (continuous across preroll + real audio), no separate numbering scheme.
      const silence = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < PREROLL_FRAMES; i++) {
        this.micSeq += 1;
        this.sendFrame(silence, {
          version: MIC_FRAME_HEADER_VERSION,
          micSeq: this.micSeq,
          videoMediaTimeMs: VIDEO_MEDIA_TIME_UNKNOWN,
          captureEpochMs: performance.timeOrigin + performance.now(),
        });
      }
      this.handlers.onReady?.();
    });
    ws.addEventListener('message', (ev) => this.onServerMessage(ev));
    ws.addEventListener('error', () => {
      const error = new Error('mic socket error');
      this.rejectWsReady?.(error);
      this.rejectTextWaiters(error);
      this.handlers.onError?.(error);
    });
    ws.addEventListener('close', (ev) => {
      const error = new Error(`mic socket closed (${ev.code})`);
      this.rejectWsReady?.(error);
      this.rejectTextWaiters(error);
      if (ev.code !== 1000) console.warn('[mic] WebSocket closed', ev.code, ev.reason);
      if (dev) console.log('[mic] WebSocket close code=', ev.code, 'reason=', ev.reason);
    });
  }

  private onServerMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const frame = decodePcmDownlinkFrame(ev.data);
      if (!frame) return;
      this.player ??= new PcmPlayer(this.handlers.onAudioBlocked);
      this.player.enqueue(frame);
      return;
    }
    let m: {
      type?: string;
      text?: string;
      reply?: string;
      language?: string;
      speech_id?: string;
      request_id?: string;
      error?: string;
    };
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === 'partial' && typeof m.text === 'string') {
      this.handlers.onPartial?.(m.text);
    } else if (m.type === 'turn' && typeof m.text === 'string') {
      const turn = {
        text: m.text,
        reply: m.reply ?? '',
        language: m.language,
        speechId: m.speech_id,
      } satisfies Turn;
      const waiter = m.request_id ? this.textWaiters.get(m.request_id) : undefined;
      if (waiter && m.request_id) {
        clearTimeout(waiter.timer);
        this.textWaiters.delete(m.request_id);
        waiter.resolve(turn);
      } else {
        this.handlers.onTurn?.(turn);
      }
    } else if (m.type === 'audio_reset') {
      this.player?.flush();
    } else if (m.type === 'error') {
      const error = new Error(m.error ?? 'mic stream error');
      const waiter = m.request_id ? this.textWaiters.get(m.request_id) : undefined;
      if (waiter && m.request_id) {
        clearTimeout(waiter.timer);
        this.textWaiters.delete(m.request_id);
        waiter.reject(error);
      } else {
        this.handlers.onError?.(error);
      }
    }
  }

  private onPcm(chunk: Float32Array, contextTime: number, dev: boolean): void {
    if (this.closed) return;

    if (dev) {
      this.pcmCallCount++;
      if (this.pcmCallCount <= 5 || this.pcmCallCount % 100 === 0) {
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) {
          const abs = Math.abs(chunk[i] ?? 0);
          if (abs > peak) peak = abs;
        }
        console.log(
          '[mic] onPcm #',
          this.pcmCallCount,
          'len=',
          chunk.length,
          'peak=',
          peak.toFixed(4)
        );
      }
    }

    const ratio = this.inRate / TARGET_RATE;
    // contextTime is chunk[0]'s AudioContext time; buf[0] is resTail[0], which — since resTail is
    // always the immediately-preceding samples (process() never skips a render quantum) — sits
    // exactly resTail.length/inRate seconds earlier. Re-derived fresh from each chunk's own
    // timestamp rather than carried forward, so this can't accumulate drift over a long session.
    const bufContextTime = contextTime - this.resTail.length / this.inRate;
    const buf = new Float32Array(this.resTail.length + chunk.length);
    buf.set(this.resTail, 0);
    buf.set(chunk, this.resTail.length);

    let pos = this.resPos;
    for (;;) {
      const i = Math.floor(pos);
      if (i + 1 >= buf.length) break;
      const f = pos - i;
      const sample = (buf[i] ?? 0) * (1 - f) + (buf[i + 1] ?? 0) * f;
      if (this.frameLen === 0) this.frameStartContextTime = bufContextTime + pos / this.inRate;
      this.frame[this.frameLen++] = clamp16(sample);
      if (this.frameLen === FRAME_SAMPLES) this.flushFrame(dev);
      pos += ratio;
    }
    const keepFrom = Math.min(Math.floor(pos), buf.length);
    this.resTail = buf.slice(keepFrom);
    this.resPos = pos - keepFrom;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  unmuteAudio(): boolean {
    return this.player?.unmute() ?? true;
  }

  async sendText(text: string): Promise<Turn> {
    const value = text.trim();
    if (!value) throw new Error('text is required');
    if (value.length > 2000) throw new Error('text is too long');
    if (!this.wsReady) throw new Error('text transport is unavailable');
    await this.wsReady;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('text transport is unavailable');
    }
    this.textSequence += 1;
    const id = `text-${this.textSequence}`;
    const result = new Promise<Turn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.textWaiters.delete(id);
        reject(new Error('text response timed out'));
      }, 30_000);
      this.textWaiters.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ op: 'text', id, text: value }));
    return result;
  }

  /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
   *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
  setLangs(langs: string[]): void {
    this.langs = langs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'set_langs', langs }));
    }
  }

  /** Change the preferred REPLY language mid-session (BCP-47; '' clears). Sends a
   *  {op:'set_response_language'} text frame the edge applies on the next turn; also stored so
   *  a socket reconnect's hello carries the latest pick. */
  setResponseLanguage(lang: string): void {
    this.responseLanguage = lang;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'set_response_language', language: lang }));
    }
  }

  private flushFrame(dev: boolean): void {
    let header: MicFrameHeader | null = null;
    if (this.ctx) {
      const ts = this.ctx.getOutputTimestamp();
      // AudioTimestamp's fields are typed optional even though real implementations always
      // populate both; fall back to reading the context directly rather than skipping the sample.
      this.audioClockMap.record(
        ts.contextTime ?? this.ctx.currentTime,
        ts.performanceTime ?? performance.now()
      );
      const result = computeFrameTimestamp(
        this.frameStartContextTime,
        this.inputLatencySeconds,
        this.audioClockMap,
        this.getVideoMediaTimeMs,
        performance.timeOrigin
      );
      if (result) {
        this.micSeq += 1;
        header = { version: MIC_FRAME_HEADER_VERSION, micSeq: this.micSeq, ...result };
        this.handlers.onFrameTimestamp?.(header);
      }
    }

    // No header (this.ctx not yet set — shouldn't happen once start() has run) means no send:
    // every /mic_stream frame carries the header unconditionally (no negotiation, section 4), so
    // a frame we can't header correctly must not go out headerless and desync the receiver.
    if (header && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const pcm = this.muted ? new Int16Array(FRAME_SAMPLES) : this.frame.slice();
      if (dev) {
        let allZero = true;
        for (let i = 0; i < pcm.length; i++) {
          if (pcm[i] !== 0) {
            allZero = false;
            break;
          }
        }
        if (allZero && !this.muted && this.pcmCallCount <= 10) {
          console.warn(
            '[mic] flushFrame: sending all-zero frame (possible silence / rate mismatch)'
          );
        }
      }
      this.sendFrame(pcm, header);
    }
    this.frameLen = 0;
  }

  /** Prepends the wire header (section 4) to a 1600-sample PCM frame and sends it as one binary
   *  WS message. Used by both flushFrame() and the preroll send in openWs(). */
  private sendFrame(pcm: Int16Array, header: MicFrameHeader): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const wireFrame = new Uint8Array(MIC_FRAME_HEADER_BYTES + pcmBytes.byteLength);
    wireFrame.set(encodeMicFrameHeader(header), 0);
    wireFrame.set(pcmBytes, MIC_FRAME_HEADER_BYTES);
    this.ws.send(wireFrame);
  }

  stop(): void {
    this.closed = true;
    this.rejectTextWaiters(new Error('mic transport stopped'));
    try {
      this.ws?.close();
    } catch {
      /* */
    }
    this.ws = null;
    this.player?.stop();
    this.player = null;
    try {
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* */
    }
    this.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private rejectTextWaiters(error: Error): void {
    for (const waiter of this.textWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.textWaiters.clear();
  }
}
