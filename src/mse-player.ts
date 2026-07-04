export interface MseHandlers {
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
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

    // Fire onFirstFrame unconditionally on 'playing' (that event guarantees playback started).
    // Use conditional check for the other events as fallbacks.
    const fireFirst = () => {
      if (this.firstFrameFired) return;
      this.firstFrameFired = true;
      this.handlers.onFirstFrame?.();
    };
    const fireFirstIfPlaying = () => {
      if (this.firstFrameFired) return;
      if (!this.video.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.firstFrameFired = true;
        this.handlers.onFirstFrame?.();
      }
    };
    this.video.addEventListener('playing', fireFirst);
    this.video.addEventListener('timeupdate', fireFirstIfPlaying);
    this.video.addEventListener('loadeddata', fireFirstIfPlaying);
    this.video.addEventListener('canplay', fireFirstIfPlaying);

    this.openWs(wsUrl);
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
        const m = JSON.parse(ev.data) as { mime?: string };
        if (m.mime) {
          this.mime = m.mime;
          this.trySetup();
        }
      } catch {
        /* ignore non-JSON text */
      }
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
    try {
      this.ws?.close();
    } catch {
      /* */
    }
    this.ws = null;
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch {
      /* */
    }
    this.pending.length = 0;
    this.sb = null;
    this.ms = null;
    try {
      this.video.removeAttribute('src');
      this.video.srcObject = null;
      this.video.load();
    } catch {
      /* */
    }
  }
}
