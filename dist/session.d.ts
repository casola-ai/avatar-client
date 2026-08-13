import { AvatarError } from './errors';
import type { WidgetState } from './state';
import type { TimedUtterance } from './utterance-scheduler';
import { type DriverSocket, type EndReason, type Turn } from './v2/driver';
export type { EndReason, Turn, WidgetState };
/** What {@link AvatarSession.preflight} found. `ok: false` carries the classified reason, so a
 *  host picks copy from `error.kind` instead of sniffing DOMException names itself. */
export type PreflightResult = {
    ok: true;
    stream: MediaStream | null;
    video: boolean;
} | {
    ok: false;
    error: AvatarError;
};
/**
 * Why the microphone is (or is not) muted. `userMuted` is what the person chose; `suppressed` is
 * the application temporarily holding the mic closed — driving a scripted turn, playing an
 * interstitial. `effective` is what the wire is doing. Keeping them apart is what lets a mute
 * button reflect intent instead of being fought by the app's own `setMuted` calls.
 */
export interface MicMuteState {
    userMuted: boolean;
    suppressed: boolean;
    effective: boolean;
}
/** Calibration for one outgoing mic frame — see `callbacks.onAudioFrameSent`. */
export interface MicFrameSentInfo {
    micSeq: number;
    videoMediaTimeMs: number;
    captureEpochMs: number;
}
/**
 * The events {@link AvatarSession.on} exposes — the same moments the constructor `callbacks`
 * fire, addressable after construction so a helper can subscribe itself instead of the host
 * forwarding each one by hand.
 */
export interface AvatarSessionEvents {
    state: (next: WidgetState, prev: WidgetState) => void;
    partial: (text: string) => void;
    turn: (t: Turn) => void;
    firstFrame: () => void;
    micReady: () => void;
    speechStart: (speechId: string) => void;
    speechEnd: (speechId: string) => void;
    utteranceStart: (utterance: TimedUtterance) => void;
    utteranceText: (utterance: TimedUtterance) => void;
    utteranceEnd: (utterance: TimedUtterance) => void;
    mediaDiscarded: (cutoffPtsUs: number) => void;
    audioFrameSent: (info: MicFrameSentInfo) => void;
    audioBlocked: () => void;
    /** The microphone's mute state changed — from the user, or from `suppressMic`. */
    muteChange: (state: MicMuteState) => void;
    close: (r: EndReason) => void;
    error: (e: AvatarError) => void;
}
type EventName = keyof AvatarSessionEvents;
export interface EdgeTarget {
    /** The box's `/v2/session` WebSocket URL, session token included. */
    sessionWsUrl: string;
    /** Seconds until the mint's `expires_at` — superseded by the accept's `cap_seconds`. */
    sessionCapSeconds?: number;
}
export interface ConnectHandlers {
    onReady(t: EdgeTarget): void;
    onEnded?(r: EndReason): void;
    onError?(e: unknown): void;
}
export interface ConnectStrategy {
    connect(h: ConnectHandlers): void;
    close(): void;
}
export interface AvatarSessionOpts {
    videoEl: HTMLVideoElement;
    connect: ConnectStrategy;
    /** Initial ASR language pin (box language names, e.g. ['English']). [] / omitted = auto-detect. */
    langs?: string[];
    /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
     *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
     *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
    responseLanguage?: string;
    workletUrl?: string;
    prewarm?: () => Promise<void> | void;
    dev?: boolean;
    /** Mic uplink. Default true. Set false for a RECEIVE-ONLY session: the hello omits `mic`, no
     *  microphone is opened (no getUserMedia prompt, no worklet needed), and user input arrives
     *  through sendText() over the same session socket. */
    mic?: boolean;
    /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
    permittedStream?: MediaStream;
    /** Test seam for the session WebSocket — see V2Driver. */
    createSocket?: (url: string, protocols: string[]) => DriverSocket;
    callbacks?: {
        onStateChange?(next: WidgetState, prev: WidgetState): void;
        onPartial?(text: string): void;
        onTurn?(t: Turn): void;
        onFirstFrame?(): void;
        /** Fired when the microphone pipeline is capturing and the session is ready for speech. */
        onMicReady?(): void;
        /** The box marked the start of an assistant utterance (speech_id groups its turn/audio). */
        onSpeechStart?(speechId: string): void;
        onSpeechEnd?(speechId: string): void;
        /** Fired only when the local playout clock reaches the timed utterance boundary. */
        onUtteranceStart?(utterance: TimedUtterance): void;
        onUtteranceText?(utterance: TimedUtterance): void;
        onUtteranceEnd?(utterance: TimedUtterance): void;
        /** Diagnostic hook fired after local interruption media removal completes. */
        onMediaDiscarded?(cutoffPtsUs: number): void;
        /** Fired once per outgoing 100ms mic frame with its capture calibration — analytics/debugging
         *  hook, not required for normal operation. `videoMediaTimeMs` is the unknown sentinel
         *  (0xFFFFFFFF) before the avatar video has displayed its first frame (always, in poster
         *  mode); on the wire that is sent as `pts_us = 0`. */
        onAudioFrameSent?(info: {
            micSeq: number;
            videoMediaTimeMs: number;
            captureEpochMs: number;
        }): void;
        /** Media continues muted because the browser refused unmuted playback (iOS Safari). Show a
         *  tap-for-sound affordance and call unmuteAudio() from the tap. */
        onAudioBlocked?(): void;
        onClose?(r: EndReason): void;
        /** Fired on a terminal session failure (connect/handshake/mic setup) AND on non-terminal
         *  in-band errors (server error message, media hiccup) so a degraded session is never
         *  silent. Branch on `e.kind` — `e.terminal` says whether the session is over. Showing
         *  microphone copy for every error is wrong: a box that cannot bind the pinned avatar
         *  arrives here as `persona-unavailable`, not as anything the user's mic can fix.
         *  Pre-flight with AvatarSession.preflight() to catch permission problems before a seat. */
        onError?(e: AvatarError): void;
    };
}
export declare class AvatarSession {
    private readonly opts;
    private readonly sm;
    private driver;
    private done;
    private _sessionCapSeconds;
    private _personaKey;
    private permittedStream;
    private langs;
    private _responseLanguage;
    private _userMuted;
    private _micSuppressed;
    private readonly listeners;
    constructor(opts: AvatarSessionOpts);
    /**
     * Subscribe to a session event. Returns an unsubscribe function.
     *
     * The constructor's `callbacks` still work and fire first; this exists because a callback bag
     * fixed at construction cannot be joined later, which forced every host to hand-forward events
     * into helpers like `attachCaptions`. A throwing handler is caught and never breaks the session
     * or the other subscribers.
     *
     * ```ts
     * const off = session.on('turn', (t) => captions.turn(t));
     * // …later
     * off();
     * ```
     */
    on<K extends EventName>(event: K, handler: AvatarSessionEvents[K]): () => void;
    /** Fire the matching constructor callback, then every subscriber. */
    private emit;
    get state(): WidgetState;
    get sessionCapSeconds(): number | undefined;
    /** The avatar_versions.id the box bound, echoed in the accept (the persona-pinning ack). */
    get personaKey(): string | undefined;
    static ensureMicPermission(): Promise<MediaStream>;
    /** Whether this browser can play the fMP4 video channel. Poster-mode sessions (audio + still)
     *  work regardless — the hello simply doesn't offer video. */
    static mediaSupported(): boolean;
    /**
     * Everything that must be true before spending a fleet seat, in one call: microphone permission,
     * MSE support, and the browser gate — returning a classified result instead of a raw
     * DOMException.
     *
     * Hold the returned `stream` and pass it as `permittedStream` so the session does not call
     * getUserMedia twice (a second permission prompt on Firefox). `video: false` means poster mode
     * is the only option here; that is a degradation, not a failure, so `ok` stays true.
     *
     * ```ts
     * const pre = await AvatarSession.preflight();
     * if (!pre.ok) return showError(COPY.errors[pre.error.kind] ?? COPY.errors.generic);
     * new AvatarSession({ permittedStream: pre.stream ?? undefined, ... });
     * ```
     */
    static preflight(options?: {
        mic?: boolean;
    }): Promise<PreflightResult>;
    start(): Promise<void>;
    private openSession;
    leave(): void;
    /** The user's choice — what a mute button sets. Survives `suppressMic`. */
    setMuted(muted: boolean): void;
    /**
     * Hold the microphone closed without changing the user's choice, and release it back to
     * whatever they had set. Use this around app-driven turns rather than calling `setMuted(true)`
     * then `setMuted(previous)` — that pattern loses the user's intent whenever the two interleave,
     * and it fights any UI bound to the mute state.
     */
    suppressMic(suppressed: boolean): void;
    /** What the user chose, ignoring any active suppression. */
    get userMuted(): boolean;
    /** Whether the application is currently holding the mic closed. */
    get micSuppressed(): boolean;
    /** What the wire is actually doing: the user's choice OR an active suppression. */
    get micMuted(): boolean;
    private applyMic;
    /** Send a typed user turn through the session socket. Resolves with the box's reply. */
    sendText(text: string): Promise<Turn>;
    /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
     *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
    unmuteAudio(): boolean;
    /** Avatar voice still queued to play, in ms, or `null` when this session has no playout clock
     *  to ask — a video session or one that has not accepted yet. `null` is "unknown", not "none".
     *
     *  Intended for `attachCaptions`'s `remainingVoiceMs`, which needs to know how much voice is
     *  left when an utterance ends so it can time the words it has not revealed yet. */
    bufferedVoiceMs(): number | null;
    /** Current local playout position on the server media timeline. Null before playback starts. */
    playedPtsUs(): number | null;
    /** Call synchronously inside the click/tap handler that starts a call, BEFORE any await:
     *  a user-gestured play()/load() clears WebKit's per-element gesture restrictions so the
     *  SDK's scripted unmute isn't answered with a pause on iOS Safari (which otherwise turns
     *  the first call in a fresh browsing context into a muted ~2fps slideshow). */
    static primeVideoElement(video: HTMLVideoElement): void;
    /** Change the ASR recognition language(s) — applies live mid-session and persists for the
     *  session. [] = auto-detect across the box's configured set. */
    setLangs(langs: string[]): void;
    get asrLangs(): string[];
    /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
     *  own choice). Applies from the next turn and persists for the session. Distinct from
     *  setLangs (ASR recognition pin). */
    setResponseLanguage(lang: string): void;
    /** Replace hidden system-level guidance for subsequent turns. Unlike sendText(), this does not
     *  create a user message, request an immediate response, or surface in transcript callbacks. */
    setRuntimeInstruction(instruction: string): void;
    get responseLanguage(): string | undefined;
    destroy(): void;
    private internalEnd;
    private internalFail;
    private teardown;
}
