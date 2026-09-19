import { type Logger } from './logger';
import { type MicFrameInfo } from './mic-pipeline';
/** Opus target for the mic uplink: 16 kHz wideband speech, VoIP-grade. ~400 B per 100 ms frame
 *  against 3200 B of raw PCM16 — the point of the codec. */
export declare const OPUS_MIC_BITRATE = 32000;
/** Opus packet duration. 20 ms — a single native Opus frame — and NOT the wire's 100 ms: WebCodecs
 *  implementations build >60 ms packets by concatenating 20 ms frames in a repacketizer, and
 *  Chromium's fails on the first encode ("Failed to add to Repacketizer", Chromium 151, any sample
 *  rate) while `isConfigSupported` still answers true for it. So a 100 ms wire frame carries five
 *  of these, length-prefixed (see `frameOpusPayload`). */
export declare const OPUS_PACKET_US = 20000;
/** The exact configuration probed with `isConfigSupported` and later `configure`d — one function
 *  so the probe can never answer for a different config than the one used. Native DTX stays OFF
 *  and is not the mechanism for a quiet uplink: Chromium's encoder drops a DTX-suppressed frame
 *  without emitting a chunk and without advancing its timestamp tracker, so a sender could never
 *  say which 100 ms window a packet belongs to. Silence is gated per whole window instead
 *  (`mic-dtx.ts`), and a gated window leaves through `skip()` so it stays in capture order. */
export declare function opusMicEncoderConfig(): AudioEncoderConfig;
/** The payload of one `opus` ch1 media frame (spec §4): each packet prefixed by its byte length
 *  as a big-endian u16, packets in capture order, durations summing to the frame's 100 ms. */
export declare function frameOpusPayload(packets: readonly Uint8Array[]): Uint8Array;
/** The payload of a window the sender left out under `mic_dtx_v1`: no bytes at all. */
export declare const EMPTY_MIC_PAYLOAD: Uint8Array<ArrayBuffer>;
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
export declare class OpusMicEncoder {
    private readonly opts;
    private encoder;
    /** Windows whose wire frame has not left yet, in capture order: the ones inside the encoder and,
     *  behind any of those, the ones `skip()` is holding so an empty frame cannot overtake packets
     *  still surfacing. */
    private readonly pending;
    /** Packets of the wire frame being assembled, and the duration they cover so far. */
    private parts;
    private partsUs;
    private closed;
    /** Whether this browser can produce the wire's Opus packets. Asked once per session before the
     *  hello goes out (the driver sends it synchronously on socket open, and this is async). */
    static supported(dev?: boolean): Promise<boolean>;
    constructor(opts: OpusMicEncoderOpts);
    /** Encode one pipeline frame. `info` comes back out of `onPacket` with the packet. */
    encode(pcm: Int16Array, info: MicFrameInfo): void;
    /** A window that goes out EMPTY (`mic_dtx_v1`): nothing to encode, but its frame must leave in
     *  capture order — behind the packets of any window still inside the encoder, whose output
     *  surfaces asynchronously. With nothing in flight it leaves at once. */
    skip(info: MicFrameInfo): void;
    private onChunk;
    private fail;
    /** Idempotent. Pending output is discarded — nothing may go out after the session stops. */
    stop(): void;
}
