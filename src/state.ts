export type WidgetState =
  | 'idle'
  | 'selecting'
  | 'verifying'
  | 'waiting'
  | 'ready'
  | 'connecting'
  | 'live'
  | 'ended'
  | 'error';

const ALLOWED: Record<WidgetState, WidgetState[]> = {
  idle: ['selecting', 'verifying', 'waiting', 'error'],
  selecting: ['selecting', 'verifying', 'idle', 'error'],
  verifying: ['waiting', 'idle', 'error', 'ended'],
  waiting: ['ready', 'idle', 'ended', 'error'],
  ready: ['connecting', 'idle', 'ended', 'error'],
  connecting: ['live', 'idle', 'ended', 'error'],
  live: ['idle', 'ended', 'error'],
  ended: ['selecting', 'verifying', 'idle'],
  error: ['selecting', 'verifying', 'idle'],
};

export type Listener = (state: WidgetState, prev: WidgetState) => void;

export class StateMachine {
  private current: WidgetState = 'idle';
  private readonly listeners = new Set<Listener>();

  constructor(private readonly dev: boolean = false) {}

  get state(): WidgetState {
    return this.current;
  }

  set(next: WidgetState): void {
    const prev = this.current;
    if (prev === next) return;
    if (this.dev && !ALLOWED[prev].includes(next)) {
      console.warn(`[avatar] unexpected transition ${prev} → ${next}`);
    }
    this.current = next;
    for (const l of this.listeners) l(next, prev);
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
