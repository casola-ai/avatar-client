import { ClockMap } from './clock-map';
import type { PlayoutClock } from './playout-clock';

export interface MseHandlers {
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
  /** Playback continues muted because the browser refused unmuted playback (iOS Safari pauses
   *  an autoplaying video on a scripted unmute). Surface a tap-for-sound affordance and call
   *  unmuteAudio() from the tap's gesture context. */
  onAudioBlocked?: () => void;
}

type MediaSourceCtor = { new (): MediaSource };

interface PendingAppend {
  bytes: Uint8Array<ArrayBuffer>;
  ptsUs: number;
  init: boolean;
}

function getMediaSourceCtor(): MediaSourceCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    ManagedMediaSource?: MediaSourceCtor;
    MediaSource?: MediaSourceCtor;
  };
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}

/**
 * MSE playback for the v2 avatar-video channel. Owns no socket: the v2 driver feeds it the
 * declared mime (from `accept.channels`) via setMime() and raw fMP4 payloads (MEDIA_INIT then
 * MEDIA frames) via append(). Everything else — buffering, live-edge chasing, eviction, the
 * pause watchdog, the rVFC media-time calibration — is unchanged from the v1 player.
 */
export class MsePlayer implements PlayoutClock {
  static supported(): boolean {
    return getMediaSourceCtor() !== null;
  }

  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private mime: string | null = null;
  private readonly pending: PendingAppend[] = [];
  private activeAppend: PendingAppend | null = null;
  private discarding = false;
  private sourceOpen = false;
  private streaming = true;
  private started = false;
  private firstFrameFired = false;
  private closed = false;
  private handlers: MseHandlers = {};
  private startSeeked = false;
  private lastSeekAt = 0;
  private audioBlocked = false;
  private resumeAttempts = 0;
  private watchdogListeners: Array<[string, EventListener]> = [];
  private readonly mediaTimeMap = new ClockMap();
  private mediaUnitDurationUs: number | null = null;
  private rvfcHandle: number | null = null;
  private lastPlayedPtsUs: number | null = null;
  private readonly advanceHandlers = new Set<() => void>();

  private fireFirstFrame(): void {
    if (this.firstFrameFired) return;
    this.firstFrameFired = true;
    this.handlers.onFirstFrame?.();
  }

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly dev = false
  ) {}

  /** Create the MediaSource and arm the element. Call once, then setMime() + append(). */
  attach(handlers: MseHandlers = {}): void {
    this.handlers = handlers;
    const Ctor = getMediaSourceCtor();
    if (!Ctor) {
      handlers.onError?.(new Error('MediaSource unsupported'));
      return;
    }
    const ms = new Ctor();
    this.ms = ms;
    this.video.disableRemotePlayback = true;

    ms.addEventListener('sourceopen', () => {
      this.sourceOpen = true;
      this.trySetup();
    });
    ms.addEventListener('startstreaming', () => {
      this.streaming = true;
      this.drain();
    });
    ms.addEventListener('endstreaming', () => {
      this.streaming = false;
    });

    if ('ManagedMediaSource' in window) {
      this.video.srcObject = ms as unknown as MediaProvider;
    } else {
      this.video.src = URL.createObjectURL(ms);
    }

    // Pause watchdog: nothing in this stack ever pauses the element on purpose, so any pause is
    // the browser's doing (iOS Safari pauses on a scripted unmute; backgrounding can too). A
    // paused element with segments still appending renders as a slideshow — resume instead.
    const v = this.video;
    const onPause: EventListener = () => {
      if (this.closed || !this.started || !v.paused) return;
      if (this.resumeAttempts >= 5) return;
      this.resumeAttempts += 1;
      void v.play().catch(() => {
        // Unmuted resume refused → fall back to muted playback and surface tap-for-sound.
        if (this.closed) return;
        v.muted = true;
        void v.play().catch(() => {});
        this.setAudioBlocked();
      });
    };
    v.addEventListener('pause', onPause);
    const onPlaying: EventListener = () => {
      this.resumeAttempts = 0;
    };
    v.addEventListener('playing', onPlaying);
    this.watchdogListeners.push(['pause', onPause], ['playing', onPlaying]);

    const onAdvance: EventListener = () => {
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.lastPlayedPtsUs = Math.max(0, Math.round(this.video.currentTime * 1_000_000));
      }
      this.emitAdvance();
    };
    for (const event of ['timeupdate', 'seeking', 'seeked', 'playing', 'loadeddata']) {
      v.addEventListener(event, onAdvance);
      this.watchdogListeners.push([event, onAdvance]);
    }

    // Fire onFirstFrame unconditionally on 'playing' (that event guarantees playback started).
    // Use conditional check for the other events as fallbacks.
    const fireFirst = () => this.fireFirstFrame();
    const fireFirstIfPlaying = () => {
      if (this.firstFrameFired) return;
      if (!this.video.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.fireFirstFrame();
      }
    };
    this.video.addEventListener('playing', fireFirst);
    this.video.addEventListener('timeupdate', fireFirstIfPlaying);
    this.video.addEventListener('loadeddata', fireFirstIfPlaying);
    this.video.addEventListener('canplay', fireFirstIfPlaying);

    this.scheduleFrameCallback();
  }

  /** Declare the stream's MSE mime (from the accept's video channel descriptor). */
  setMime(mime: string): void {
    this.mime = mime;
    this.trySetup();
  }

  /** Append one fMP4 payload (init segment or media segment, in wire order). */
  append(bytes: Uint8Array, ptsUs = 0, init = false): void {
    if (this.closed) return;
    // Copy: the payload is a subarray view into the transport's frame buffer, which the caller
    // may reuse; SourceBuffer.appendBuffer needs stable bytes until updateend.
    const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    copy.set(bytes);
    this.pending.push({ bytes: copy, ptsUs, init });
    this.drain();
  }

  /** Nominal complete-unit duration from the negotiated video channel descriptor. The rollout
   *  intentionally leaves duration out of the binary header, so this is what lets interruption
   *  reject a queued unit whose start precedes, but whose tail crosses, the cutoff. */
  setMediaUnitTiming(fps: number, segmentFrames: number): void {
    if (Number.isFinite(fps) && fps > 0 && Number.isInteger(segmentFrames) && segmentFrames > 0) {
      this.mediaUnitDurationUs = Math.round((segmentFrames / fps) * 1_000_000);
    }
  }

  /** Re-arms itself each callback (rVFC only fires once per registration) to keep sampling the
   *  mediaTime <-> performanceTime relationship for the life of playback. No-op where unsupported
   *  (e.g. older Firefox) — mediaTimeAt() then always returns null, same as before any frame has
   *  displayed. */
  private scheduleFrameCallback(): void {
    if (typeof this.video.requestVideoFrameCallback !== 'function') return;
    this.rvfcHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      if (this.closed) return;
      this.mediaTimeMap.record(metadata.expectedDisplayTime, metadata.mediaTime * 1000);
      this.lastPlayedPtsUs = Math.max(0, Math.round(metadata.mediaTime * 1_000_000));
      this.emitAdvance();
      this.scheduleFrameCallback();
    });
  }

  /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
   *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
   *  change handling). Returns null before the first displayed frame. */
  mediaTimeAt(performanceTimeMs: number): number | null {
    return this.mediaTimeMap.at(performanceTimeMs);
  }

  playedPtsUs(): number | null {
    if (this.lastPlayedPtsUs !== null) return this.lastPlayedPtsUs;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const current = this.video.currentTime;
    return Number.isFinite(current) ? Math.max(0, Math.round(current * 1_000_000)) : null;
  }

  bufferedMs(): number {
    const buffered = this.video.buffered;
    if (!buffered.length) return 0;
    try {
      return Math.max(
        0,
        Math.round((buffered.end(buffered.length - 1) - this.video.currentTime) * 1000)
      );
    } catch {
      return 0;
    }
  }

  onAdvance(handler: () => void): () => void {
    this.advanceHandlers.add(handler);
    return () => this.advanceHandlers.delete(handler);
  }

  /** Remove queued and MSE-buffered media at/after the server-timeline cutoff. */
  async discardFrom(cutoffPtsUs: number): Promise<void> {
    const retained = (entry: PendingAppend): boolean => {
      if (entry.init) return true;
      if (this.mediaUnitDurationUs === null) return false;
      return entry.ptsUs + this.mediaUnitDurationUs <= cutoffPtsUs;
    };
    this.pending.splice(0, this.pending.length, ...this.pending.filter(retained));
    const sb = this.sb;
    if (!sb) {
      this.emitAdvance();
      return;
    }
    this.discarding = true;
    const activeCrossesCutoff =
      this.activeAppend !== null &&
      !this.activeAppend.init &&
      (this.mediaUnitDurationUs === null ||
        this.activeAppend.ptsUs + this.mediaUnitDurationUs > cutoffPtsUs);
    if (activeCrossesCutoff && sb.updating) {
      try {
        sb.abort();
      } catch {
        /* append finished between the checks */
      }
      this.activeAppend = null;
    }
    await this.waitForIdle(sb);
    const cutoffSec = cutoffPtsUs / 1_000_000;
    if (sb.buffered.length) {
      const end = sb.buffered.end(sb.buffered.length - 1);
      if (end > cutoffSec) {
        const start = Math.max(cutoffSec, sb.buffered.start(0));
        if (end > start) {
          try {
            sb.remove(start, end);
            await this.waitForIdle(sb);
          } catch {
            /* SourceBuffer closed while interruption was being applied */
          }
        }
      }
    }
    this.discarding = false;
    this.drain();
    this.emitAdvance();
  }

  private setAudioBlocked(): void {
    if (this.audioBlocked) return;
    this.audioBlocked = true;
    this.handlers.onAudioBlocked?.();
  }

  /** Unmute from a user-gesture context (e.g. a tap-for-sound button). Also resumes playback
   *  if the element is paused. Returns whether audio is now unblocked. */
  unmuteAudio(): boolean {
    const v = this.video;
    v.muted = false;
    if (v.paused) void v.play().catch(() => {});
    this.audioBlocked = false;
    this.resumeAttempts = 0;
    return !v.muted;
  }

  private trySetup(): void {
    if (this.sb || !this.sourceOpen || !this.mime || !this.ms) return;
    if (typeof MediaSource !== 'undefined' && !MediaSource.isTypeSupported(this.mime)) {
      console.warn('[mse] unsupported codec:', this.mime);
      this.handlers.onError?.(new Error(`unsupported codec: ${this.mime}`));
      return;
    }
    try {
      const sb = this.ms.addSourceBuffer(this.mime);
      sb.mode = 'segments';
      sb.addEventListener('updateend', () => {
        this.activeAppend = null;
        if (!this.discarding) this.drain();
      });
      this.sb = sb;
      this.drain();
    } catch (e) {
      this.handlers.onError?.(e);
    }
  }

  private drain(): void {
    const sb = this.sb;
    if (!sb || sb.updating || !this.streaming || this.discarding) return;
    const next = this.pending.shift();
    if (next === undefined) {
      this.housekeep(false);
      return;
    }
    try {
      this.activeAppend = next;
      sb.appendBuffer(next.bytes);
      if (!this.started) {
        this.started = true;
        // Force muted before play() — muted autoplay is always permitted (Firefox requires this).
        // The video is unmuted after play() resolves so audio plays immediately.
        this.video.muted = true;
        this.video
          .play()
          .then(() => {
            if (this.dev)
              console.log(
                '[mse] play() resolved paused=',
                this.video.paused,
                'readyState=',
                this.video.readyState
              );
            this.video.muted = false;
            // iOS Safari pauses the element synchronously when a scripted unmute isn't backed
            // by a user gesture. Keep VIDEO running (muted) rather than freezing into a
            // slideshow; audio is recovered via unmuteAudio() from a tap.
            if (this.video.paused) {
              if (this.dev) console.warn('[mse] unmute paused playback — resuming muted');
              this.video.muted = true;
              void this.video.play().catch(() => {});
              this.setAudioBlocked();
            }
          })
          .catch((err: unknown) => {
            console.warn(
              '[mse] play() rejected',
              (err as { name?: string })?.name,
              (err as { message?: string })?.message,
              'paused=',
              this.video.paused,
              'readyState=',
              this.video.readyState,
              'muted=',
              this.video.muted
            );
          });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        this.activeAppend = null;
        this.pending.unshift(next);
        this.housekeep(true);
      } else {
        this.handlers.onError?.(e);
      }
    }
  }

  private housekeep(force: boolean): void {
    const sb = this.sb;
    const v = this.video;
    if (!sb || sb.updating) return;
    const b = sb.buffered;
    if (!b.length) return;
    const start = b.start(0);
    const end = b.end(b.length - 1);

    if (this.firstFrameFired && !this.startSeeked && end - start > 0.5) {
      try {
        v.currentTime = Math.max(start, end - 0.5);
      } catch {
        /* */
      }
      this.startSeeked = true;
    }

    // Never catch-up-seek a paused element: it can't fall behind live by playing (it isn't),
    // and seeking it just repaints stills — the "slideshow" failure mode on iOS Safari. The
    // pause watchdog resumes it; buffer eviction below must still run regardless.
    if (!v.paused) {
      const ahead = end - v.currentTime;
      const now = performance.now() / 1000;
      if (ahead > 2.5 && now - this.lastSeekAt > 3) {
        try {
          v.currentTime = end - 0.4;
        } catch {
          /* */
        }
        this.lastSeekAt = now;
      } else {
        v.playbackRate = ahead > 1.2 ? 1.06 : 1.0;
      }
    }

    if (force || v.currentTime - start > 4) {
      const to = Math.max(start + 0.05, v.currentTime - 2);
      if (to > start) {
        try {
          sb.remove(start, to);
        } catch {
          /* */
        }
      }
    }
  }

  stop(): void {
    this.closed = true;
    if (this.rvfcHandle !== null && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.mediaTimeMap.clear();
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch {
      /* */
    }
    this.pending.length = 0;
    this.activeAppend = null;
    this.sb = null;
    this.ms = null;
    for (const [ev, fn] of this.watchdogListeners) {
      this.video.removeEventListener(ev, fn);
    }
    this.watchdogListeners = [];
    this.advanceHandlers.clear();
    try {
      this.video.removeAttribute('src');
      this.video.srcObject = null;
      this.video.load();
    } catch {
      /* */
    }
  }

  private emitAdvance(): void {
    for (const handler of this.advanceHandlers) handler();
  }

  private waitForIdle(sb: SourceBuffer): Promise<void> {
    if (!sb.updating) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('abort', done);
        sb.removeEventListener('error', done);
        resolve();
      };
      sb.addEventListener('updateend', done, { once: true });
      sb.addEventListener('abort', done, { once: true });
      sb.addEventListener('error', done, { once: true });
    });
  }
}
