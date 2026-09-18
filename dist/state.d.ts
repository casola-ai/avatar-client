export type WidgetState = 'idle' | 'selecting' | 'verifying' | 'waiting' | 'ready' | 'connecting' | 'live' | 'ended' | 'error';
export type Listener = (state: WidgetState, prev: WidgetState) => void;
import { type Logger } from './logger';
export declare class StateMachine {
    private current;
    private readonly listeners;
    private readonly log;
    constructor(logger?: Logger | boolean);
    get state(): WidgetState;
    set(next: WidgetState): void;
    onChange(cb: Listener): () => void;
}
