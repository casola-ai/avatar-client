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
  /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
   *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
   *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
  responseLanguage?: string;
  workletUrl?: string;
  prewarm?: () => Promise<void> | void;
  dev?: boolean;
  /** Mic uplink. Default true. Set false for a RECEIVE-ONLY session: MSE video+audio plays
   *  down, but no microphone is opened (no getUserMedia prompt, no worklet needed). User input
   *  then arrives through sendText(). A fallback edge opens a receive-only control/audio socket
   *  after transport negotiation; GPU sessions use `textTransport`. */
  mic?: boolean;
  /** Legacy text transport used when the assigned GPU edge does not advertise in-band text.
   *  First-party BFFs can provide their existing same-origin `/chat` relay here. */
  textTransport?: (text: string) => Promise<string>;
  /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
  permittedStream?: MediaStream;
  callbacks?: {
    onStateChange?(next: WidgetState, prev: WidgetState): void;
    /**
     * @deprecated Named for a capacity queue the platform no longer has (a full fleet 503s the
     *  mint instead). Fires only if a ConnectStrategy calls `onStatus`, and `connectViaToken` —
     *  the only shipping strategy — never does. Retained for API compatibility and will be removed
     *  in the next major; don't build on it. If a real queue is reintroduced it will ship under a
     *  new, purpose-named callback rather than reviving this one.
     */
    onQueueStatus?(s: { phase: 'open' }): void;
    onPartial?(text: string): void;
    onTurn?(t: Turn): void;
    onFirstFrame?(): void;
    /** Fired when the microphone uplink is open and ready to receive the user's speech. */
    onMicReady?(): void;
    /** Fired once per outgoing 100ms mic frame with the same correlation fields sent in its wire
     *  header (specs/av-sync-timestamps-notes.md sections 2-4) — analytics/debugging hook, not
     *  required for normal operation. `videoMediaTimeMs` is the wire's unknown sentinel
     *  (0xFFFFFFFF) before the avatar video has displayed its first frame. */
    onAudioFrameSent?(info: {
      micSeq: number;
      videoMediaTimeMs: number;
      captureEpochMs: number;
    }): void;
    /** Video continues muted because the browser refused unmuted playback (iOS Safari). Show a
     *  tap-for-sound affordance and call unmuteAudio() from the tap. */
    onAudioBlocked?(): void;
    onClose?(r: EndReason): void;
    /** Fired on a terminal session failure (connect/media setup) AND on non-terminal mic-uplink
     *  errors (mic socket error, server error frame) so a dead microphone is never silent. For
     *  mic errors the video + session keep running; inspect the error and decide whether to warn
     *  or leave(). getUserMedia denial and a failed worklet load surface here too (they reject
     *  start() → terminal). Pre-flight the mic with AvatarSession.ensureMicPermission() to catch
     *  permission problems before you spend a GPU seat. */
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
  private _responseLanguage: string | undefined;
  private fallbackInBandText = false;

  constructor(private readonly opts: AvatarSessionOpts) {
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      opts.callbacks?.onStateChange?.(next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
    this._responseLanguage = opts.responseLanguage;
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
      onMode: (mode) => {
        if (mode !== 'poster-pcm') return;
        this.fallbackInBandText = true;
        if (this.opts.mic === false && !this.mic) {
          this.openReceiveOnlyTransport(target, dev);
        }
      },
      onFirstFrame: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === 'connecting' || s === 'ready') {
          this.sm.set('live');
          this.opts.callbacks?.onFirstFrame?.();
        }
      },
      onAudioBlocked: () => {
        if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
      },
      onClose: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === 'live' || s === 'connecting') this.internalEnd('edge_disconnect');
      },
      onEnded: (reason) => {
        this.internalEnd(reason);
      },
      onError: (err) => {
        if (dev) console.warn('[mse] error', err);
      },
    });

    // Receive-only sessions (mic:false) skip microphone capture — no getUserMedia or worklet.
    // GPU sessions keep their historical MSE-only shape. A Workers fallback is detected by the
    // MSE control frame above and gets a receive-only /mic_stream socket for text + assistant PCM.
    // Scoped as a block rather than an early return so anything added below openMedia's mic
    // section still runs on a receive-only session. A caller-supplied permittedStream is left
    // untransferred here, so teardown() stops it.
    if (this.opts.mic !== false) {
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
            onReady: () => {
              if (!this.done) this.opts.callbacks?.onMicReady?.();
            },
            onPartial: (text) => {
              if (!this.done) this.opts.callbacks?.onPartial?.(text);
            },
            onTurn: (turn) => {
              if (!this.done) this.opts.callbacks?.onTurn?.(turn);
            },
            onFrameTimestamp: (info) => {
              if (!this.done) this.opts.callbacks?.onAudioFrameSent?.(info);
            },
            onError: (err) => {
              if (dev) console.warn('[mic] error', err);
              // Surface mic-uplink failures (socket error, server error frame) so a dead
              // microphone is never silent — the top complaint in the quickstart demo debrief.
              // Non-terminal: video + the session stay up and the app decides what to do
              // (warn the user, end the call). Terminal failures still route through
              // internalFail() → onError as before.
              if (!this.done) this.opts.callbacks?.onError?.(err);
            },
            onAudioBlocked: () => {
              if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
            },
          },
          this.opts.workletUrl ?? '/mic-worklet.js',
          streamForMic ?? undefined,
          dev,
          this.langs,
          this._responseLanguage,
          (t) => this.mse?.mediaTimeAt(t) ?? null
        );
      } catch (err) {
        this.internalFail(err);
      }
    }
  }

  private openReceiveOnlyTransport(target: EdgeTarget, dev: boolean): void {
    if (this.done || this.mic) return;
    this.mic = new MicCapture();
    this.mic.startReceiveOnly(
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
          if (dev) console.warn('[mic] receive-only error', err);
          if (!this.done) this.opts.callbacks?.onError?.(err);
        },
        onAudioBlocked: () => {
          if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
        },
      },
      dev,
      this.langs,
      this._responseLanguage
    );
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

  /** Send a typed user turn through the active session. Workers fallback sessions use their
   *  in-band WebSocket; GPU sessions use the optional application-supplied textTransport. */
  async sendText(text: string): Promise<Turn> {
    const value = text.trim();
    if (!value) throw new Error('text is required');
    if (this.fallbackInBandText) {
      if (!this.mic) throw new Error('fallback text transport is not ready');
      return this.mic.sendText(value);
    }
    if (!this.opts.textTransport) throw new Error('text transport is unavailable');
    const reply = await this.opts.textTransport(value);
    return { text: value, reply };
  }

  /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
   *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
  unmuteAudio(): boolean {
    const mse = this.mse?.unmuteAudio() ?? true;
    const pcm = this.mic?.unmuteAudio() ?? true;
    return mse && pcm;
  }

  /** Call synchronously inside the click/tap handler that starts a call, BEFORE any await:
   *  a user-gestured play()/load() clears WebKit's per-element gesture restrictions so the
   *  SDK's scripted unmute isn't answered with a pause on iOS Safari (which otherwise turns
   *  the first call in a fresh browsing context into a muted ~2fps slideshow). */
  static primeVideoElement(video: HTMLVideoElement): void {
    try {
      video.muted = true;
      void video.play().catch(() => {});
      video.load();
    } catch {
      /* priming is best-effort */
    }
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

  /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
   *  own choice). Applies from the next turn and persists for the session (and any socket
   *  reconnect). Distinct from setLangs (ASR recognition pin). */
  setResponseLanguage(lang: string): void {
    this._responseLanguage = lang;
    this.mic?.setResponseLanguage(lang);
  }

  get responseLanguage(): string | undefined {
    return this._responseLanguage;
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
