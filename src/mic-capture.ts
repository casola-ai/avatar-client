const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600;
const PREROLL_FRAMES = 20;

export interface Turn {
  text: string;
  reply: string;
  language?: string;
  speechId?: string;
}
export interface MicHandlers {
  onPartial?: (text: string) => void;
  onTurn?: (turn: Turn) => void;
  onError?: (err: unknown) => void;
}

function clamp16(x: number): number {
  const v = Math.round(x * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private ws: WebSocket | null = null;
  private handlers: MicHandlers = {};
  private inRate = 48000;

  private resTail = new Float32Array(0);
  private resPos = 0;
  private readonly frame = new Int16Array(FRAME_SAMPLES);
  private frameLen = 0;
  private closed = false;
  private muted = false;
  private pcmCallCount = 0;
  // ASR language pin (box language NAMES, e.g. ['English'] or ['Chinese','English']).
  // [] = the box default (auto-detect across its configured set). Mutable mid-session.
  private langs: string[] = [];

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
    langs: string[] = []
  ): Promise<void> {
    this.handlers = handlers;
    this.langs = langs;
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
    const nativeRate = track?.getSettings().sampleRate;
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
        track?.getSettings()
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
    node.port.onmessage = (e) => this.onPcm(e.data as Float32Array, dev);

    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(node).connect(sink).connect(ctx.destination);

    this.openWs(wsUrl, lang, dev);
  }

  private openWs(wsUrl: string, lang: string, dev: boolean): void {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ op: 'hello', lang, langs: this.langs, engine: 'default' }));
      const silence = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < PREROLL_FRAMES; i++) ws.send(silence.slice());
    });
    ws.addEventListener('message', (ev) => this.onServerMessage(ev));
    ws.addEventListener('error', () => {
      this.handlers.onError?.(new Error('mic socket error'));
    });
    ws.addEventListener('close', (ev) => {
      if (ev.code !== 1000) console.warn('[mic] WebSocket closed', ev.code, ev.reason);
      if (dev) console.log('[mic] WebSocket close code=', ev.code, 'reason=', ev.reason);
    });
  }

  private onServerMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let m: {
      type?: string;
      text?: string;
      reply?: string;
      language?: string;
      speech_id?: string;
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
      this.handlers.onTurn?.({
        text: m.text,
        reply: m.reply ?? '',
        language: m.language,
        speechId: m.speech_id,
      });
    } else if (m.type === 'error') {
      this.handlers.onError?.(new Error(m.error ?? 'mic stream error'));
    }
  }

  private onPcm(chunk: Float32Array, dev: boolean): void {
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
    const buf = new Float32Array(this.resTail.length + chunk.length);
    buf.set(this.resTail, 0);
    buf.set(chunk, this.resTail.length);

    let pos = this.resPos;
    for (;;) {
      const i = Math.floor(pos);
      if (i + 1 >= buf.length) break;
      const f = pos - i;
      const sample = (buf[i] ?? 0) * (1 - f) + (buf[i + 1] ?? 0) * f;
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

  /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
   *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
  setLangs(langs: string[]): void {
    this.langs = langs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'set_langs', langs }));
    }
  }

  private flushFrame(dev: boolean): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = this.muted ? new Int16Array(FRAME_SAMPLES) : this.frame.slice();
      if (dev) {
        let allZero = true;
        for (let i = 0; i < payload.length; i++) {
          if (payload[i] !== 0) {
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
      this.ws.send(payload);
    }
    this.frameLen = 0;
  }

  stop(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* */
    }
    this.ws = null;
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
}
