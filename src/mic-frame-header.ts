/** Wire format for the per-frame header prefixed to each `/mic_stream` binary frame — see
 *  `specs/av-sync-timestamps-notes.md` section 4. Packed, little-endian, no padding:
 *
 *    offset  size  field
 *    0       2     magic     (uint16, MIC_FRAME_MAGIC) — lets a compat-aware server distinguish
 *                             this framed format from a pre-header client's raw PCM without an
 *                             explicit hello-time capability flag (see the notes doc, section 4)
 *    2       1     version   (uint8)
 *    3       1     reserved  (uint8, always 0) — combined with magic+version, gives the server's
 *                             detection check a ~1-in-4-billion false-positive rate against raw
 *                             PCM misread as a header; acceptable pre-launch (no live customers)
 *    4       4     micSeq    (uint32) — monotonic per connection; named to avoid colliding with
 *                             the tracer's unrelated frame_seq (video-timeline index, server-side)
 *    8       4     videoMediaTimeMs (uint32, VIDEO_MEDIA_TIME_UNKNOWN = no video calibration yet)
 *    12      8     captureEpochMs   (float64)
 *
 *  Followed on the wire by the existing raw Int16 PCM payload, unchanged. */

export const MIC_FRAME_HEADER_VERSION = 1;
export const MIC_FRAME_HEADER_BYTES = 20;
export const MIC_FRAME_MAGIC = 0xca50;

/** `videoMediaTimeMs` sentinel for "no video calibration yet" — bit-identical to a signed
 *  int32 -1, reinterpreted unsigned. */
export const VIDEO_MEDIA_TIME_UNKNOWN = 0xffffffff;

export interface MicFrameHeader {
  version: number;
  micSeq: number;
  videoMediaTimeMs: number;
  captureEpochMs: number;
}

export function encodeMicFrameHeader(header: MicFrameHeader): Uint8Array {
  const bytes = new Uint8Array(MIC_FRAME_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, MIC_FRAME_MAGIC, true);
  view.setUint8(2, header.version);
  view.setUint8(3, 0); // reserved
  view.setUint32(4, header.micSeq, true);
  view.setUint32(8, header.videoMediaTimeMs, true);
  view.setFloat64(12, header.captureEpochMs, true);
  return bytes;
}

/** Throws if the buffer is too short OR the magic doesn't match — a magic mismatch means either
 *  a wire-format bug or (server-side use of this same layout) a pre-header client's raw PCM,
 *  which callers wanting graceful old-client handling should catch and fall back on. */
export function decodeMicFrameHeader(bytes: Uint8Array, byteOffset = 0): MicFrameHeader {
  if (bytes.byteLength - byteOffset < MIC_FRAME_HEADER_BYTES) {
    throw new RangeError(
      `mic frame header needs ${MIC_FRAME_HEADER_BYTES} bytes, got ${bytes.byteLength - byteOffset}`
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + byteOffset, MIC_FRAME_HEADER_BYTES);
  const magic = view.getUint16(0, true);
  if (magic !== MIC_FRAME_MAGIC) {
    throw new RangeError(
      `mic frame header magic mismatch: expected 0x${MIC_FRAME_MAGIC.toString(16)}, got 0x${magic.toString(16)}`
    );
  }
  return {
    version: view.getUint8(2),
    micSeq: view.getUint32(4, true),
    videoMediaTimeMs: view.getUint32(8, true),
    captureEpochMs: view.getFloat64(12, true),
  };
}
