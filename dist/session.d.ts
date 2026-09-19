import { type AvatarDiagnostic, type AvatarSessionStats, type NegotiatedInfo } from './diagnostics';
import { AvatarError } from './errors';
import { type Logger } from './logger';
import { type MicBackingReason, type MicLevel } from './mic-pipeline';
export type { MicBackingReason, MicLevel } from './mic-pipeline';
import type { VideoCodec } from './protocol';
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
/** Whether the mic channel is backed by a capture stream, and why not when it is not. Unbacked,
 *  the session still sends zeroed frames on the mic cadence — the box hears silence, never a
 *  stalled clock — and `enableMic()` can back it later. */
export interface MicBackingState {
    backed: boolean;
    reason: MicBackingReason;
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
    /** The mic channel gained or lost its capture stream — a late permission grant attaching, a
     *  track that ended, an `enableMic()` that failed. Read `micBacked` for the current value. */
    micBacking: (state: MicBackingState) => void;
    /** The microphone's loudness, ~20 times a second while a stream backs the channel — for a level
     *  meter, or for noticing a microphone that is attached but hears nothing. Zeros while muted;
     *  silent (no events) while unbacked or while the capture context is not rendering. on()-only:
     *  there is no constructor callback for it. See `MicLevel`. */
    micLevel: (level: MicLevel) => void;
    /** A bounded operational fact about the session — see `AvatarDiagnostic`. Fires unguarded by the
     *  session's `done` flag, so `socket_closed` (which lands in the same tick as `close`) is not
     *  dropped. */
    diagnostic: (d: AvatarDiagnostic) => void;
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
    /** Initial ASR language pin as BCP-47 primary subtags, e.g. ['en'] or ['zh', 'en'].
     *  ONE entry forces the recogniser to that language; SEVERAL name the likely set and leave
     *  auto-detect on. [] / omitted = the session JWT's `spoken_languages` claim (if any), else
     *  auto-detect hinted by `response_language`. Language NAMES ('English') are also accepted by
     *  current boxes, but were silently DROPPED by every box before 2026-09-01 — send tags. */
    langs?: string[];
    /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
     *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
     *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
    responseLanguage?: string;
    workletUrl?: string;
    prewarm?: () => Promise<void> | void;
    dev?: boolean;
    /** Mic uplink. Default true: the hello declares the mic channel, and the channel stays up for
     *  the whole session whether or not a microphone is behind it (see `permittedStream`,
     *  `enableMic`, `micBacked`). Set false for a RECEIVE-ONLY session: the hello omits `mic`, no
     *  microphone is ever opened, and user input arrives through sendText() over the same socket. */
    mic?: boolean;
    /** Where the microphone comes from. A `MediaStream` from `ensureMicPermission()` attaches at
     *  the accept (and avoids a second getUserMedia prompt). A `Promise` is a stream the host is
     *  still waiting for — a permission prompt the visitor has not answered — and the session runs
     *  with zeroed mic frames until it resolves, then attaches it; a `null` resolution means the
     *  host chose not to prompt again (`enableMic()` still can). Omitted: the session asks
     *  getUserMedia itself at the accept. A refusal no longer ends the session either way: the
     *  channel stays unbacked and reports why (`micBacking`). */
    permittedStream?: MediaStream | Promise<MediaStream | null>;
    /** Mic uplink codec. Default `'auto'`: Opus (32 kbit/s, one packet per 100 ms frame) whenever
     *  this browser's WebCodecs `AudioEncoder` supports it and the box accepts it, else raw pcm16 —
     *  the box's accept decides, so an older box silently gets pcm16. `'pcm16'` never offers Opus:
     *  the opt-out if an encoder misbehaves somewhere. */
    micCodec?: 'auto' | 'pcm16';
    /** A quiet microphone costs almost nothing on the wire. Default true: the hello offers
     *  `mic_dtx_v1`, and where the box grants it a silent 100 ms window (a muted or unbacked
     *  channel, the pauses between sentences) goes out as an EMPTY frame — same cadence, same
     *  `seq`, no audio bytes; the box expands it to silence. `negotiated.micDtx` says whether it
     *  is in force and `stats().counters.micFramesEmpty` how often it fired. `false` never offers
     *  it (the opt-out if a box's endpointing were ever suspected of hearing the difference). */
    micDtx?: boolean;
    /** Downlink video codec. Default `'auto'`: the hello offers every codec this browser can decode
     *  (AV1 / HEVC / H.264) and the box picks the cheapest of those to ship — av1 is ~20–40 % fewer
     *  bits than h264 at equal quality. The box decides, so an older box silently serves h264.
     *  `'h264'` offers nothing: the opt-out if a platform's hardware decode misbehaves. */
    videoCodec?: 'auto' | 'h264';
    /** The mint's session id and a support trace id. Stamped on every `AvatarDiagnostic` so a report
     *  joins the mint and the support trace; never put on the wire. */
    sessionId?: string;
    traceId?: string;
    /** Where the SDK routes its internal logs (driver, players, pipeline, state). Absent = a
     *  dev-gated console, exactly the pre-logger behavior. */
    logger?: Logger;
    /** Test seam for the session WebSocket — see V2Driver. */
    createSocket?: (url: string, protocols: string[]) => DriverSocket;
    callbacks?: {
        onStateChange?(next: WidgetState, prev: WidgetState): void;
        onPartial?(text: string): void;
        onTurn?(t: Turn): void;
        onFirstFrame?(): void;
        /** Fired when the microphone pipeline is capturing and the session is ready for speech —
         *  on the first attach and on every later one (`enableMic`, a late `permittedStream`). */
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
        /** A bounded operational fact about the session (`AvatarDiagnostic`). Analytics/support hook,
         *  never required for normal operation. Branch on `d.type` and default-ignore an unrecognized
         *  one — the union grows. */
        onDiagnostic?(d: AvatarDiagnostic): void;
    };
}
export declare class AvatarSession {
    private readonly opts;
    private readonly sm;
    private driver;
    private done;
    private _sessionCapSeconds;
    private _personaKey;
    private _videoCodec;
    private permittedStream;
    private _micBacked;
    private langs;
    private _responseLanguage;
    private _userMuted;
    private _micSuppressed;
    private _negotiated;
    private readonly _stats;
    private readonly listeners;
    private readonly logger;
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
    /** The downlink video codec the box negotiated for this session (`'h264'` when it does not
     *  negotiate). `undefined` before the accept, and in poster mode, where there is no video. */
    get videoCodec(): VideoCodec | undefined;
    /** What the box negotiated for this session — the codecs in force, whether video plays. `null`
     *  before the accept. Diagnostics: the fixed shape a session landed in, beside the running
     *  counters in {@link stats}. */
    get negotiated(): NegotiatedInfo | null;
    /**
     * A snapshot of everything the diagnostic stream has said about this session so far: the connect
     * timeline, the close code, the last keepalive RTT, what was negotiated, and running counters.
     *
     * Safe to call after the session has ended — it is accumulated on the session as diagnostics
     * arrive, not read from the driver, which `teardown()` has already nulled by then.
     */
    stats(): AvatarSessionStats;
    /** Fold one diagnostic into the accumulated stats and capture the negotiated shape. Runs
     *  unguarded by `done` so the terminal `socket_closed` is counted. */
    private ingestDiagnostic;
    static ensureMicPermission(): Promise<MediaStream>;
    /** Whether this browser can play the fMP4 video channel. Poster-mode sessions (audio + still)
     *  work regardless — the hello simply doesn't offer video. */
    static mediaSupported(): boolean;
    /** The downlink video codecs this browser can decode, as offered in the hello under
     *  `videoCodec: 'auto'`. Diagnostics: what a host would report next to `session.videoCodec` to
     *  explain why a given session landed where it did. `[]` without MSE. */
    static decodableVideoCodecs(): VideoCodec[];
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
    /** Whether the frames on the mic channel are the microphone right now. `false` before the
     *  accept, in a receive-only session, while a promised stream is pending, after a refusal, and
     *  after the track ended — the wire then carries zeroed frames, or nothing at all. */
    get micBacked(): boolean;
    /**
     * Back the mic channel with a microphone, now: the `stream` given, or one asked of getUserMedia
     * (call this from a click or tap — iOS refuses a prompt outside a gesture). The wire switches
     * from zeroed frames to the microphone without a reconnect; `micReady` and `micBacking` fire.
     * Rejects with the raw getUserMedia/worklet error when the capture cannot come up, and when
     * the session has no mic channel (receive-only, not yet accepted, or ended). The channel is
     * unchanged either way.
     */
    enableMic(stream?: MediaStream): Promise<void>;
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
