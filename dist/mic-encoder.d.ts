import { type MicFrameInfo } from './mic-pipeline';
/** Opus target for the mic uplink: 16 kHz wideband speech, VoIP-grade. ~400 B per 100 ms frame
 *  against 3200 B of raw PCM16 — the point of the codec. */
export declare const OPUS_MIC_BITRATE = 32000;
/** The exact configuration probed with `isConfigSupported` and later `configure`d — one function
 *  so the probe can never answer for a different config than the one used. DTX stays OFF: the
 *  box reads uplink liveness from the frame cadence, so a silent user must still emit a packet
 *  every 100 ms (spec §4). */
export declare function opusMicEncoderConfig(): AudioEncoderConfig;
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
export declare class OpusMicEncoder {
    private readonly opts;
    private encoder;
    private readonly pending;
    private closed;
    /** Whether this browser can produce the wire's Opus packets. Asked once per session before the
     *  hello goes out (the driver sends it synchronously on socket open, and this is async). */
    static supported(dev?: boolean): Promise<boolean>;
    constructor(opts: OpusMicEncoderOpts);
    /** Encode one pipeline frame. `info` comes back out of `onPacket` with the packet. */
    encode(pcm: Int16Array, info: MicFrameInfo): void;
    private onChunk;
    private fail;
    /** Idempotent. Pending output is discarded — nothing may go out after the session stops. */
    stop(): void;
}
