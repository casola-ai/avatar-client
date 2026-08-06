import type { EndReason } from './session';
export interface MseHandlers {
    onFirstFrame?: () => void;
    /** Edge transport negotiation. GPU boxes advertise `mime`; the Workers fallback advertises
     *  `poster-pcm`, allowing AvatarSession to open its in-band text/audio control socket. */
    onMode?: (mode: string) => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
    onEnded?: (reason: EndReason) => void;
    /** Playback continues muted because the browser refused unmuted playback (iOS Safari pauses
     *  an autoplaying video on a scripted unmute). Surface a tap-for-sound affordance and call
     *  unmuteAudio() from the tap's gesture context. */
    onAudioBlocked?: () => void;
}
export declare class MsePlayer {
    private readonly video;
    private readonly dev;
    static supported(): boolean;
    private ms;
    private sb;
    private ws;
    private pcmPlayer;
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
    connect(wsUrl: string, handlers?: MseHandlers): void;
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
    private openWs;
    private onMessage;
    private trySetup;
    private drain;
    private housekeep;
    stop(): void;
}
