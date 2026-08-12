/** Jitter-buffered PCM player for the v2 avatar-audio channel.
 *
 * AudioBufferSourceNode scheduling is deliberately used instead of another worklet: audio frames
 * are normally 50-100 ms, so scheduling ten-ish nodes/second is inexpensive and keeps the
 * published SDK's existing worklet URL backward-compatible.
 *
 * Each enqueued frame carries its wire `pts_us` (server session clock), tracked per scheduled
 * source so `interruption {cutoff_pts_us}` can drop exactly the unheard tail and `playout_ack`
 * can report what is actually playing.
 */
export interface PcmFrame {
    pcm: Int16Array;
    sampleRate: number;
    ptsUs: number;
}
export declare class PcmPlayer {
    private readonly onBlocked?;
    private ctx;
    private nextStart;
    private readonly scheduled;
    private lastEndedPtsUs;
    private blocked;
    constructor(onBlocked?: (() => void) | undefined);
    enqueue(frame: PcmFrame): void;
    /** Stop every scheduled source whose frame starts at/after `cutoffUs` on the session clock
     *  (the interruption contract: the user has not heard past the cutoff, so drop it). */
    flushFrom(cutoffUs: number): void;
    flush(): void;
    /** Session-clock position (µs) of what the speaker is emitting right now: interpolated inside
     *  the currently playing source, else the end of the last finished one. */
    playedPtsUs(): number;
    /** Audio queued ahead of the playhead, in ms. */
    bufferedMs(): number;
    unmute(): boolean;
    stop(): void;
    private recomputeNextStart;
    private ensureContext;
}
