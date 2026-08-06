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
export declare const MIC_FRAME_HEADER_VERSION = 1;
export declare const MIC_FRAME_HEADER_BYTES = 20;
export declare const MIC_FRAME_MAGIC = 51792;
/** `videoMediaTimeMs` sentinel for "no video calibration yet" — bit-identical to a signed
 *  int32 -1, reinterpreted unsigned. */
export declare const VIDEO_MEDIA_TIME_UNKNOWN = 4294967295;
export interface MicFrameHeader {
    version: number;
    micSeq: number;
    videoMediaTimeMs: number;
    captureEpochMs: number;
}
export declare function encodeMicFrameHeader(header: MicFrameHeader): Uint8Array;
/** Throws if the buffer is too short OR the magic doesn't match — a magic mismatch means either
 *  a wire-format bug or (server-side use of this same layout) a pre-header client's raw PCM,
 *  which callers wanting graceful old-client handling should catch and fall back on. */
export declare function decodeMicFrameHeader(bytes: Uint8Array, byteOffset?: number): MicFrameHeader;
