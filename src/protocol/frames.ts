// GENERATED from packages/avatar-protocol/src/frames.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
/**
 * Binary frame codec — 16-byte little-endian header, then payload:
 *
 *   [u8 frame_type][u8 channel_id][u16 flags][u32 seq][u64 pts_us]
 *
 * `seq` is per-channel monotonic and wraps at 2^32. `pts_us` is microseconds on the server-owned
 * session media clock (0 at `accept`); for mic uplink it is the displayed media time at capture.
 * `pts_us` rides the wire as u64 but the public API is `number` — values above
 * Number.MAX_SAFE_INTEGER (~285 years of session) are refused rather than silently rounded.
 */

export const FRAME_HEADER_BYTES = 16;

export const FrameType = {
  /** Codec initialization payload for the channel (e.g. fMP4 ftyp+moov). */
  MEDIA_INIT: 0x01,
  /** Media payload (fMP4 segment, PCM slice, data blob). */
  MEDIA: 0x02,
} as const;

/** frame_type values ≥ this are experimental; receivers MUST ignore unknown ones. */
export const FRAME_TYPE_EXPERIMENTAL_MIN = 0x80;

export const FrameFlags = {
  /** Payload starts a keyframe-aligned group (video). */
  KEYFRAME: 0x0001,
} as const;

export const MAX_SEQ = 0xffff_ffff;

export interface FrameHeader {
  frameType: number; // u8
  channelId: number; // u8
  flags: number; // u16 bitfield; undeclared bits MUST be zero
  seq: number; // u32, per-channel, wraps
  ptsUs: number; // u64 on the wire; safe-integer number here
}

export interface MediaFrame extends FrameHeader {
  payload: Uint8Array;
}

const MAX_PTS = BigInt(Number.MAX_SAFE_INTEGER);

function checkRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`frame ${name} out of range: ${value}`);
  }
}

export function encodeFrame(frame: MediaFrame): Uint8Array {
  checkRange('frame_type', frame.frameType, 0xff);
  checkRange('channel_id', frame.channelId, 0xff);
  checkRange('flags', frame.flags, 0xffff);
  checkRange('seq', frame.seq, MAX_SEQ);
  if (!Number.isSafeInteger(frame.ptsUs) || frame.ptsUs < 0) {
    throw new RangeError(`frame pts_us out of range: ${frame.ptsUs}`);
  }
  const out = new Uint8Array(FRAME_HEADER_BYTES + frame.payload.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, frame.frameType);
  dv.setUint8(1, frame.channelId);
  dv.setUint16(2, frame.flags, true);
  dv.setUint32(4, frame.seq, true);
  dv.setBigUint64(8, BigInt(frame.ptsUs), true);
  out.set(frame.payload, FRAME_HEADER_BYTES);
  return out;
}

export function decodeFrame(bytes: Uint8Array): MediaFrame {
  if (bytes.byteLength < FRAME_HEADER_BYTES) {
    throw new RangeError(`frame shorter than header: ${bytes.byteLength} bytes`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pts = dv.getBigUint64(8, true);
  if (pts > MAX_PTS) {
    throw new RangeError(`frame pts_us exceeds safe integer range: ${pts}`);
  }
  return {
    frameType: dv.getUint8(0),
    channelId: dv.getUint8(1),
    flags: dv.getUint16(2, true),
    seq: dv.getUint32(4, true),
    ptsUs: Number(pts),
    payload: bytes.subarray(FRAME_HEADER_BYTES),
  };
}
