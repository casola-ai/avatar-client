import { type VideoCodec } from './channels';
import type { AcceptMessage, HelloMessage } from './messages';
export declare const Feature: {
    readonly UTTERANCE_TIMING_V1: "utterance_timing_v1";
    readonly MEDIA_UNIT_FLAGS_V1: "media_unit_flags_v1";
    /** The mic uplink may be thin (spec §4): a sender MAY send an EMPTY payload for a 100 ms
     *  window whose audio is silence, whichever codec ch1 negotiated, and an `opus` frame MAY carry
     *  one to five packets. The cadence is kept — the receiver expands both to silence. */
    readonly MIC_DTX_V1: "mic_dtx_v1";
};
/**
 * hello → accept negotiation, server side. Pure: the caller supplies what the session can offer
 * (from the JWT + its own capabilities) and gets back either the accept body (minus `seq`, which
 * the connection stamps at send) or a refusal with a stable error code.
 */
export interface SessionOffer {
    /** The bound avatar_versions.id, echoed to the client as the pinning ack. */
    personaKey: string;
    capSeconds: number;
    /** Downlink audio the server will send, if any. */
    audio?: {
        sampleRate: number;
    } | null;
    /** Downlink video the server can send, if any. Omitted/null with `poster` = poster mode.
     *  `codecs` is the server's OWN preference order (e.g. `['av1','hevc','h264']`, ordered by
     *  measured bits-per-quality) and `mimes` the mime string of each; a server that leaves `codecs`
     *  out does not negotiate and serves `mime` as-is, which is the pre-negotiation wire. */
    video?: {
        mime: string;
        fps?: number;
        segFrames?: number;
        codecs?: readonly string[];
        mimes?: Record<string, string>;
    } | null;
    poster?: {
        url: string;
    } | null;
    /** Uplink mic format the server expects. Omitted = no mic channel. `codecs` is what this
     *  server can decode, in its own order of preference; omitted = `['pcm16']`. */
    mic?: {
        sampleRate: number;
        codecs?: readonly string[];
    } | null;
    features?: string[];
}
export type NegotiationResult = {
    ok: true;
    accept: Omit<AcceptMessage, 'seq'>;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * The downlink codec for this session: the first entry of the SERVER's preference list
 * (`offer.video.codecs`) that the client lists in `hello.video.codecs`. The client's list is a
 * capability, not a preference — it says what the browser decodes, and the server holds the numbers
 * that say which of those is cheapest to ship. An absent/empty client list, or a server offering
 * nothing beyond the baseline, lands on `h264`, which keeps every pre-negotiation client on exactly
 * today's stream. Unknown codec names on either side are ignored rather than refused.
 */
export declare function selectVideoCodec(hello: HelloMessage, offerVideo: NonNullable<SessionOffer['video']>): VideoCodec;
export interface NegotiateOptions {
    /**
     * `false` is a TEXT-ONLY (brain-only) session: the server answers with control messages alone
     * — a `turn` carrying a `brain` payload — and never opens a downlink. Defaults to `true`, which
     * is byte-for-byte today's behaviour.
     */
    render?: boolean;
}
/**
 * With `render: false` the displayable-output requirement below is skipped — it exists to refuse a
 * session that can neither show nor say anything, which is precisely what a text-only session is
 * *for* — and no video, PCM or poster is offered even when the offer has them and the client
 * accepts them. The channel map is then `[mic]` when the client asked for a microphone, else `[]`.
 *
 * The mic contract is unchanged either way: a malformed or mismatched mic request is still refused
 * with `unsupported_codec`, because ASR still runs.
 */
export declare function negotiateAccept(hello: HelloMessage, offer: SessionOffer, options?: NegotiateOptions): NegotiationResult;
