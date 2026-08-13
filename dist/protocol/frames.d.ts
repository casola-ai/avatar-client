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
export declare const FRAME_HEADER_BYTES = 16;
export declare const FrameType: {
    /** Codec initialization payload for the channel (e.g. fMP4 ftyp+moov). */
    readonly MEDIA_INIT: 1;
    /** Media payload (fMP4 segment, PCM slice, data blob). */
    readonly MEDIA: 2;
};
/** frame_type values ≥ this are experimental; receivers MUST ignore unknown ones. */
export declare const FRAME_TYPE_EXPERIMENTAL_MIN = 128;
export declare const FrameFlags: {
    /** Payload starts a keyframe-aligned group (video). */
    readonly KEYFRAME: 1;
    /** Payload begins a complete codec unit (init segment, fMP4 segment, or PCM unit). */
    readonly UNIT_START: 2;
    /** Payload ends a complete codec unit. A one-frame unit carries UNIT_START | UNIT_END. */
    readonly UNIT_END: 4;
};
export declare const MAX_SEQ = 4294967295;
export interface FrameHeader {
    frameType: number;
    channelId: number;
    flags: number;
    seq: number;
    ptsUs: number;
}
export interface MediaFrame extends FrameHeader {
    payload: Uint8Array;
}
export declare function encodeFrame(frame: MediaFrame): Uint8Array;
export declare function decodeFrame(bytes: Uint8Array): MediaFrame;
