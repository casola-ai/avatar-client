import { ClockMap } from './clock-map';

const TARGET_RATE = 16000;
export const MIC_FRAME_SAMPLES = 1600; // 100 ms at 16 kHz

/** The v1 wire's "video media time unknown" sentinel, kept for the onAudioFrameSent callback's
 *  `videoMediaTimeMs` field (its shape predates v2 and is unchanged). On the v2 wire an unknown
 *  value is sent as `pts_us = 0` instead — the sentinel never leaves the process. */
export const VIDEO_MEDIA_TIME_UNKNOWN = 0xffffffff;

/** Per-frame capture calibration, produced once per flushed 100 ms frame. */
export interface MicFrameInfo {
  micSeq: number;
  videoMediaTimeMs: number;
  captureEpochMs: number;
}

function clamp16(x: number): number {
  const v = Math.round(x * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}

/** The capture-instant calibration step, extracted as a pure function so it's directly
 *  unit-testable without a real AudioContext/DOM: given a frame's (latency-compensated) capture
 *  instant on the AudioContext clock and the audio-clock calibration built up so far, look up the
 *  corresponding performance.now()-domain instant, then ask `getVideoMediaTimeMs` (typically
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

export interface MicPipelineOpts {
  workletUrl: string;
  /** Pre-fetched MediaStream from ensurePermission() — avoids a second getUserMedia call. */
  stream?: MediaStream;
  dev?: boolean;
  /** Typically MsePlayer.mediaTimeAt — kept as a plain function so the pipeline stays
   *  decoupled/testable. undefined = no video calibration source (poster mode); frames then
   *  report VIDEO_MEDIA_TIME_UNKNOWN. */
  getVideoMediaTimeMs?: (performanceTimeMs: number) => number | null;
  /** One call per assembled 100 ms 16 kHz frame. `pcm` is a fresh copy the receiver owns.
   *  Muted frames arrive zeroed (capture keeps running so timing stays continuous). */
  onFrame: (pcm: Int16Array, info: MicFrameInfo) => void;
}

/**
 * Microphone capture: getUserMedia → AudioWorklet → resample to 16 kHz → 1600-sample Int16
 * frames with capture-instant calibration. Wire-agnostic — the v2 driver turns the emitted
 * frames into channel-1 media frames. Extracted from the v1 MicCapture (which also owned the
 * /mic_stream socket); the audio path is unchanged.
 */
export class MicPipeline {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private opts: MicPipelineOpts | null = null;
  private inRate = 48000;

  private resTail = new Float32Array(0);
  private resPos = 0;
  private readonly frame = new Int16Array(MIC_FRAME_SAMPLES);
  private frameLen = 0;
  private closed = false;
  private muted = false;
  private pcmCallCount = 0;
  private readonly audioClockMap = new ClockMap();
  private inputLatencySeconds = 0;
  private frameStartContextTime = 0;
  private micSeq = 0;

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

  async start(opts: MicPipelineOpts): Promise<void> {
    this.opts = opts;
    const dev = opts.dev ?? false;
    if (opts.stream) {
      this.stream = opts.stream;
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
    // absent on Firefox/Safari). Best-effort mic-hardware input-latency compensation;
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
    await ctx.audioWorklet.addModule(opts.workletUrl);

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
      if (this.frameLen === MIC_FRAME_SAMPLES) this.flushFrame();
      pos += ratio;
    }
    const keepFrom = Math.min(Math.floor(pos), buf.length);
    this.resTail = buf.slice(keepFrom);
    this.resPos = pos - keepFrom;
  }

  private flushFrame(): void {
    const opts = this.opts;
    if (this.ctx && opts) {
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
        opts.getVideoMediaTimeMs,
        performance.timeOrigin
      );
      // A frame with no capture calibration must not go out and desync the receiver — same rule
      // as the v1 wire (can only happen before the first clock sample, i.e. never in practice).
      if (result) {
        this.micSeq += 1;
        const pcm = this.muted ? new Int16Array(MIC_FRAME_SAMPLES) : this.frame.slice();
        opts.onFrame(pcm, { micSeq: this.micSeq, ...result });
      }
    }
    this.frameLen = 0;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  stop(): void {
    this.closed = true;
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
