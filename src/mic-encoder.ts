import { MIC_FRAME_SAMPLES, MIC_SAMPLE_RATE, type MicFrameInfo } from './mic-pipeline';

/** Opus target for the mic uplink: 16 kHz wideband speech, VoIP-grade. ~400 B per 100 ms frame
 *  against 3200 B of raw PCM16 — the point of the codec. */
export const OPUS_MIC_BITRATE = 32_000;

/** One Opus packet per mic frame, so the packet duration IS the frame duration (100 ms). The wire
 *  (spec §4) keeps one frame = one 100 ms unit whichever codec ch1 negotiated. */
const FRAME_DURATION_US = Math.round((MIC_FRAME_SAMPLES / MIC_SAMPLE_RATE) * 1_000_000);

/** The exact configuration probed with `isConfigSupported` and later `configure`d — one function
 *  so the probe can never answer for a different config than the one used. DTX stays OFF: the
 *  box reads uplink liveness from the frame cadence, so a silent user must still emit a packet
 *  every 100 ms (spec §4). */
export function opusMicEncoderConfig(): AudioEncoderConfig {
  return {
    codec: 'opus',
    sampleRate: MIC_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: OPUS_MIC_BITRATE,
    opus: { frameDuration: FRAME_DURATION_US, usedtx: false },
  };
}

export interface OpusMicEncoderOpts {
  /** One call per encoded mic frame, in capture order. `packet` is a fresh copy the receiver owns. */
  onPacket: (packet: Uint8Array, info: MicFrameInfo) => void;
  /** The encoder died. Fires at most once; the encoder accepts nothing afterwards. */
  onError: (err: unknown) => void;
  dev?: boolean;
}

/**
 * WebCodecs Opus encoder for the mic uplink. Sits between MicPipeline's 100 ms Int16 frames and
 * the driver's channel-1 media frames when the box's accept declared `codec: 'opus'`; the pipeline
 * itself (capture, resample, mute-as-zeros, capture calibration) is untouched.
 *
 * Output-to-input correlation is a FIFO of the pending frames' calibration, not the chunk
 * timestamp: WebCodecs emits chunks in input order, and Chromium derives chunk timestamps from the
 * first input plus accumulated frames rather than echoing each AudioData's own, so a
 * timestamp-keyed lookup would desync for good on any discontinuity.
 */
export class OpusMicEncoder {
  private encoder: AudioEncoder | null = null;
  private readonly pending: MicFrameInfo[] = [];
  private closed = false;

  /** Whether this browser can produce the wire's Opus packets. Asked once per session before the
   *  hello goes out (the driver sends it synchronously on socket open, and this is async). */
  static async supported(dev = false): Promise<boolean> {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
      if (dev) console.log('[mic] WebCodecs AudioEncoder unavailable; uplink stays pcm16');
      return false;
    }
    try {
      const result = await AudioEncoder.isConfigSupported(opusMicEncoderConfig());
      if (dev) console.log('[mic] opus AudioEncoder supported=', result.supported);
      return result.supported === true;
    } catch (err) {
      if (dev) console.warn('[mic] opus AudioEncoder probe failed; uplink stays pcm16', err);
      return false;
    }
  }

  constructor(private readonly opts: OpusMicEncoderOpts) {
    const encoder = new AudioEncoder({
      output: (chunk) => this.onChunk(chunk),
      error: (err) => this.fail(err),
    });
    encoder.configure(opusMicEncoderConfig());
    this.encoder = encoder;
  }

  /** Encode one pipeline frame. `info` comes back out of `onPacket` with the packet. */
  encode(pcm: Int16Array, info: MicFrameInfo): void {
    const encoder = this.encoder;
    if (!encoder || this.closed) return;
    // Contiguous from 0 at the wire's frame duration — micSeq is 1-based and never skips (the
    // pipeline sends muted frames as zeros precisely so the cadence stays continuous).
    const data = new AudioData({
      format: 's16',
      sampleRate: MIC_SAMPLE_RATE,
      numberOfFrames: pcm.length,
      numberOfChannels: 1,
      timestamp: (info.micSeq - 1) * FRAME_DURATION_US,
      // The pipeline's frames are plain ArrayBuffer-backed copies; the cast only narrows the
      // `ArrayBufferLike` that TypedArray typings carry (AudioData copies the bytes anyway).
      data: pcm as Int16Array<ArrayBuffer>,
    });
    this.pending.push(info);
    try {
      encoder.encode(data);
    } catch (err) {
      this.pending.pop();
      this.fail(err);
    } finally {
      data.close();
    }
  }

  private onChunk(chunk: EncodedAudioChunk): void {
    if (this.closed) return;
    const info = this.pending.shift();
    if (!info) {
      if (this.opts.dev) console.warn('[mic] opus chunk with no pending frame; dropped');
      return;
    }
    if (this.opts.dev && chunk.timestamp !== (info.micSeq - 1) * FRAME_DURATION_US) {
      console.warn('[mic] opus chunk timestamp drift', chunk.timestamp, info.micSeq);
    }
    const packet = new Uint8Array(chunk.byteLength);
    chunk.copyTo(packet);
    this.opts.onPacket(packet, info);
  }

  private fail(err: unknown): void {
    if (this.closed) return;
    this.stop();
    this.opts.onError(err);
  }

  /** Idempotent. Pending output is discarded — nothing may go out after the session stops. */
  stop(): void {
    this.closed = true;
    this.pending.length = 0;
    const encoder = this.encoder;
    this.encoder = null;
    if (!encoder) return;
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* already closed */
    }
  }
}
