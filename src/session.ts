import type { Turn } from './mic-capture';
import { MicCapture } from './mic-capture';
import { MsePlayer } from './mse-player';
import type { WidgetState } from './state';
import { StateMachine } from './state';

export type { Turn, WidgetState };

export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';

export interface EdgeTarget {
  mseWsUrl: string;
  micWsUrl: string;
  sessionCapSeconds?: number;
}

export interface ConnectHandlers {
  onStatus?(s: { phase: 'open' }): void;
  onReady(t: EdgeTarget): void;
  onEnded?(r: EndReason): void;
  onError?(e: unknown): void;
}

export interface ConnectStrategy {
  connect(h: ConnectHandlers): void;
  close(): void;
}

export interface AvatarSessionOpts {
  videoEl: HTMLVideoElement;
  connect: ConnectStrategy;
  lang?: string;
  /** Initial ASR language pin (box language names, e.g. ['English']). [] / omitted = auto-detect. */
  langs?: string[];
  workletUrl?: string;
  prewarm?: () => Promise<void> | void;
  dev?: boolean;
  /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
  permittedStream?: MediaStream;
  callbacks?: {
    onStateChange?(next: WidgetState, prev: WidgetState): void;
    onQueueStatus?(s: { phase: 'open' }): void;
    onPartial?(text: string): void;
    onTurn?(t: Turn): void;
    onFirstFrame?(): void;
    onClose?(r: EndReason): void;
    onError?(e: unknown): void;
  };
}

export class AvatarSession {
  private readonly sm: StateMachine;
  private mse: MsePlayer | null = null;
  private mic: MicCapture | null = null;
  private done = false;
  private _sessionCapSeconds: number | undefined;
  private permittedStream: MediaStream | null;
  private langs: string[];

  constructor(private readonly opts: AvatarSessionOpts) {
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      opts.callbacks?.onStateChange?.(next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
  }

  get state(): WidgetState {
    return this.sm.state;
  }

  get sessionCapSeconds(): number | undefined {
    return this._sessionCapSeconds;
  }

  // Returns the live stream so callers can pass it back via opts.permittedStream,
  // avoiding a second getUserMedia call (and second permission prompt on Firefox).
  static ensureMicPermission(): Promise<MediaStream> {
    return MicCapture.ensurePermission();
  }

  static mediaSupported(): boolean {
    return MsePlayer.supported();
  }

  start(): Promise<void> {
    if (this.done || this.sm.state !== 'idle') return Promise.resolve();
    this.sm.set('waiting');
    this.opts.connect.connect({
      onStatus: (s) => {
        this.opts.callbacks?.onQueueStatus?.(s);
      },
      onReady: (target) => {
        if (this.done) return;
        this._sessionCapSeconds = target.sessionCapSeconds;
        this.sm.set('ready');
        void this.openMedia(target);
      },
      onEnded: (reason) => {
        this.internalEnd(reason);
      },
      onError: (err) => {
        this.internalFail(err);
      },
    });
    return Promise.resolve();
  }

  private async openMedia(target: EdgeTarget): Promise<void> {
    if (this.done) return;
    this.sm.set('connecting');

    try {
      await this.opts.prewarm?.();
    } catch {
      /* best-effort */
    }

    if (this.done) return;

    const dev = this.opts.dev ?? false;

    this.mse = new MsePlayer(this.opts.videoEl, dev);
    this.mse.connect(target.mseWsUrl, {
      onFirstFrame: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === 'connecting' || s === 'ready') {
          this.sm.set('live');
          this.opts.callbacks?.onFirstFrame?.();
        }
      },
      onClose: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === 'live' || s === 'connecting') this.internalEnd('edge_disconnect');
      },
      onError: (err) => {
        if (dev) console.warn('[mse] error', err);
      },
    });

    // Transfer permittedStream ownership to MicCapture; clear here so teardown()
    // doesn't double-stop if mic.start() succeeds.
    const streamForMic = this.permittedStream;
    this.permittedStream = null;

    this.mic = new MicCapture();
    try {
      await this.mic.start(
        target.micWsUrl,
        this.opts.lang ?? 'en',
        {
          onPartial: (text) => {
            if (!this.done) this.opts.callbacks?.onPartial?.(text);
          },
          onTurn: (turn) => {
            if (!this.done) this.opts.callbacks?.onTurn?.(turn);
          },
          onError: (err) => {
            if (dev) console.warn('[mic] error', err);
          },
        },
        this.opts.workletUrl ?? '/mic-worklet.js',
        streamForMic ?? undefined,
        dev,
        this.langs
      );
    } catch (err) {
      this.internalFail(err);
    }
  }

  leave(): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set('idle');
    this.opts.callbacks?.onClose?.('generic');
  }

  setMuted(muted: boolean): void {
    this.mic?.setMuted(muted);
  }

  /** Change the ASR recognition language(s) — applies live mid-session and persists for the
   *  session (and any socket reconnect). [] = auto-detect across the box's configured set. */
  setLangs(langs: string[]): void {
    this.langs = langs;
    this.mic?.setLangs(langs);
  }

  get asrLangs(): string[] {
    return this.langs;
  }

  destroy(): void {
    this.done = true;
    this.teardown();
  }

  private internalEnd(reason: EndReason): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set('ended');
    this.opts.callbacks?.onClose?.(reason);
  }

  private internalFail(err: unknown): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set('error');
    this.opts.callbacks?.onError?.(err);
  }

  private teardown(): void {
    this.opts.connect.close();
    this.mse?.stop();
    this.mse = null;
    this.mic?.stop();
    this.mic = null;
    // Stop the retained stream if openMedia() never transferred it to MicCapture
    this.permittedStream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.permittedStream = null;
  }
}
