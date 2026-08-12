export interface MseHandlers {
    onFirstFrame?: () => void;
    onError?: (err: unknown) => void;
    /** Playback continues muted because the browser refused unmuted playback (iOS Safari pauses
     *  an autoplaying video on a scripted unmute). Surface a tap-for-sound affordance and call
     *  unmuteAudio() from the tap's gesture context. */
    onAudioBlocked?: () => void;
}
/**
 * MSE playback for the v2 avatar-video channel. Owns no socket: the v2 driver feeds it the
 * declared mime (from `accept.channels`) via setMime() and raw fMP4 payloads (MEDIA_INIT then
 * MEDIA frames) via append(). Everything else — buffering, live-edge chasing, eviction, the
 * pause watchdog, the rVFC media-time calibration — is unchanged from the v1 player.
 */
export declare class MsePlayer {
    private readonly video;
    private readonly dev;
    static supported(): boolean;
    private ms;
    private sb;
    private mime;
    private readonly pending;
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
    private rvfcHandle;
    private fireFirstFrame;
    constructor(video: HTMLVideoElement, dev?: boolean);
    /** Create the MediaSource and arm the element. Call once, then setMime() + append(). */
    attach(handlers?: MseHandlers): void;
    /** Declare the stream's MSE mime (from the accept's video channel descriptor). */
    setMime(mime: string): void;
    /** Append one fMP4 payload (init segment or media segment, in wire order). */
    append(bytes: Uint8Array): void;
    /** Re-arms itself each callback (rVFC only fires once per registration) to keep sampling the
     *  mediaTime <-> performanceTime relationship for the life of playback. No-op where unsupported
     *  (e.g. older Firefox) — mediaTimeAt() then always returns null, same as before any frame has
     *  displayed. */
    private scheduleFrameCallback;
    /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
     *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
     *  change handling). Returns null before the first displayed frame. */
    mediaTimeAt(performanceTimeMs: number): number | null;
    private setAudioBlocked;
    /** Unmute from a user-gesture context (e.g. a tap-for-sound button). Also resumes playback
     *  if the element is paused. Returns whether audio is now unblocked. */
    unmuteAudio(): boolean;
    private trySetup;
    private drain;
    private housekeep;
    stop(): void;
}
