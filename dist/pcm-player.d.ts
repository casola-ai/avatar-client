import type { PcmDownlinkFrame } from './pcm-downlink';
/** Small jitter-buffered PCM player for the Workers fallback transport.
 *
 * AudioBufferSourceNode scheduling is deliberately used instead of another worklet: fallback
 * frames are normally 50-100 ms, so scheduling ten-ish nodes/second is inexpensive and keeps the
 * published SDK's existing worklet URL backward-compatible.
 */
export declare class PcmPlayer {
    private readonly onBlocked?;
    private ctx;
    private nextStart;
    private readonly sources;
    private blocked;
    constructor(onBlocked?: (() => void) | undefined);
    enqueue(frame: PcmDownlinkFrame): void;
    flush(): void;
    unmute(): boolean;
    stop(): void;
    private ensureContext;
}
