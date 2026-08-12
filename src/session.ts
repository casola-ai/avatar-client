import { MicPipeline } from './mic-pipeline';
import { MsePlayer } from './mse-player';
import type { WidgetState } from './state';
import { StateMachine } from './state';
import { type DriverSocket, type EndReason, type Turn, V2Driver } from './v2/driver';

export type { EndReason, Turn, WidgetState };

export interface EdgeTarget {
  /** The box's `/v2/session` WebSocket URL, session token included. */
  sessionWsUrl: string;
  /** Seconds until the mint's `expires_at` — superseded by the accept's `cap_seconds`. */
  sessionCapSeconds?: number;
}

export interface ConnectHandlers {
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
  /** Initial ASR language pin (box language names, e.g. ['English']). [] / omitted = auto-detect. */
  langs?: string[];
  /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
   *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
   *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
  responseLanguage?: string;
  workletUrl?: string;
  prewarm?: () => Promise<void> | void;
  dev?: boolean;
  /** Mic uplink. Default true. Set false for a RECEIVE-ONLY session: the hello omits `mic`, no
   *  microphone is opened (no getUserMedia prompt, no worklet needed), and user input arrives
   *  through sendText() over the same session socket. */
  mic?: boolean;
  /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
  permittedStream?: MediaStream;
  /** Test seam for the session WebSocket — see V2Driver. */
  createSocket?: (url: string, protocols: string[]) => DriverSocket;
  callbacks?: {
    onStateChange?(next: WidgetState, prev: WidgetState): void;
    onPartial?(text: string): void;
    onTurn?(t: Turn): void;
    onFirstFrame?(): void;
    /** Fired when the microphone pipeline is capturing and the session is ready for speech. */
    onMicReady?(): void;
    /** The box marked the start of an assistant utterance (speech_id groups its turn/audio). */
    onSpeechStart?(speechId: string): void;
    onSpeechEnd?(speechId: string): void;
    /** Fired once per outgoing 100ms mic frame with its capture calibration — analytics/debugging
     *  hook, not required for normal operation. `videoMediaTimeMs` is the unknown sentinel
     *  (0xFFFFFFFF) before the avatar video has displayed its first frame (always, in poster
     *  mode); on the wire that is sent as `pts_us = 0`. */
    onAudioFrameSent?(info: {
      micSeq: number;
      videoMediaTimeMs: number;
      captureEpochMs: number;
    }): void;
    /** Media continues muted because the browser refused unmuted playback (iOS Safari). Show a
     *  tap-for-sound affordance and call unmuteAudio() from the tap. */
    onAudioBlocked?(): void;
    onClose?(r: EndReason): void;
    /** Fired on a terminal session failure (connect/handshake/mic setup) AND on non-terminal
     *  in-band errors (server error message, media hiccup) so a degraded session is never
     *  silent. For non-terminal errors the session keeps running; inspect the error and decide
     *  whether to warn or leave(). getUserMedia denial and a failed worklet load are terminal.
     *  Pre-flight the mic with AvatarSession.ensureMicPermission() to catch permission problems
     *  before you spend a seat. */
    onError?(e: unknown): void;
  };
}

export class AvatarSession {
  private readonly sm: StateMachine;
  private driver: V2Driver | null = null;
  private done = false;
  private _sessionCapSeconds: number | undefined;
  private _personaKey: string | undefined;
  private permittedStream: MediaStream | null;
  private langs: string[];
  private _responseLanguage: string | undefined;

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

  /** The avatar_versions.id the box bound, echoed in the accept (the persona-pinning ack). */
  get personaKey(): string | undefined {
    return this._personaKey;
  }

  // Returns the live stream so callers can pass it back via opts.permittedStream,
  // avoiding a second getUserMedia call (and second permission prompt on Firefox).
  static ensureMicPermission(): Promise<MediaStream> {
    return MicPipeline.ensurePermission();
  }

  /** Whether this browser can play the fMP4 video channel. Poster-mode sessions (audio + still)
   *  work regardless — the hello simply doesn't offer video. */
  static mediaSupported(): boolean {
    return MsePlayer.supported();
  }

  start(): Promise<void> {
    if (this.done || this.sm.state !== 'idle') return Promise.resolve();
    this.sm.set('waiting');
    this.opts.connect.connect({
      onReady: (target) => {
        if (this.done) return;
        this._sessionCapSeconds = target.sessionCapSeconds;
        this.sm.set('ready');
        void this.openSession(target);
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

  private async openSession(target: EdgeTarget): Promise<void> {
    if (this.done) return;
    this.sm.set('connecting');

    try {
      await this.opts.prewarm?.();
    } catch {
      /* best-effort */
    }
    if (this.done) return;

    const dev = this.opts.dev ?? false;
    // Transfer permittedStream ownership to the driver; clear here so teardown()
    // doesn't double-stop after the mic pipeline takes it over.
    const streamForMic = this.permittedStream;
    this.permittedStream = null;

    this.driver = new V2Driver({
      videoEl: this.opts.videoEl,
      sessionWsUrl: target.sessionWsUrl,
      mic: this.opts.mic !== false,
      langs: this.langs,
      responseLanguage: this._responseLanguage,
      workletUrl: this.opts.workletUrl ?? '/mic-worklet.js',
      permittedStream: streamForMic ?? undefined,
      dev,
      createSocket: this.opts.createSocket,
      handlers: {
        onAccept: (info) => {
          if (this.done) return;
          this._sessionCapSeconds = info.capSeconds;
          this._personaKey = info.personaKey;
        },
        onFirstFrame: () => {
          if (this.done) return;
          const s = this.sm.state;
          if (s === 'connecting' || s === 'ready') {
            this.sm.set('live');
            this.opts.callbacks?.onFirstFrame?.();
          }
        },
        onMicReady: () => {
          if (!this.done) this.opts.callbacks?.onMicReady?.();
        },
        onPartial: (text) => {
          if (!this.done) this.opts.callbacks?.onPartial?.(text);
        },
        onTurn: (turn) => {
          if (!this.done) this.opts.callbacks?.onTurn?.(turn);
        },
        onSpeechStart: (id) => {
          if (!this.done) this.opts.callbacks?.onSpeechStart?.(id);
        },
        onSpeechEnd: (id) => {
          if (!this.done) this.opts.callbacks?.onSpeechEnd?.(id);
        },
        onAudioFrameSent: (info) => {
          if (!this.done) this.opts.callbacks?.onAudioFrameSent?.(info);
        },
        onAudioBlocked: () => {
          if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
        },
        onEnded: (reason) => {
          this.internalEnd(reason);
        },
        onError: (err, terminal) => {
          if (terminal) {
            this.internalFail(err);
          } else {
            if (dev) console.warn('[v2] session error', err);
            if (!this.done) this.opts.callbacks?.onError?.(err);
          }
        },
      },
    });
    this.driver.connect();
  }

  leave(): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set('idle');
    this.opts.callbacks?.onClose?.('generic');
  }

  setMuted(muted: boolean): void {
    this.driver?.setMuted(muted);
  }

  /** Send a typed user turn through the session socket. Resolves with the box's reply. */
  sendText(text: string): Promise<Turn> {
    const driver = this.driver;
    if (!driver) return Promise.reject(new Error('text transport is unavailable'));
    return driver.sendText(text);
  }

  /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
   *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
  unmuteAudio(): boolean {
    return this.driver?.unmuteAudio() ?? true;
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
   *  session. [] = auto-detect across the box's configured set. */
  setLangs(langs: string[]): void {
    this.langs = langs;
    this.driver?.setLangs(langs);
  }

  get asrLangs(): string[] {
    return this.langs;
  }

  /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
   *  own choice). Applies from the next turn and persists for the session. Distinct from
   *  setLangs (ASR recognition pin). */
  setResponseLanguage(lang: string): void {
    this._responseLanguage = lang;
    this.driver?.setResponseLanguage(lang);
  }

  /** Replace hidden system-level guidance for subsequent turns. Unlike sendText(), this does not
   *  create a user message, request an immediate response, or surface in transcript callbacks. */
  setRuntimeInstruction(instruction: string): void {
    this.driver?.setRuntimeInstruction(instruction);
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
    this.driver?.stop();
    this.driver = null;
    // Stop the retained stream if openSession() never transferred it to the driver
    this.permittedStream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.permittedStream = null;
  }
}
