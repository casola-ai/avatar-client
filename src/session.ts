import { AvatarError, classifyMicError, toAvatarError } from './errors';
import { MicPipeline } from './mic-pipeline';
import { MsePlayer } from './mse-player';
import type { WidgetState } from './state';
import { StateMachine } from './state';
import { type DriverSocket, type EndReason, type Turn, V2Driver } from './v2/driver';

export type { EndReason, Turn, WidgetState };

/** What {@link AvatarSession.preflight} found. `ok: false` carries the classified reason, so a
 *  host picks copy from `error.kind` instead of sniffing DOMException names itself. */
export type PreflightResult =
  | { ok: true; stream: MediaStream | null; video: boolean }
  | { ok: false; error: AvatarError };

/**
 * Why the microphone is (or is not) muted. `userMuted` is what the person chose; `suppressed` is
 * the application temporarily holding the mic closed — driving a scripted turn, playing an
 * interstitial. `effective` is what the wire is doing. Keeping them apart is what lets a mute
 * button reflect intent instead of being fought by the app's own `setMuted` calls.
 */
export interface MicMuteState {
  userMuted: boolean;
  suppressed: boolean;
  effective: boolean;
}

/** Calibration for one outgoing mic frame — see `callbacks.onAudioFrameSent`. */
export interface MicFrameSentInfo {
  micSeq: number;
  videoMediaTimeMs: number;
  captureEpochMs: number;
}

/**
 * The events {@link AvatarSession.on} exposes — the same moments the constructor `callbacks`
 * fire, addressable after construction so a helper can subscribe itself instead of the host
 * forwarding each one by hand.
 */
export interface AvatarSessionEvents {
  state: (next: WidgetState, prev: WidgetState) => void;
  partial: (text: string) => void;
  turn: (t: Turn) => void;
  firstFrame: () => void;
  micReady: () => void;
  speechStart: (speechId: string) => void;
  speechEnd: (speechId: string) => void;
  audioFrameSent: (info: MicFrameSentInfo) => void;
  audioBlocked: () => void;
  /** The microphone's mute state changed — from the user, or from `suppressMic`. */
  muteChange: (state: MicMuteState) => void;
  close: (r: EndReason) => void;
  error: (e: AvatarError) => void;
}

type EventName = keyof AvatarSessionEvents;

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
     *  silent. Branch on `e.kind` — `e.terminal` says whether the session is over. Showing
     *  microphone copy for every error is wrong: a box that cannot bind the pinned avatar
     *  arrives here as `persona-unavailable`, not as anything the user's mic can fix.
     *  Pre-flight with AvatarSession.preflight() to catch permission problems before a seat. */
    onError?(e: AvatarError): void;
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
  private _userMuted = false;
  private _micSuppressed = false;

  private readonly listeners = new Map<EventName, Set<(...args: never[]) => void>>();

  constructor(private readonly opts: AvatarSessionOpts) {
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      this.emit('state', next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
    this._responseLanguage = opts.responseLanguage;
  }

  /**
   * Subscribe to a session event. Returns an unsubscribe function.
   *
   * The constructor's `callbacks` still work and fire first; this exists because a callback bag
   * fixed at construction cannot be joined later, which forced every host to hand-forward events
   * into helpers like `attachCaptions`. A throwing handler is caught and never breaks the session
   * or the other subscribers.
   *
   * ```ts
   * const off = session.on('turn', (t) => captions.turn(t));
   * // …later
   * off();
   * ```
   */
  on<K extends EventName>(event: K, handler: AvatarSessionEvents[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const entry = handler as (...args: never[]) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /** Fire the matching constructor callback, then every subscriber. */
  private emit<K extends EventName>(event: K, ...args: Parameters<AvatarSessionEvents[K]>): void {
    const cb = this.opts.callbacks;
    try {
      switch (event) {
        case 'state':
          cb?.onStateChange?.(...(args as Parameters<AvatarSessionEvents['state']>));
          break;
        case 'partial':
          cb?.onPartial?.(...(args as Parameters<AvatarSessionEvents['partial']>));
          break;
        case 'turn':
          cb?.onTurn?.(...(args as Parameters<AvatarSessionEvents['turn']>));
          break;
        case 'firstFrame':
          cb?.onFirstFrame?.();
          break;
        case 'micReady':
          cb?.onMicReady?.();
          break;
        case 'speechStart':
          cb?.onSpeechStart?.(...(args as Parameters<AvatarSessionEvents['speechStart']>));
          break;
        case 'speechEnd':
          cb?.onSpeechEnd?.(...(args as Parameters<AvatarSessionEvents['speechEnd']>));
          break;
        case 'audioFrameSent':
          cb?.onAudioFrameSent?.(...(args as Parameters<AvatarSessionEvents['audioFrameSent']>));
          break;
        case 'audioBlocked':
          cb?.onAudioBlocked?.();
          break;
        case 'muteChange':
          // No constructor-callback twin: this event is new, and adding one would grow the
          // callback bag the events API exists to replace.
          break;
        case 'close':
          cb?.onClose?.(...(args as Parameters<AvatarSessionEvents['close']>));
          break;
        case 'error':
          cb?.onError?.(...(args as Parameters<AvatarSessionEvents['error']>));
          break;
      }
    } catch (err) {
      if (this.opts.dev) console.warn(`[avatar] callbacks.${event} threw`, err);
    }
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // One bad subscriber must not take down the session or the other subscribers.
        if (this.opts.dev) console.warn(`[avatar] on('${event}') handler threw`, err);
      }
    }
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

  /**
   * Everything that must be true before spending a fleet seat, in one call: microphone permission,
   * MSE support, and the browser gate — returning a classified result instead of a raw
   * DOMException.
   *
   * Hold the returned `stream` and pass it as `permittedStream` so the session does not call
   * getUserMedia twice (a second permission prompt on Firefox). `video: false` means poster mode
   * is the only option here; that is a degradation, not a failure, so `ok` stays true.
   *
   * ```ts
   * const pre = await AvatarSession.preflight();
   * if (!pre.ok) return showError(COPY.errors[pre.error.kind] ?? COPY.errors.generic);
   * new AvatarSession({ permittedStream: pre.stream ?? undefined, ... });
   * ```
   */
  static async preflight(options: { mic?: boolean } = {}): Promise<PreflightResult> {
    const wantsMic = options.mic !== false;
    const video = MsePlayer.supported();
    if (!wantsMic) {
      // Receive-only: no mic to check, and poster mode covers a browser without MSE.
      return { ok: true, stream: null, video };
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        error: new AvatarError(
          'unsupported-browser',
          'this browser does not support microphone capture'
        ),
      };
    }
    try {
      const stream = await MicPipeline.ensurePermission();
      return { ok: true, stream, video };
    } catch (err) {
      return { ok: false, error: toAvatarError(err, classifyMicError(err)) };
    }
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
            this.emit('firstFrame');
          }
        },
        onMicReady: () => {
          if (this.done) return;
          // A host that muted (or suppressed) before the pipeline existed set intent against a
          // null driver; apply it now that there is something to mute.
          if (this.micMuted) this.driver?.setMuted(true);
          this.emit('micReady');
        },
        onPartial: (text) => {
          if (!this.done) this.emit('partial', text);
        },
        onTurn: (turn) => {
          if (!this.done) this.emit('turn', turn);
        },
        onSpeechStart: (id) => {
          if (!this.done) this.emit('speechStart', id);
        },
        onSpeechEnd: (id) => {
          if (!this.done) this.emit('speechEnd', id);
        },
        onAudioFrameSent: (info) => {
          if (!this.done) this.emit('audioFrameSent', info);
        },
        onAudioBlocked: () => {
          if (!this.done) this.emit('audioBlocked');
        },
        onEnded: (reason) => {
          this.internalEnd(reason);
        },
        onError: (err, terminal) => {
          if (terminal) {
            this.internalFail(err);
          } else {
            if (dev) console.warn('[v2] session error', err);
            if (!this.done) this.emit('error', err);
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
    this.emit('close', 'generic');
  }

  /** The user's choice — what a mute button sets. Survives `suppressMic`. */
  setMuted(muted: boolean): void {
    this._userMuted = muted;
    this.applyMic();
  }

  /**
   * Hold the microphone closed without changing the user's choice, and release it back to
   * whatever they had set. Use this around app-driven turns rather than calling `setMuted(true)`
   * then `setMuted(previous)` — that pattern loses the user's intent whenever the two interleave,
   * and it fights any UI bound to the mute state.
   */
  suppressMic(suppressed: boolean): void {
    this._micSuppressed = suppressed;
    this.applyMic();
  }

  /** What the user chose, ignoring any active suppression. */
  get userMuted(): boolean {
    return this._userMuted;
  }

  /** Whether the application is currently holding the mic closed. */
  get micSuppressed(): boolean {
    return this._micSuppressed;
  }

  /** What the wire is actually doing: the user's choice OR an active suppression. */
  get micMuted(): boolean {
    return this._userMuted || this._micSuppressed;
  }

  private applyMic(): void {
    this.driver?.setMuted(this.micMuted);
    this.emit('muteChange', {
      userMuted: this._userMuted,
      suppressed: this._micSuppressed,
      effective: this.micMuted,
    });
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
    this.emit('close', reason);
  }

  private internalFail(err: unknown): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set('error');
    // The driver classifies its own failures; anything from a ConnectStrategy lands here raw.
    this.emit('error', toAvatarError(err, 'connect'));
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
