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

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextStart = 0;
  private readonly scheduled = new Set<Scheduled>();
  private lastEndedPtsUs = 0;
  private blocked = false;

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
    });
    this.scheduled.add(entry);
    source.start(startAt);
    this.nextStart = startAt + audio.duration;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        if (!this.blocked) {
          this.blocked = true;
          this.onBlocked?.();
        }
      });
    }
  }

  /** Stop every scheduled source whose frame starts at/after `cutoffUs` on the session clock
   *  (the interruption contract: the user has not heard past the cutoff, so drop it). */
  flushFrom(cutoffUs: number): void {
    for (const entry of [...this.scheduled]) {
      if (entry.ptsUs < cutoffUs) continue;
      try {
        entry.source.stop();
      } catch {
        /* already ended */
      }
      this.scheduled.delete(entry);
    }
    this.recomputeNextStart();
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
  }

  /** Session-clock position (µs) of what the speaker is emitting right now: interpolated inside
   *  the currently playing source, else the end of the last finished one. */
  playedPtsUs(): number {
    const now = this.ctx?.currentTime ?? 0;
    let played = this.lastEndedPtsUs;
    for (const entry of this.scheduled) {
      if (entry.startCtxTime > now) continue;
      const into = Math.min(now - entry.startCtxTime, entry.durationSec);
      played = Math.max(played, entry.ptsUs + into * 1_000_000);
    }
    return Math.round(played);
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
}
