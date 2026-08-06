import type { Turn } from './mic-capture';
import type { WidgetState } from './state';
export type { Turn, WidgetState };
export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';
export interface EdgeTarget {
    mseWsUrl: string;
    micWsUrl: string;
    sessionCapSeconds?: number;
}
export interface ConnectHandlers {
    onStatus?(s: {
        phase: 'open';
    }): void;
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
    lang?: string;
    /** Initial ASR language pin (box language names, e.g. ['English']). [] / omitted = auto-detect. */
    langs?: string[];
    /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
     *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
     *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
    responseLanguage?: string;
    workletUrl?: string;
    prewarm?: () => Promise<void> | void;
    dev?: boolean;
    /** Mic uplink. Default true. Set false for a RECEIVE-ONLY session: MSE video+audio plays
     *  down, but no microphone is opened (no getUserMedia prompt, no worklet needed). User input
     *  then arrives through sendText(). A fallback edge opens a receive-only control/audio socket
     *  after transport negotiation; GPU sessions use `textTransport`. */
    mic?: boolean;
    /** Legacy text transport used when the assigned GPU edge does not advertise in-band text.
     *  First-party BFFs can provide their existing same-origin `/chat` relay here. */
    textTransport?: (text: string) => Promise<string>;
    /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
    permittedStream?: MediaStream;
    callbacks?: {
        onStateChange?(next: WidgetState, prev: WidgetState): void;
        /**
         * @deprecated Named for a capacity queue the platform no longer has (a full fleet 503s the
         *  mint instead). Fires only if a ConnectStrategy calls `onStatus`, and `connectViaToken` —
         *  the only shipping strategy — never does. Retained for API compatibility and will be removed
         *  in the next major; don't build on it. If a real queue is reintroduced it will ship under a
         *  new, purpose-named callback rather than reviving this one.
         */
        onQueueStatus?(s: {
            phase: 'open';
        }): void;
        onPartial?(text: string): void;
        onTurn?(t: Turn): void;
        onFirstFrame?(): void;
        /** Fired when the microphone uplink is open and ready to receive the user's speech. */
        onMicReady?(): void;
        /** Fired once per outgoing 100ms mic frame with the same correlation fields sent in its wire
         *  header (specs/av-sync-timestamps-notes.md sections 2-4) — analytics/debugging hook, not
         *  required for normal operation. `videoMediaTimeMs` is the wire's unknown sentinel
         *  (0xFFFFFFFF) before the avatar video has displayed its first frame. */
        onAudioFrameSent?(info: {
            micSeq: number;
            videoMediaTimeMs: number;
            captureEpochMs: number;
        }): void;
        /** Video continues muted because the browser refused unmuted playback (iOS Safari). Show a
         *  tap-for-sound affordance and call unmuteAudio() from the tap. */
        onAudioBlocked?(): void;
        onClose?(r: EndReason): void;
        /** Fired on a terminal session failure (connect/media setup) AND on non-terminal mic-uplink
         *  errors (mic socket error, server error frame) so a dead microphone is never silent. For
         *  mic errors the video + session keep running; inspect the error and decide whether to warn
         *  or leave(). getUserMedia denial and a failed worklet load surface here too (they reject
         *  start() → terminal). Pre-flight the mic with AvatarSession.ensureMicPermission() to catch
         *  permission problems before you spend a GPU seat. */
        onError?(e: unknown): void;
    };
}
export declare class AvatarSession {
    private readonly opts;
    private readonly sm;
    private mse;
    private mic;
    private done;
    private _sessionCapSeconds;
    private permittedStream;
    private langs;
    private _responseLanguage;
    private fallbackInBandText;
    constructor(opts: AvatarSessionOpts);
    get state(): WidgetState;
    get sessionCapSeconds(): number | undefined;
    static ensureMicPermission(): Promise<MediaStream>;
    static mediaSupported(): boolean;
    start(): Promise<void>;
    private openMedia;
    private openReceiveOnlyTransport;
    leave(): void;
    setMuted(muted: boolean): void;
    /** Send a typed user turn through the active session. Workers fallback sessions use their
     *  in-band WebSocket; GPU sessions use the optional application-supplied textTransport. */
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
     *  session (and any socket reconnect). [] = auto-detect across the box's configured set. */
    setLangs(langs: string[]): void;
    get asrLangs(): string[];
    /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
     *  own choice). Applies from the next turn and persists for the session (and any socket
     *  reconnect). Distinct from setLangs (ASR recognition pin). */
    setResponseLanguage(lang: string): void;
    get responseLanguage(): string | undefined;
    destroy(): void;
    private internalEnd;
    private internalFail;
    private teardown;
}
