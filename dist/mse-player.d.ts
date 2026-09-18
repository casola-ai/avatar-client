import type { DiagnosticData } from './diagnostics';
import { type Logger } from './logger';
import type { PlayoutClock } from './playout-clock';
import type { VideoCodec } from './protocol';
export interface MseHandlers {
    onFirstFrame?: () => void;
    onError?: (err: unknown) => void;
    /** Playback continues muted because the browser refused unmuted playback (iOS Safari pauses
     *  an autoplaying video on a scripted unmute). Surface a tap-for-sound affordance and call
     *  unmuteAudio() from the tap's gesture context. */
    onAudioBlocked?: () => void;
    /** Bounded playback diagnostics — `playback_rejected`, `media_error`, `buffer_evicted`, `stall`.
     *  Optional: absent leaves playback behavior unchanged. */
    onDiagnostic?: (d: DiagnosticData) => void;
}
/**
 * MSE playback for the v2 avatar-video channel. Owns no socket: the v2 driver feeds it the
 * declared mime (from `accept.channels`) via setMime() and raw fMP4 payloads (MEDIA_INIT then
 * MEDIA frames) via append(). Everything else — buffering, live-edge chasing, eviction, the
 * pause watchdog, the rVFC media-time calibration — is unchanged from the v1 player.
 */
export declare class MsePlayer implements PlayoutClock {
    private readonly video;
    static supported(): boolean;
    /**
     * The downlink video codecs this browser can DECODE, for `hello.video.codecs`. Probed against
     * the same MediaSource implementation the player will use (`ManagedMediaSource` on iOS), because
     * the two disagree: Safari's ManagedMediaSource plays HEVC the plain one does not offer. The
     * order is this list's, not a preference — the box owns the choice. `[]` where MSE is absent
     * (poster mode), so the hello simply omits the field and the box serves h264.
     */
    static decodableVideoCodecs(): VideoCodec[];
    private ms;
    private sb;
    private mime;
    private readonly pending;
    private activeAppend;
    private discarding;
    private sourceOpen;
    private streaming;
    private started;
    private firstFrameFired;
    private closed;
    private handlers;
    private startSeeked;
    private lastSeekAt;
    private audioBlocked;
    private resumeAttempts;
    private watchdogListeners;
    private readonly mediaTimeMap;
    private mediaUnitDurationUs;
    private rvfcHandle;
    private lastPlayedPtsUs;
    private readonly advanceHandlers;
    private evictionCount;
    private diag;
    private fireFirstFrame;
    private readonly log;
    constructor(video: HTMLVideoElement, logger?: Logger);
    /** Create the MediaSource and arm the element. Call once, then setMime() + append(). */
    attach(handlers?: MseHandlers): void;
    /** Declare the stream's MSE mime (from the accept's video channel descriptor). */
    setMime(mime: string): void;
    /** Append one fMP4 payload (init segment or media segment, in wire order). */
    append(bytes: Uint8Array, ptsUs?: number, init?: boolean): void;
    /** Nominal complete-unit duration from the negotiated video channel descriptor. The rollout
     *  intentionally leaves duration out of the binary header, so this is what lets interruption
     *  reject a queued unit whose start precedes, but whose tail crosses, the cutoff. */
    setMediaUnitTiming(fps: number, segmentFrames: number): void;
    /** Re-arms itself each callback (rVFC only fires once per registration) to keep sampling the
     *  mediaTime <-> performanceTime relationship for the life of playback. No-op where unsupported
     *  (e.g. older Firefox) — mediaTimeAt() then always returns null, same as before any frame has
     *  displayed. */
    private scheduleFrameCallback;
    /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
     *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
     *  change handling). Returns null before the first displayed frame. */
    mediaTimeAt(performanceTimeMs: number): number | null;
    playedPtsUs(): number | null;
    bufferedMs(): number;
    onAdvance(handler: () => void): () => void;
    /** Remove queued and MSE-buffered media at/after the server-timeline cutoff. */
    discardFrom(cutoffPtsUs: number): Promise<void>;
    private setAudioBlocked;
    /** Unmute from a user-gesture context (e.g. a tap-for-sound button). Also resumes playback
     *  if the element is paused. Returns whether audio is now unblocked. */
    unmuteAudio(): boolean;
    private trySetup;
    private drain;
    private housekeep;
    stop(): void;
    private emitAdvance;
    private waitForIdle;
}
