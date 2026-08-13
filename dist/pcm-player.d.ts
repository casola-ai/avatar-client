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
import type { PlayoutClock } from './playout-clock';
export interface PcmFrame {
    pcm: Int16Array;
    sampleRate: number;
    ptsUs: number;
}
export declare class PcmPlayer implements PlayoutClock {
    private readonly onBlocked?;
    private ctx;
    private nextStart;
    private readonly scheduled;
    private lastEndedPtsUs;
    private blocked;
    private readonly advanceHandlers;
    private advanceTimer;
    constructor(onBlocked?: (() => void) | undefined);
    enqueue(frame: PcmFrame): void;
    /** Stop queued frames and trim a source whose samples straddle the exact cutoff. */
    flushFrom(cutoffUs: number): void;
    discardFrom(cutoffPtsUs: number): Promise<void>;
    flush(): void;
    /** Session-clock position (µs) of what the speaker is emitting right now: interpolated inside
     *  the currently playing source, else the end of the last finished one. */
    playedPtsUs(): number | null;
    /** Audio queued ahead of the playhead, in ms. */
    bufferedMs(): number;
    unmute(): boolean;
    stop(): void;
    private recomputeNextStart;
    private ensureContext;
    onAdvance(handler: () => void): () => void;
    private emitAdvance;
}
