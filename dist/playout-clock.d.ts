/** Media-independent view of what the local user has actually heard/seen. */
export interface PlayoutClock {
    /** Current server media-timeline position, or null before a local playhead exists. */
    playedPtsUs(): number | null;
    /** Media queued ahead of the playhead. */
    bufferedMs(): number;
    /** Subscribe to playhead progress, seeks, resumes, and scheduling changes. */
    onAdvance(handler: () => void): () => void;
    /** Remove unheard media at and after a server-timeline cutoff. */
    discardFrom(cutoffPtsUs: number): Promise<void>;
}
