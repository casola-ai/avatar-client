/**
 * errors.ts — one classified error type for everything that can go wrong in a session.
 *
 * WHY: `onError(e: unknown)` pushed classification onto every host, and they got it wrong in
 * different ways. Two shipped apps hand-roll the same getUserMedia DOMException table with
 * different coverage, and one of them funnels *every* session error through that table — so a
 * box refusing to bind the requested avatar (close 4003) tells the user to check their
 * microphone. The wire already knows what happened; the SDK should say so.
 *
 * `AvatarError` is a real `Error` subclass, so existing `catch` / logging paths keep working and
 * `instanceof Error` stays true. What is new is `kind` (what failed) and `terminal` (whether the
 * session is over) — enough to pick copy without sniffing DOMException names.
 */
/** What failed. Receivers MUST treat an unrecognized kind as `'unknown'`: this list grows. */
export type AvatarErrorKind = 
/** The user denied microphone access, or the page is not a secure context. */
'mic-permission'
/** No microphone exists, or none satisfies the constraints. */
 | 'mic-unavailable'
/** The mic pipeline failed for another reason — worklet load, AudioContext setup. */
 | 'mic-failed'
/** This browser cannot do what the session needs (no getUserMedia, no MSE). */
 | 'unsupported-browser'
/** The session socket could not be opened, or the connect strategy failed. */
 | 'connect'
/** The socket opened but the box never completed the handshake. */
 | 'handshake'
/** The session token was rejected (close 4001). */
 | 'unauthorized'
/** The box does not speak this client's protocol version (close 4002). */
 | 'protocol-mismatch'
/** The box could not bind the avatar version the mint pinned (close 4003). */
 | 'persona-unavailable'
/** The box is at capacity (close 4004). */
 | 'capacity'
/** A protocol policy violation closed the session (close 4008). */
 | 'policy'
/** The box reported an in-band error. Usually non-terminal. */
 | 'server'
/** Playback trouble — MSE append failure, decode hiccup. Usually non-terminal. */
 | 'media' | 'unknown';
/** A classified session error. Always an `Error`; `kind` and `terminal` are the useful parts. */
export declare class AvatarError extends Error {
    readonly kind: AvatarErrorKind;
    /** `false` when the session is still running and this is a degradation, not an ending. */
    readonly terminal: boolean;
    constructor(kind: AvatarErrorKind, message: string, options?: {
        terminal?: boolean;
        cause?: unknown;
    });
}
/** True for a kind the microphone caused — the set a "check your mic" message is correct for. */
export declare function isMicError(error: unknown): boolean;
/**
 * Classify a `getUserMedia` / mic-pipeline failure. This is THE table — it existed four times
 * across our surfaces before this, with drifting coverage.
 *
 * It classifies the ERROR and nothing else. An earlier draft also sniffed
 * `navigator.mediaDevices` here, which made the same error map differently depending on the
 * runtime — surprising, and untestable outside a browser. "This browser cannot capture audio at
 * all" is a pre-flight question, and {@link AvatarSession.preflight} asks it explicitly.
 */
export declare function classifyMicError(error: unknown): AvatarErrorKind;
/** Wrap anything into an AvatarError, preserving an already-classified one. */
export declare function toAvatarError(error: unknown, kind: AvatarErrorKind, options?: {
    terminal?: boolean;
    message?: string;
}): AvatarError;
