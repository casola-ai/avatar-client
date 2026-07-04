export type WidgetState = 'idle' | 'selecting' | 'verifying' | 'waiting' | 'ready' | 'connecting' | 'live' | 'ended' | 'error';
export type Listener = (state: WidgetState, prev: WidgetState) => void;
export declare class StateMachine {
    private readonly dev;
    private current;
    private readonly listeners;
    constructor(dev?: boolean);
    get state(): WidgetState;
    set(next: WidgetState): void;
    onChange(cb: Listener): () => void;
}
