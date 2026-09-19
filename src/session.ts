import {
  type AvatarDiagnostic,
  type AvatarSessionStats,
  emptyStats,
  type NegotiatedInfo,
} from './diagnostics';
import { AvatarError, classifyMicError, toAvatarError } from './errors';
import { consoleLogger, type Logger } from './logger';
import { OpusMicEncoder } from './mic-encoder';
import { type MicBackingReason, MicPipeline } from './mic-pipeline';

export type { MicBackingReason } from './mic-pipeline';

import { MsePlayer } from './mse-player';
import type { VideoCodec } from './protocol';
import type { WidgetState } from './state';
import { StateMachine } from './state';
import type { TimedUtterance } from './utterance-scheduler';
import { type DriverSocket, type EndReason, type Turn, V2Driver } from './v2/driver';

export type { EndReason, Turn, WidgetState };

/** How long `opts.prewarm` may hold the connect before the session proceeds without it. */
const PREWARM_TIMEOUT_MS = 5_000;

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

/** Whether the mic channel is backed by a capture stream, and why not when it is not. Unbacked,
 *  the session still sends zeroed frames on the mic cadence — the box hears silence, never a
 *  stalled clock — and `enableMic()` can back it later. */
export interface MicBackingState {
  backed: boolean;
  reason: MicBackingReason;
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
  utteranceStart: (utterance: TimedUtterance) => void;
  utteranceText: (utterance: TimedUtterance) => void;
  utteranceEnd: (utterance: TimedUtterance) => void;
  mediaDiscarded: (cutoffPtsUs: number) => void;
  audioFrameSent: (info: MicFrameSentInfo) => void;
  audioBlocked: () => void;
  /** The microphone's mute state changed — from the user, or from `suppressMic`. */
  muteChange: (state: MicMuteState) => void;
  /** The mic channel gained or lost its capture stream — a late permission grant attaching, a
   *  track that ended, an `enableMic()` that failed. Read `micBacked` for the current value. */
  micBacking: (state: MicBackingState) => void;
  /** A bounded operational fact about the session — see `AvatarDiagnostic`. Fires unguarded by the
   *  session's `done` flag, so `socket_closed` (which lands in the same tick as `close`) is not
   *  dropped. */
  diagnostic: (d: AvatarDiagnostic) => void;
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
  /** Initial ASR language pin as BCP-47 primary subtags, e.g. ['en'] or ['zh', 'en'].
   *  ONE entry forces the recogniser to that language; SEVERAL name the likely set and leave
   *  auto-detect on. [] / omitted = the session JWT's `spoken_languages` claim (if any), else
   *  auto-detect hinted by `response_language`. Language NAMES ('English') are also accepted by
   *  current boxes, but were silently DROPPED by every box before 2026-09-01 — send tags. */
  langs?: string[];
  /** Preferred REPLY language (BCP-47, e.g. 'zh-CN'): the avatar is instructed to strongly prefer
   *  answering in it. Omitted = the session JWT's `response_language` claim (if any), else the
   *  LLM's own choice. Distinct from `langs` (what the USER speaks / ASR recognition). */
  responseLanguage?: string;
  workletUrl?: string;
  prewarm?: () => Promise<void> | void;
  dev?: boolean;
  /** Mic uplink. Default true: the hello declares the mic channel, and the channel stays up for
   *  the whole session whether or not a microphone is behind it (see `permittedStream`,
   *  `enableMic`, `micBacked`). Set false for a RECEIVE-ONLY session: the hello omits `mic`, no
   *  microphone is ever opened, and user input arrives through sendText() over the same socket. */
  mic?: boolean;
  /** Where the microphone comes from. A `MediaStream` from `ensureMicPermission()` attaches at
   *  the accept (and avoids a second getUserMedia prompt). A `Promise` is a stream the host is
   *  still waiting for — a permission prompt the visitor has not answered — and the session runs
   *  with zeroed mic frames until it resolves, then attaches it; a `null` resolution means the
   *  host chose not to prompt again (`enableMic()` still can). Omitted: the session asks
   *  getUserMedia itself at the accept. A refusal no longer ends the session either way: the
   *  channel stays unbacked and reports why (`micBacking`). */
  permittedStream?: MediaStream | Promise<MediaStream | null>;
  /** Mic uplink codec. Default `'auto'`: Opus (32 kbit/s, one packet per 100 ms frame) whenever
   *  this browser's WebCodecs `AudioEncoder` supports it and the box accepts it, else raw pcm16 —
   *  the box's accept decides, so an older box silently gets pcm16. `'pcm16'` never offers Opus:
   *  the opt-out if an encoder misbehaves somewhere. */
  micCodec?: 'auto' | 'pcm16';
  /** Downlink video codec. Default `'auto'`: the hello offers every codec this browser can decode
   *  (AV1 / HEVC / H.264) and the box picks the cheapest of those to ship — av1 is ~20–40 % fewer
   *  bits than h264 at equal quality. The box decides, so an older box silently serves h264.
   *  `'h264'` offers nothing: the opt-out if a platform's hardware decode misbehaves. */
  videoCodec?: 'auto' | 'h264';
  /** The mint's session id and a support trace id. Stamped on every `AvatarDiagnostic` so a report
   *  joins the mint and the support trace; never put on the wire. */
  sessionId?: string;
  traceId?: string;
  /** Where the SDK routes its internal logs (driver, players, pipeline, state). Absent = a
   *  dev-gated console, exactly the pre-logger behavior. */
  logger?: Logger;
  /** Test seam for the session WebSocket — see V2Driver. */
  createSocket?: (url: string, protocols: string[]) => DriverSocket;
  callbacks?: {
    onStateChange?(next: WidgetState, prev: WidgetState): void;
    onPartial?(text: string): void;
    onTurn?(t: Turn): void;
    onFirstFrame?(): void;
    /** Fired when the microphone pipeline is capturing and the session is ready for speech —
     *  on the first attach and on every later one (`enableMic`, a late `permittedStream`). */
    onMicReady?(): void;
    /** The box marked the start of an assistant utterance (speech_id groups its turn/audio). */
    onSpeechStart?(speechId: string): void;
    onSpeechEnd?(speechId: string): void;
    /** Fired only when the local playout clock reaches the timed utterance boundary. */
    onUtteranceStart?(utterance: TimedUtterance): void;
    onUtteranceText?(utterance: TimedUtterance): void;
    onUtteranceEnd?(utterance: TimedUtterance): void;
    /** Diagnostic hook fired after local interruption media removal completes. */
    onMediaDiscarded?(cutoffPtsUs: number): void;
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
    /** A bounded operational fact about the session (`AvatarDiagnostic`). Analytics/support hook,
     *  never required for normal operation. Branch on `d.type` and default-ignore an unrecognized
     *  one — the union grows. */
    onDiagnostic?(d: AvatarDiagnostic): void;
  };
}

export class AvatarSession {
  private readonly sm: StateMachine;
  private driver: V2Driver | null = null;
  private done = false;
  private _sessionCapSeconds: number | undefined;
  private _personaKey: string | undefined;
  private _videoCodec: VideoCodec | undefined;
  private permittedStream: MediaStream | Promise<MediaStream | null> | null;
  private _micBacked = false;
  private langs: string[];
  private _responseLanguage: string | undefined;
  private _userMuted = false;
  private _micSuppressed = false;
  private _negotiated: NegotiatedInfo | null = null;
  private readonly _stats = emptyStats();

  private readonly listeners = new Map<EventName, Set<(...args: never[]) => void>>();
  private readonly logger: Logger;

  constructor(private readonly opts: AvatarSessionOpts) {
    this.logger = opts.logger ?? consoleLogger(opts.dev ?? false);
    this.sm = new StateMachine(this.logger);
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
        case 'utteranceStart':
          cb?.onUtteranceStart?.(...(args as Parameters<AvatarSessionEvents['utteranceStart']>));
          break;
        case 'utteranceText':
          cb?.onUtteranceText?.(...(args as Parameters<AvatarSessionEvents['utteranceText']>));
          break;
        case 'utteranceEnd':
          cb?.onUtteranceEnd?.(...(args as Parameters<AvatarSessionEvents['utteranceEnd']>));
          break;
        case 'mediaDiscarded':
          cb?.onMediaDiscarded?.(...(args as Parameters<AvatarSessionEvents['mediaDiscarded']>));
          break;
        case 'audioFrameSent':
          cb?.onAudioFrameSent?.(...(args as Parameters<AvatarSessionEvents['audioFrameSent']>));
          break;
        case 'audioBlocked':
          cb?.onAudioBlocked?.();
          break;
        case 'muteChange':
        case 'micBacking':
          // No constructor-callback twin: these events are new, and adding one would grow the
          // callback bag the events API exists to replace.
          break;
        case 'diagnostic':
          cb?.onDiagnostic?.(...(args as Parameters<AvatarSessionEvents['diagnostic']>));
          break;
        case 'close':
          cb?.onClose?.(...(args as Parameters<AvatarSessionEvents['close']>));
          break;
        case 'error':
          cb?.onError?.(...(args as Parameters<AvatarSessionEvents['error']>));
          break;
      }
    } catch (err) {
      this.logger('debug', `[avatar] callbacks.${event} threw`, { err });
    }
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // One bad subscriber must not take down the session or the other subscribers.
        this.logger('debug', `[avatar] on('${event}') handler threw`, { err });
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

  /** The downlink video codec the box negotiated for this session (`'h264'` when it does not
   *  negotiate). `undefined` before the accept, and in poster mode, where there is no video. */
  get videoCodec(): VideoCodec | undefined {
    return this._videoCodec;
  }

  /** What the box negotiated for this session — the codecs in force, whether video plays. `null`
   *  before the accept. Diagnostics: the fixed shape a session landed in, beside the running
   *  counters in {@link stats}. */
  get negotiated(): NegotiatedInfo | null {
    return this._negotiated;
  }

  /**
   * A snapshot of everything the diagnostic stream has said about this session so far: the connect
   * timeline, the close code, the last keepalive RTT, what was negotiated, and running counters.
   *
   * Safe to call after the session has ended — it is accumulated on the session as diagnostics
   * arrive, not read from the driver, which `teardown()` has already nulled by then.
   */
  stats(): AvatarSessionStats {
    return {
      connect: { ...this._stats.connect },
      closeCode: this._stats.closeCode,
      rttMs: this._stats.rttMs,
      negotiated: this._negotiated,
      counters: { ...this._stats.counters },
    };
  }

  /** Fold one diagnostic into the accumulated stats and capture the negotiated shape. Runs
   *  unguarded by `done` so the terminal `socket_closed` is counted. */
  private ingestDiagnostic(d: AvatarDiagnostic): void {
    const c = this._stats.counters;
    switch (d.type) {
      case 'connect_phase':
        this._stats.connect[d.phase] = d.ms;
        break;
      case 'socket_closed':
        this._stats.closeCode = d.code;
        break;
      case 'rtt':
        this._stats.rttMs = d.ms;
        break;
      case 'negotiated':
        this._negotiated = {
          micCodec: d.micCodec,
          videoCodec: d.videoCodec,
          hasVideo: d.hasVideo,
          posterMode: d.posterMode,
          features: d.features,
        };
        break;
      case 'protocol_violation':
        c.protocolViolations += 1;
        break;
      case 'server_error':
        c.serverErrors += 1;
        break;
      case 'media_error':
        c.mediaErrors += 1;
        break;
      case 'buffer_evicted':
        c.bufferEvictions += 1;
        break;
      case 'playback_rejected':
        c.playbackRejections += 1;
        break;
      case 'stall':
        c.stalls += 1;
        break;
      case 'mic_track':
        c.micTrackEvents += 1;
        break;
      case 'mic_backing':
        c.micBackingChanges += 1;
        break;
      case 'frame_dropped':
        c.framesDropped += 1;
        break;
      case 'text_failed':
        c.textFailures += 1;
        break;
    }
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

  /** The downlink video codecs this browser can decode, as offered in the hello under
   *  `videoCodec: 'auto'`. Diagnostics: what a host would report next to `session.videoCodec` to
   *  explain why a given session landed where it did. `[]` without MSE. */
  static decodableVideoCodecs(): VideoCodec[] {
    return MsePlayer.decodableVideoCodecs();
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

    // Best-effort, and BOUNDED: a prewarm that hangs used to hold the whole connect hostage
    // before the session socket was even created (avatar#513). Past the deadline the connect
    // proceeds without it, and the host hears a non-terminal `timeout`/`prewarm` so it can count
    // how often that happens.
    if (this.opts.prewarm) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.opts.prewarm?.()),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), PREWARM_TIMEOUT_MS);
          }),
        ]).then((outcome) => {
          if (outcome === 'timeout' && !this.done) {
            this.emit(
              'error',
              new AvatarError('timeout', `prewarm exceeded ${PREWARM_TIMEOUT_MS / 1000}s`, {
                terminal: false,
                stage: 'prewarm',
              })
            );
          }
        });
      } catch {
        /* best-effort */
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (this.done) return;

    const dev = this.opts.dev ?? false;
    // The uplink codec preference goes in the hello, which the driver sends synchronously on
    // socket open — so the (async) WebCodecs probe has to happen here, before the driver exists.
    // Nothing else may run between the probe and the driver taking permittedStream below: an
    // end() during the await must still find the stream for teardown() to stop.
    const wantsOpus = this.opts.mic !== false && (this.opts.micCodec ?? 'auto') === 'auto';
    const micCodecs = wantsOpus && (await OpusMicEncoder.supported(dev)) ? ['opus', 'pcm16'] : [];
    // Synchronous, unlike the Opus probe, but computed here for the same reason: the hello goes
    // out the moment the socket opens. `'h264'` offers nothing, which is what the box assumes of
    // any client that says nothing.
    const videoCodecs =
      (this.opts.videoCodec ?? 'auto') === 'auto' ? MsePlayer.decodableVideoCodecs() : [];
    if (this.done) return;
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
      micCodecs,
      videoCodecs,
      dev,
      logger: this.logger,
      sessionId: this.opts.sessionId,
      traceId: this.opts.traceId,
      createSocket: this.opts.createSocket,
      handlers: {
        onAccept: (info) => {
          if (this.done) return;
          this._sessionCapSeconds = info.capSeconds;
          this._personaKey = info.personaKey;
          this._videoCodec = info.videoCodec ?? undefined;
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
        onMicBacking: (backed, reason) => {
          this._micBacked = backed;
          if (!this.done) this.emit('micBacking', { backed, reason });
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
        onUtteranceStart: (utterance) => {
          if (!this.done) this.emit('utteranceStart', utterance);
        },
        onUtteranceText: (utterance) => {
          if (!this.done) this.emit('utteranceText', utterance);
        },
        onUtteranceEnd: (utterance) => {
          if (!this.done) this.emit('utteranceEnd', utterance);
        },
        onMediaDiscarded: (cutoffPtsUs) => {
          if (!this.done) this.emit('mediaDiscarded', cutoffPtsUs);
        },
        onAudioFrameSent: (info) => {
          this._stats.counters.micFramesSent += 1;
          if (!this.done) this.emit('audioFrameSent', info);
        },
        // Unguarded by `done`: socket_closed is emitted by the driver in the same tick as onEnded,
        // which sets done — a guard here would drop exactly the close code this exists to carry.
        onDiagnostic: (d) => {
          this.ingestDiagnostic(d);
          this.emit('diagnostic', d);
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
            this.logger('debug', '[v2] session error', { err });
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

  /** Whether the frames on the mic channel are the microphone right now. `false` before the
   *  accept, in a receive-only session, while a promised stream is pending, after a refusal, and
   *  after the track ended — the wire then carries zeroed frames, or nothing at all. */
  get micBacked(): boolean {
    return this._micBacked;
  }

  /**
   * Back the mic channel with a microphone, now: the `stream` given, or one asked of getUserMedia
   * (call this from a click or tap — iOS refuses a prompt outside a gesture). The wire switches
   * from zeroed frames to the microphone without a reconnect; `micReady` and `micBacking` fire.
   * Rejects with the raw getUserMedia/worklet error when the capture cannot come up, and when
   * the session has no mic channel (receive-only, not yet accepted, or ended). The channel is
   * unchanged either way.
   */
  enableMic(stream?: MediaStream): Promise<void> {
    const driver = this.driver;
    if (this.done || !driver) return Promise.reject(new Error('session is not running'));
    return driver.enableMic(stream);
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

  /** Avatar voice still queued to play, in ms, or `null` when this session has no playout clock
   *  to ask — a video session or one that has not accepted yet. `null` is "unknown", not "none".
   *
   *  Intended for `attachCaptions`'s `remainingVoiceMs`, which needs to know how much voice is
   *  left when an utterance ends so it can time the words it has not revealed yet. */
  bufferedVoiceMs(): number | null {
    return this.driver?.bufferedVoiceMs() ?? null;
  }

  /** Current local playout position on the server media timeline. Null before playback starts. */
  playedPtsUs(): number | null {
    return this.driver?.playedPtsUs() ?? null;
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
    // Stop the retained stream if openSession() never transferred it to the driver — including
    // one still being waited for: a permission granted after the call ended must not leave a
    // live microphone behind.
    const retained = this.permittedStream;
    this.permittedStream = null;
    if (retained && 'then' in retained) {
      retained.then(
        (stream) => {
          stream?.getTracks().forEach((t) => {
            t.stop();
          });
        },
        () => {}
      );
    } else {
      retained?.getTracks().forEach((t) => {
        t.stop();
      });
    }
  }
}
