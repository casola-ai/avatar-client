import { consoleLogger, type Logger } from './logger';
import { MIC_FRAME_SAMPLES, MIC_SAMPLE_RATE, type MicFrameInfo } from './mic-pipeline';

/** Opus target for the mic uplink: 16 kHz wideband speech, VoIP-grade. ~400 B per 100 ms frame
 *  against 3200 B of raw PCM16 — the point of the codec. */
export const OPUS_MIC_BITRATE = 32_000;

/** The wire's frame unit (spec §4): one ch1 media frame = 100 ms, whichever codec negotiated. */
const FRAME_DURATION_US = Math.round((MIC_FRAME_SAMPLES / MIC_SAMPLE_RATE) * 1_000_000);

/** Opus packet duration. 20 ms — a single native Opus frame — and NOT the wire's 100 ms: WebCodecs
 *  implementations build >60 ms packets by concatenating 20 ms frames in a repacketizer, and
 *  Chromium's fails on the first encode ("Failed to add to Repacketizer", Chromium 151, any sample
 *  rate) while `isConfigSupported` still answers true for it. So a 100 ms wire frame carries five
 *  of these, length-prefixed (see `frameOpusPayload`). */
export const OPUS_PACKET_US = 20_000;

/** The exact configuration probed with `isConfigSupported` and later `configure`d — one function
 *  so the probe can never answer for a different config than the one used. Native DTX stays OFF
 *  and is not the mechanism for a quiet uplink: Chromium's encoder drops a DTX-suppressed frame
 *  without emitting a chunk and without advancing its timestamp tracker, so a sender could never
 *  say which 100 ms window a packet belongs to. Silence is gated per whole window instead
 *  (`mic-dtx.ts`), and a gated window leaves through `skip()` so it stays in capture order. */
export function opusMicEncoderConfig(): AudioEncoderConfig {
  return {
    codec: 'opus',
    sampleRate: MIC_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: OPUS_MIC_BITRATE,
    opus: { frameDuration: OPUS_PACKET_US, usedtx: false },
  };
}

/** The payload of one `opus` ch1 media frame (spec §4): each packet prefixed by its byte length
 *  as a big-endian u16, packets in capture order, durations summing to the frame's 100 ms. */
export function frameOpusPayload(packets: readonly Uint8Array[]): Uint8Array {
  const total = packets.reduce((n, p) => n + 2 + p.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const packet of packets) {
    view.setUint16(offset, packet.byteLength, false);
    out.set(packet, offset + 2);
    offset += 2 + packet.byteLength;
  }
  return out;
}

/** The payload of a window the sender left out under `mic_dtx_v1`: no bytes at all. */
export const EMPTY_MIC_PAYLOAD = new Uint8Array(0);

export interface OpusMicEncoderOpts {
  /** One call per wire frame, in capture order: the encoded packets of a window fed to
   *  `encode()`, or `EMPTY_MIC_PAYLOAD` for one handed to `skip()`. `packet` is a fresh copy the
   *  receiver owns. */
  onPacket: (packet: Uint8Array, info: MicFrameInfo) => void;
  /** The encoder died. Fires at most once; the encoder accepts nothing afterwards. */
  onError: (err: unknown) => void;
  /** Where the encoder routes its logs. Defaults to a non-dev console (warn only). */
  logger?: Logger;
}

/**
 * WebCodecs Opus encoder for the mic uplink. Sits between MicPipeline's 100 ms Int16 frames and
 * the driver's channel-1 media frames when the box's accept declared `codec: 'opus'`; the pipeline
 * itself (capture, resample, mute-as-zeros, capture calibration) is untouched.
 *
 * Each 100 ms pipeline frame becomes five 20 ms Opus packets (see OPUS_PACKET_US), which are
 * gathered back into ONE wire frame by accumulated chunk duration, so the wire keeps its 100 ms
 * cadence, `seq` and `pts_us` exactly as with pcm16. Output-to-input correlation is a FIFO of the
 * pending frames' calibration, not the chunk timestamp: WebCodecs emits chunks in input order
 * (asynchronously — the last packet of a frame may only surface once the next frame is fed), and
 * Chromium derives chunk timestamps from the first input plus accumulated frames rather than
 * echoing each AudioData's own, so a timestamp-keyed lookup would desync for good.
 */
export class OpusMicEncoder {
  private encoder: AudioEncoder | null = null;
  /** Windows whose wire frame has not left yet, in capture order: the ones inside the encoder and,
   *  behind any of those, the ones `skip()` is holding so an empty frame cannot overtake packets
   *  still surfacing. */
  private readonly pending: Array<{ info: MicFrameInfo; empty: boolean }> = [];
  /** Packets of the wire frame being assembled, and the duration they cover so far. */
  private parts: Uint8Array[] = [];
  private partsUs = 0;
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
    this.pending.push({ info, empty: false });
    try {
      encoder.encode(data);
    } catch (err) {
      this.pending.pop();
      this.fail(err);
    } finally {
      data.close();
    }
  }

  /** A window that goes out EMPTY (`mic_dtx_v1`): nothing to encode, but its frame must leave in
   *  capture order — behind the packets of any window still inside the encoder, whose output
   *  surfaces asynchronously. With nothing in flight it leaves at once. */
  skip(info: MicFrameInfo): void {
    if (!this.encoder || this.closed) return;
    if (this.pending.length === 0) {
      this.opts.onPacket(EMPTY_MIC_PAYLOAD, info);
      return;
    }
    this.pending.push({ info, empty: true });
  }

  private onChunk(chunk: EncodedAudioChunk): void {
    if (this.closed) return;
    const packet = new Uint8Array(chunk.byteLength);
    chunk.copyTo(packet);
    this.parts.push(packet);
    // `duration` is optional in the spec; every packet is OPUS_PACKET_US by configuration.
    this.partsUs += chunk.duration ?? OPUS_PACKET_US;
    if (this.partsUs < FRAME_DURATION_US) return;
    const parts = this.parts;
    this.parts = [];
    this.partsUs = 0;
    const head = this.pending.shift();
    if (!head || head.empty) {
      (this.opts.logger ?? consoleLogger(false))(
        'debug',
        '[mic] opus frame with no pending calibration; dropped'
      );
      return;
    }
    this.opts.onPacket(frameOpusPayload(parts), head.info);
    // The window's packets are out: the empty frames that were queued behind them may follow.
    while (this.pending[0]?.empty) {
      const next = this.pending.shift();
      if (next) this.opts.onPacket(EMPTY_MIC_PAYLOAD, next.info);
    }
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
    this.parts = [];
    this.partsUs = 0;
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
