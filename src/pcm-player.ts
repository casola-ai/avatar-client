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

interface Scheduled {
  source: AudioBufferSourceNode;
  startCtxTime: number;
  durationSec: number;
  ptsUs: number;
}

export interface PcmFrame {
  pcm: Int16Array;
  sampleRate: number;
  ptsUs: number;
}

export class PcmPlayer implements PlayoutClock {
  private ctx: AudioContext | null = null;
  private nextStart = 0;
  private readonly scheduled = new Set<Scheduled>();
  private lastEndedPtsUs = 0;
  private blocked = false;
  private readonly advanceHandlers = new Set<() => void>();
  private advanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onBlocked?: () => void) {}

  enqueue(frame: PcmFrame): void {
    if (frame.pcm.length === 0 || frame.sampleRate <= 0) return;
    const ctx = this.ensureContext();
    const audio = ctx.createBuffer(1, frame.pcm.length, frame.sampleRate);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < frame.pcm.length; i++) channel[i] = (frame.pcm[i] ?? 0) / 32768;

    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.04, this.nextStart);
    const entry: Scheduled = {
      source,
      startCtxTime: startAt,
      durationSec: audio.duration,
      ptsUs: frame.ptsUs,
    };
    source.addEventListener('ended', () => {
      if (this.scheduled.delete(entry)) {
        this.lastEndedPtsUs = Math.max(
          this.lastEndedPtsUs,
          entry.ptsUs + entry.durationSec * 1_000_000
        );
      }
      this.emitAdvance();
    });
    this.scheduled.add(entry);
    source.start(startAt);
    this.nextStart = startAt + audio.duration;
    this.emitAdvance();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        if (!this.blocked) {
          this.blocked = true;
          this.onBlocked?.();
        }
      });
    }
  }

  /** Stop queued frames and trim a source whose samples straddle the exact cutoff. */
  flushFrom(cutoffUs: number): void {
    for (const entry of [...this.scheduled]) {
      const endPtsUs = entry.ptsUs + entry.durationSec * 1_000_000;
      if (endPtsUs <= cutoffUs) continue;
      if (entry.ptsUs >= cutoffUs) {
        try {
          entry.source.stop();
        } catch {
          /* already ended */
        }
        this.scheduled.delete(entry);
        continue;
      }
      // The cutoff is inside this AudioBufferSourceNode. Web Audio stop(when) is sample-accurate;
      // cap the tracked duration too so ack/buffering never reports the discarded tail.
      const keptSec = Math.max(0, (cutoffUs - entry.ptsUs) / 1_000_000);
      entry.durationSec = keptSec;
      const stopAt = entry.startCtxTime + keptSec;
      try {
        entry.source.stop(Math.max(this.ctx?.currentTime ?? stopAt, stopAt));
      } catch {
        /* already ended */
      }
    }
    this.recomputeNextStart();
    this.emitAdvance();
  }

  async discardFrom(cutoffPtsUs: number): Promise<void> {
    this.flushFrom(cutoffPtsUs);
  }

  flush(): void {
    for (const entry of this.scheduled) {
      try {
        entry.source.stop();
      } catch {
        /* already ended */
      }
    }
    this.scheduled.clear();
    this.nextStart = this.ctx?.currentTime ?? 0;
    this.emitAdvance();
  }

  /** Session-clock position (µs) of what the speaker is emitting right now: interpolated inside
   *  the currently playing source, else the end of the last finished one. */
  playedPtsUs(): number | null {
    const now = this.ctx?.currentTime ?? 0;
    let played = this.lastEndedPtsUs;
    let hasPlayhead = this.lastEndedPtsUs > 0;
    for (const entry of this.scheduled) {
      if (entry.startCtxTime > now) continue;
      hasPlayhead = true;
      const into = Math.min(now - entry.startCtxTime, entry.durationSec);
      played = Math.max(played, entry.ptsUs + into * 1_000_000);
    }
    return hasPlayhead ? Math.round(played) : null;
  }

  /** Audio queued ahead of the playhead, in ms. */
  bufferedMs(): number {
    const now = this.ctx?.currentTime ?? 0;
    return Math.max(0, Math.round((this.nextStart - now) * 1000));
  }

  unmute(): boolean {
    this.blocked = false;
    if (!this.ctx) return true;
    void this.ctx.resume().catch(() => {});
    return this.ctx.state !== 'suspended';
  }

  stop(): void {
    this.flush();
    if (this.advanceTimer) clearInterval(this.advanceTimer);
    this.advanceTimer = null;
    this.advanceHandlers.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private recomputeNextStart(): void {
    const now = this.ctx?.currentTime ?? 0;
    let end = now;
    for (const entry of this.scheduled) {
      end = Math.max(end, entry.startCtxTime + entry.durationSec);
    }
    this.nextStart = end;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  onAdvance(handler: () => void): () => void {
    this.advanceHandlers.add(handler);
    if (!this.advanceTimer) {
      this.advanceTimer = setInterval(() => this.emitAdvance(), 16);
    }
    return () => {
      this.advanceHandlers.delete(handler);
      if (this.advanceHandlers.size === 0 && this.advanceTimer) {
        clearInterval(this.advanceTimer);
        this.advanceTimer = null;
      }
    };
  }

  private emitAdvance(): void {
    for (const handler of this.advanceHandlers) handler();
  }
}
