import { type MediaFrame } from './protocol';
export interface MediaUnit {
    frameType: number;
    channelId: number;
    ptsUs: number;
    payload: Uint8Array;
}
/** Reassembles explicit UNIT_START/UNIT_END fragments before a codec sees their payload. */
export declare class MediaUnitAssembler {
    private readonly onDrop?;
    private readonly partial;
    /** `onDrop` is told why a fragment was discarded — a continuation with no start
     *  (`no_start`), or one whose header disagrees with the unit in progress (`mismatch`). These
     *  were dropped silently before (charmingly#288, §D). */
    constructor(onDrop?: ((reason: "no_start" | "mismatch") => void) | undefined);
    push(frame: MediaFrame): MediaUnit | null;
    discardFrom(cutoffPtsUs: number): void;
    clear(): void;
}
