import type { PlayoutClock } from './playout-clock';
import type {
  UtteranceEndMessage,
  UtteranceEndReason,
  UtteranceStartMessage,
  UtteranceTextMessage,
} from './protocol';

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

interface Entry extends TimedUtterance {
  status: 'pending' | 'active';
}

/**
 * Queues socket-arrival-time utterance metadata against a local media playhead. No public event
 * is emitted merely because a cue arrived: only clock advancement can make pending text visible.
 */
export class UtteranceScheduler {
  private readonly entries = new Map<string, Entry>();
  private readonly cancelled = new Set<string>();
  private activeId: string | null = null;
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(
    private readonly clock: PlayoutClock,
    private readonly handlers: UtteranceSchedulerHandlers
  ) {
    this.unsubscribe = clock.onAdvance(() => this.advance());
  }

  receiveStart(message: UtteranceStartMessage): void {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const previous = this.entries.get(message.utterance_id);
    if (previous?.status === 'active') return;
    this.entries.set(message.utterance_id, {
      turnId: message.turn_id,
      utteranceId: message.utterance_id,
      startPtsUs: message.start_pts_us,
      text: message.text,
      textFinal: message.text_final,
      language: message.language,
      revision: previous?.revision ?? -1,
      endPtsUs: previous?.endPtsUs,
      reason: previous?.reason,
      status: 'pending',
    });
  }

  receiveText(message: UtteranceTextMessage): void {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const entry = this.entries.get(message.utterance_id);
    if (!entry || entry.turnId !== message.turn_id || message.revision <= entry.revision) return;
    entry.revision = message.revision;
    entry.text = message.text;
    entry.textFinal = message.final;
    if (entry.status === 'active') this.handlers.onText(this.snapshot(entry));
  }

  receiveEnd(message: UtteranceEndMessage): void {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const entry = this.entries.get(message.utterance_id);
    if (!entry || entry.turnId !== message.turn_id) return;
    entry.endPtsUs = message.end_pts_us;
    entry.reason = message.reason;
  }

  /** Cancel unheard affected cues and close a visible utterance at the local cutoff playhead. */
  interrupt(cutoffPtsUs: number, utteranceIds: readonly string[]): void {
    if (this.stopped) return;
    const affected = new Set(utteranceIds);
    for (const utteranceId of affected) {
      this.cancelled.add(utteranceId);
      const entry = this.entries.get(utteranceId);
      if (!entry) continue;
      if (entry.status === 'active') {
        entry.endPtsUs = cutoffPtsUs;
        entry.reason = 'interrupted';
        continue;
      }
      this.entries.delete(utteranceId);
    }
    // A late interruption may already be behind the observed playhead. Otherwise the clock's
    // next advancement ends the caption exactly when the retained prefix finishes playing.
    this.advance();
  }

  advance(): void {
    if (this.stopped) return;
    const played = this.clock.playedPtsUs();
    if (played === null) return;

    const active = this.activeId ? this.entries.get(this.activeId) : undefined;
    if (active?.endPtsUs !== undefined && played >= active.endPtsUs) {
      this.handlers.onEnd(this.snapshot(active));
      this.entries.delete(active.utteranceId);
      this.activeId = null;
    }

    // A background resume or live-edge seek may leap over whole utterances. Drop those pending
    // intervals instead of flashing stale text for a single observation quantum.
    for (const [id, entry] of this.entries) {
      if (entry.status === 'pending' && entry.endPtsUs !== undefined && played >= entry.endPtsUs) {
        this.entries.delete(id);
      }
    }

    const candidates = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.status === 'pending' &&
          played >= entry.startPtsUs &&
          (entry.endPtsUs === undefined || played < entry.endPtsUs)
      )
      .sort((a, b) => a.startPtsUs - b.startPtsUs);
    const next = candidates.at(-1);
    if (!next) return;

    const prior = this.activeId ? this.entries.get(this.activeId) : undefined;
    if (prior && prior.utteranceId !== next.utteranceId) {
      prior.reason ??= 'replaced';
      prior.endPtsUs ??= next.startPtsUs;
      this.handlers.onEnd(this.snapshot(prior));
      this.entries.delete(prior.utteranceId);
    }
    next.status = 'active';
    this.activeId = next.utteranceId;
    this.handlers.onStart(this.snapshot(next));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    this.entries.clear();
    this.cancelled.clear();
    this.activeId = null;
  }

  private snapshot(entry: Entry): TimedUtterance {
    return {
      turnId: entry.turnId,
      utteranceId: entry.utteranceId,
      startPtsUs: entry.startPtsUs,
      ...(entry.endPtsUs === undefined ? {} : { endPtsUs: entry.endPtsUs }),
      ...(entry.text === undefined ? {} : { text: entry.text }),
      textFinal: entry.textFinal,
      ...(entry.language === undefined ? {} : { language: entry.language }),
      revision: entry.revision,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    };
  }
}
