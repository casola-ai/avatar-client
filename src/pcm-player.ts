import type { PcmDownlinkFrame } from './pcm-downlink';

/** Small jitter-buffered PCM player for the Workers fallback transport.
 *
 * AudioBufferSourceNode scheduling is deliberately used instead of another worklet: fallback
 * frames are normally 50-100 ms, so scheduling ten-ish nodes/second is inexpensive and keeps the
 * published SDK's existing worklet URL backward-compatible.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextStart = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private blocked = false;

  constructor(private readonly onBlocked?: () => void) {}

  enqueue(frame: PcmDownlinkFrame): void {
    if (frame.pcm.length === 0 || frame.sampleRate <= 0) return;
    const ctx = this.ensureContext();
    const audio = ctx.createBuffer(1, frame.pcm.length, frame.sampleRate);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < frame.pcm.length; i++) channel[i] = (frame.pcm[i] ?? 0) / 32768;

    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);
    source.addEventListener('ended', () => this.sources.delete(source));
    this.sources.add(source);

    const startAt = Math.max(ctx.currentTime + 0.04, this.nextStart);
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

  flush(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources.clear();
    this.nextStart = this.ctx?.currentTime ?? 0;
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

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }
}
