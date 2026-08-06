import { ClockMap } from './clock-map';
import { decodePcmDownlinkFrame } from './pcm-downlink';
import { PcmPlayer } from './pcm-player';
import type { EndReason } from './session';

export interface MseHandlers {
  onFirstFrame?: () => void;
  /** Edge transport negotiation. GPU boxes advertise `mime`; the Workers fallback advertises
   *  `poster-pcm`, allowing AvatarSession to open its in-band text/audio control socket. */
  onMode?: (mode: string) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
  onEnded?: (reason: EndReason) => void;
  /** Playback continues muted because the browser refused unmuted playback (iOS Safari pauses
   *  an autoplaying video on a scripted unmute). Surface a tap-for-sound affordance and call
   *  unmuteAudio() from the tap's gesture context. */
  onAudioBlocked?: () => void;
}

type MediaSourceCtor = { new (): MediaSource };

function getMediaSourceCtor(): MediaSourceCtor | null {
  const w = window as unknown as {
    ManagedMediaSource?: MediaSourceCtor;
    MediaSource?: MediaSourceCtor;
  };
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}

export class MsePlayer {
  static supported(): boolean {
    return getMediaSourceCtor() !== null;
  }

  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private ws: WebSocket | null = null;
  private pcmPlayer: PcmPlayer | null = null;
  private mime: string | null = null;
  private readonly pending: BufferSource[] = [];
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
  private rvfcHandle: number | null = null;

  private fireFirstFrame(): void {
    if (this.firstFrameFired) return;
    this.firstFrameFired = true;
    this.handlers.onFirstFrame?.();
  }

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly dev = false
  ) {}

  connect(wsUrl: string, handlers: MseHandlers = {}): void {
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
    this.openWs(wsUrl);
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
      this.scheduleFrameCallback();
    });
  }

  /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
   *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
   *  change handling). Returns null before the first displayed frame. */
  mediaTimeAt(performanceTimeMs: number): number | null {
    return this.mediaTimeMap.at(performanceTimeMs);
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
    const pcm = this.pcmPlayer?.unmute() ?? true;
    return !v.muted && pcm;
  }

  private openWs(wsUrl: string): void {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.onMessage(ev));
    ws.addEventListener('close', () => {
      if (!this.closed) this.handlers.onClose?.();
    });
    ws.addEventListener('error', () => this.handlers.onError?.(new Error('mse socket error')));
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data === 'string') {
      try {
        const m = JSON.parse(ev.data) as {
          mime?: string;
          mode?: string;
          poster_url?: string;
          type?: string;
          reason?: EndReason;
        };
        if (m.type === 'session_ended') {
          this.handlers.onEnded?.(m.reason ?? 'generic');
          return;
        }
        if (m.mode === 'poster-pcm') {
          // The fallback supplies a poster and sends speech as framed PCM on a session socket.
          // A caller-supplied poster remains the fallback for older/mock implementations.
          if (m.poster_url) this.video.poster = m.poster_url;
          this.handlers.onMode?.(m.mode);
          this.fireFirstFrame();
          return;
        }
        if (m.type === 'audio_reset') {
          this.pcmPlayer?.flush();
          return;
        }
        if (m.mime) {
          this.mime = m.mime;
          this.trySetup();
        }
      } catch {
        /* ignore non-JSON text */
      }
      return;
    }
    const pcm = decodePcmDownlinkFrame(ev.data as ArrayBuffer);
    if (pcm) {
      this.pcmPlayer ??= new PcmPlayer(() => this.setAudioBlocked());
      this.pcmPlayer.enqueue(pcm);
      return;
    }
    this.pending.push(new Uint8Array(ev.data as ArrayBuffer));
    this.drain();
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
      sb.addEventListener('updateend', () => this.drain());
      this.sb = sb;
      this.drain();
    } catch (e) {
      this.handlers.onError?.(e);
    }
  }

  private drain(): void {
    const sb = this.sb;
    if (!sb || sb.updating || !this.streaming) return;
    const next = this.pending.shift();
    if (next === undefined) {
      this.housekeep(false);
      return;
    }
    try {
      sb.appendBuffer(next);
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
      this.ws?.close();
    } catch {
      /* */
    }
    this.ws = null;
    this.pcmPlayer?.stop();
    this.pcmPlayer = null;
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch {
      /* */
    }
    this.pending.length = 0;
    this.sb = null;
    this.ms = null;
    for (const [ev, fn] of this.watchdogListeners) {
      this.video.removeEventListener(ev, fn);
    }
    this.watchdogListeners = [];
    try {
      this.video.removeAttribute('src');
      this.video.srcObject = null;
      this.video.load();
    } catch {
      /* */
    }
  }
}
