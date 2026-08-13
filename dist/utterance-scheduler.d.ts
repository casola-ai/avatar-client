import type { PlayoutClock } from './playout-clock';
import type { UtteranceEndMessage, UtteranceEndReason, UtteranceStartMessage, UtteranceTextMessage } from './protocol';
export interface TimedUtterance {
    turnId: string;
    utteranceId: string;
    startPtsUs: number;
    endPtsUs?: number;
    text?: string;
    textFinal: boolean;
    language?: string;
    revision: number;
    reason?: UtteranceEndReason;
}
export interface UtteranceSchedulerHandlers {
    onStart(utterance: TimedUtterance): void;
    onText(utterance: TimedUtterance): void;
    onEnd(utterance: TimedUtterance): void;
}
/**
 * Queues socket-arrival-time utterance metadata against a local media playhead. No public event
 * is emitted merely because a cue arrived: only clock advancement can make pending text visible.
 */
export declare class UtteranceScheduler {
    private readonly clock;
    private readonly handlers;
    private readonly entries;
    private readonly cancelled;
    private activeId;
    private readonly unsubscribe;
    private stopped;
    constructor(clock: PlayoutClock, handlers: UtteranceSchedulerHandlers);
    receiveStart(message: UtteranceStartMessage): void;
    receiveText(message: UtteranceTextMessage): void;
    receiveEnd(message: UtteranceEndMessage): void;
    /** Cancel unheard affected cues and close a visible utterance at the local cutoff playhead. */
    interrupt(cutoffPtsUs: number, utteranceIds: readonly string[]): void;
    advance(): void;
    stop(): void;
    private snapshot;
}
