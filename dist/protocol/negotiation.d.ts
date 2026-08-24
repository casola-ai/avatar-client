import type { AcceptMessage, HelloMessage } from './messages';
export declare const Feature: {
    readonly UTTERANCE_TIMING_V1: "utterance_timing_v1";
    readonly MEDIA_UNIT_FLAGS_V1: "media_unit_flags_v1";
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
    /** Downlink video the server can send, if any. Omitted/null with `poster` = poster mode. */
    video?: {
        mime: string;
        fps?: number;
        segFrames?: number;
    } | null;
    poster?: {
        url: string;
    } | null;
    /** Uplink mic format the server expects. Omitted = no mic channel. */
    mic?: {
        sampleRate: number;
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
