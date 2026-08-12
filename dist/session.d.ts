import type { WidgetState } from './state';
import { type DriverSocket, type EndReason, type Turn } from './v2/driver';
export type { EndReason, Turn, WidgetState };
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
         *  silent. For non-terminal errors the session keeps running; inspect the error and decide
         *  whether to warn or leave(). getUserMedia denial and a failed worklet load are terminal.
         *  Pre-flight the mic with AvatarSession.ensureMicPermission() to catch permission problems
         *  before you spend a seat. */
        onError?(e: unknown): void;
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
    constructor(opts: AvatarSessionOpts);
    get state(): WidgetState;
    get sessionCapSeconds(): number | undefined;
    /** The avatar_versions.id the box bound, echoed in the accept (the persona-pinning ack). */
    get personaKey(): string | undefined;
    static ensureMicPermission(): Promise<MediaStream>;
    /** Whether this browser can play the fMP4 video channel. Poster-mode sessions (audio + still)
     *  work regardless — the hello simply doesn't offer video. */
    static mediaSupported(): boolean;
    start(): Promise<void>;
    private openSession;
    leave(): void;
    setMuted(muted: boolean): void;
    /** Send a typed user turn through the session socket. Resolves with the box's reply. */
    sendText(text: string): Promise<Turn>;
    /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
     *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
    unmuteAudio(): boolean;
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
