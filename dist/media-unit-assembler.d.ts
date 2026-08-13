import { type MediaFrame } from './protocol';
export interface MediaUnit {
    frameType: number;
    channelId: number;
    ptsUs: number;
    payload: Uint8Array;
}
/** Reassembles explicit UNIT_START/UNIT_END fragments before a codec sees their payload. */
export declare class MediaUnitAssembler {
    private readonly partial;
    push(frame: MediaFrame): MediaUnit | null;
    discardFrom(cutoffPtsUs: number): void;
    clear(): void;
}
