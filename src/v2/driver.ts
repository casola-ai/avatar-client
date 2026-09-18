import type { AvatarDiagnostic, ConnectPhase, DiagnosticData } from '../diagnostics';
import {
  AvatarError,
  type AvatarErrorKind,
  type AvatarErrorStage,
  classifyMicError,
  toAvatarError,
} from '../errors';
import { consoleLogger, type Logger } from '../logger';
import { type MediaUnit, MediaUnitAssembler } from '../media-unit-assembler';
import { OpusMicEncoder } from '../mic-encoder';
import {
  MIC_SAMPLE_RATE,
  type MicFrameInfo,
  MicPipeline,
  VIDEO_MEDIA_TIME_UNKNOWN,
} from '../mic-pipeline';
import { MsePlayer } from '../mse-player';
import { PcmPlayer } from '../pcm-player';
import type { PlayoutClock } from '../playout-clock';
import {
  type AcceptMessage,
  type AudioChannelDescriptor,
  type ClientConnection,
  CloseCode,
  clientProtocolConnection,
  Feature,
  FrameType,
  HANDSHAKE_TIMEOUT_MS,
  MAX_INSTRUCTION_CHARS,
  MAX_SEQ,
  MAX_TEXT_CHARS,
  type MediaFrame,
  type ServerMessage,
  SUBPROTOCOL,
  type VideoChannelDescriptor,
  type VideoCodec,
  type WebSocketLike,
  webSocketTransport,
} from '../protocol';
import { type TimedUtterance, UtteranceScheduler } from '../utterance-scheduler';

export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';

export interface Turn {
  text: string;
  reply: string;
  language?: string;
  speechId?: string;
  /** True when assistant caption visibility comes from timed utterance callbacks, not turn.reply. */
  timedUtterances?: boolean;
}

interface TextWaiter {
  resolve: (turn: Turn) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The socket the driver opens. Browser `WebSocket` satisfies this; tests inject a fake. */
export interface DriverSocket extends WebSocketLike {
  /** The subprotocol the server echoed on the 101 (empty until open). */
  readonly protocol?: string;
}

export interface V2DriverHandlers {
  onAccept(info: {
    capSeconds: number;
    personaKey: string;
    posterUrl: string | null;
    hasVideo: boolean;
    /** The negotiated downlink video codec, `null` in poster mode. A box that does not negotiate
     *  sends no `video_codec`, which means `'h264'` — the only stream there has ever been. */
    videoCodec: VideoCodec | null;
  }): void;
  onFirstFrame(): void;
  onMicReady(): void;
  onPartial(text: string): void;
  onTurn(turn: Turn): void;
  onSpeechStart(speechId: string): void;
  onSpeechEnd(speechId: string): void;
  onUtteranceStart(utterance: TimedUtterance): void;
  onUtteranceText(utterance: TimedUtterance): void;
  onUtteranceEnd(utterance: TimedUtterance): void;
  onMediaDiscarded(cutoffPtsUs: number): void;
  onAudioFrameSent(info: MicFrameInfo): void;
  onAudioBlocked(): void;
  /** The session is over after a successful handshake — server end or transport loss. */
  onEnded(reason: EndReason): void;
  /** terminal=true: the session cannot proceed (connect/handshake/mic failure).
   *  terminal=false: an in-band server error or media hiccup; the session keeps running.
   *  Always an `AvatarError` — the driver classifies before it hands anything up. */
  onError(err: AvatarError, terminal: boolean): void;
  /** Bounded operational fact about the session (see `AvatarDiagnostic`). Optional: absent means
   *  the driver's behavior is unchanged. Fires unguarded, so `socket_closed` reaches the host even
   *  though it lands in the same tick as `onEnded`. */
  onDiagnostic?(d: AvatarDiagnostic): void;
}

export interface V2DriverOpts {
  videoEl: HTMLVideoElement;
  sessionWsUrl: string;
  mic: boolean;
  langs: string[];
  responseLanguage?: string;
  workletUrl: string;
  permittedStream?: MediaStream;
  /** Uplink codec preference list for `hello.mic.codecs`, e.g. `['opus', 'pcm16']`. Empty or
   *  omitted = the field is left out and the box answers pcm16. The accept's ch1 descriptor
   *  says what was chosen; the driver encodes accordingly. */
  micCodecs?: string[];
  /** Downlink codecs this browser can decode, for `hello.video.codecs` (see
   *  `MsePlayer.decodableVideoCodecs`). A capability list, not a preference: the box picks from it
   *  in its own order. Empty/omitted, or a session that offers no video at all, leaves the field
   *  out and the box serves h264. */
  videoCodecs?: string[];
  dev: boolean;
  /** Where the driver and its players route internal logs. Defaults to a dev-gated console. */
  logger?: Logger;
  /** Stamped on every diagnostic so a report can be joined to the mint and the support trace.
   *  The driver never puts them on the wire — they ride diagnostics only. */
  sessionId?: string;
  traceId?: string;
  handlers: V2DriverHandlers;
  /** Test seam — defaults to `new WebSocket(url, protocols)`. */
  createSocket?: (url: string, protocols: string[]) => DriverSocket;
}

/** Close code → what the host should tell the user. The `kind` is the point: a 4003 is the box
 *  refusing the pinned avatar, which has nothing to do with the caller's microphone. */
const CLOSE_CODE_ERRORS: Record<number, { kind: AvatarErrorKind; message: string }> = {
  [CloseCode.UNAUTHORIZED]: {
    kind: 'unauthorized',
    message: 'session token rejected (4001 unauthorized)',
  },
  [CloseCode.PROTOCOL_MISMATCH]: {
    kind: 'protocol-mismatch',
    message: 'box does not speak protocol v2 (4002)',
  },
  [CloseCode.PERSONA_UNRESOLVABLE]: {
    kind: 'persona-unavailable',
    message: 'persona unresolvable on the box (4003)',
  },
  [CloseCode.CAPACITY]: { kind: 'capacity', message: 'box at capacity (4004)' },
  [CloseCode.POLICY]: { kind: 'policy', message: 'protocol policy violation (4008)' },
};

const END_REASONS: readonly EndReason[] = ['cap', 'kicked', 'expired', 'dropped'];
const PLAYOUT_ACK_INTERVAL_MS = 300;
const KEEPALIVE_PING_MS = 15_000;
const TEXT_TIMEOUT_MS = 30_000;
/**
 * `new WebSocket` → `open`. Generous on purpose: the box's router completes the upgrade only after
 * its persona pull (`conv_router.py` accepts after `_ensure_persona`, up to ~22 s on a cold
 * persona), so a healthy connect can legitimately sit in CONNECTING for 25 s. Anything past this
 * is a black-holed upgrade, which before this timer was "Connecting…" forever (avatar#513).
 */
const OPEN_TIMEOUT_MS = 30_000;
/** `accept` → first decoded video frame, video sessions only (poster mode has no frame to wait for). */
const FIRST_MEDIA_TIMEOUT_MS = 20_000;

/**
 * The protocol-v2 session driver: one WebSocket, JSON control + binary media frames
 * (docs/avatar-protocol-v2-spec.md). Owns the connection, the mic pipeline (channel 1 up),
 * PCM playback (channel 2 down) and MSE video (channel 3 down); AvatarSession owns the
 * user-facing state machine and callbacks.
 */
export class V2Driver {
  private conn: ClientConnection | null = null;
  private mse: MsePlayer | null = null;
  private player: PcmPlayer | null = null;
  private clock: PlayoutClock | null = null;
  private scheduler: UtteranceScheduler | null = null;
  private readonly unitAssembler = new MediaUnitAssembler((reason) =>
    this.diag({ type: 'frame_dropped', reason })
  );
  private pipeline: MicPipeline | null = null;
  private encoder: OpusMicEncoder | null = null;

  private accepted: AcceptMessage | null = null;
  private audioCh: AudioChannelDescriptor | null = null;
  private micCh: AudioChannelDescriptor | null = null;
  private endReason: EndReason | null = null;
  private finished = false;
  private timedUtterances = false;
  private framedMediaUnits = false;

  private connectStartedAt = 0;
  private firstAudioReported = false;
  private readonly log: Logger;

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private textSequence = 0;
  private readonly textWaiters = new Map<string, TextWaiter>();

  private langs: string[];
  private responseLanguage: string | undefined;

  constructor(private readonly opts: V2DriverOpts) {
    this.langs = opts.langs;
    this.responseLanguage = opts.responseLanguage;
    this.log = opts.logger ?? consoleLogger(opts.dev);
  }

  /** Emit one diagnostic, stamped with the wall clock and the ids the host passed. Never throws
   *  into the driver: a host `onDiagnostic` that blows up must not take the session down. */
  private diag(d: DiagnosticData): void {
    const sink = this.opts.handlers.onDiagnostic;
    if (!sink) return;
    try {
      sink({
        at: Date.now(),
        ...(this.opts.sessionId !== undefined ? { sessionId: this.opts.sessionId } : {}),
        ...(this.opts.traceId !== undefined ? { traceId: this.opts.traceId } : {}),
        ...d,
      } as AvatarDiagnostic);
    } catch {
      /* a diagnostic sink must not affect the session */
    }
  }

  /** ms since the socket was created — the basis for every `connect_phase`. */
  private phase(phase: ConnectPhase): void {
    this.diag({ type: 'connect_phase', phase, ms: Date.now() - this.connectStartedAt });
  }

  connect(): void {
    const { opts } = this;
    const create =
      opts.createSocket ?? ((url: string, protocols: string[]) => new WebSocket(url, protocols));
    this.connectStartedAt = Date.now();
    let socket: DriverSocket;
    try {
      socket = create(opts.sessionWsUrl, [SUBPROTOCOL]);
    } catch (err) {
      this.fail(err);
      return;
    }
    const transport = webSocketTransport(socket);
    const conn = clientProtocolConnection(transport);
    this.conn = conn;
    // Armed from the moment the socket exists. The handshake timer below cannot cover this gap:
    // it starts on `open`, and the failure here is that `open` never comes.
    this.openTimer = setTimeout(() => {
      this.fail(
        new Error(`socket open timeout: no open within ${OPEN_TIMEOUT_MS / 1000}s`),
        'timeout',
        'open'
      );
    }, OPEN_TIMEOUT_MS);

    transport.onOpen(() => {
      if (this.openTimer) clearTimeout(this.openTimer);
      this.openTimer = null;
      if (this.finished) return;
      this.phase('socket_open');
      // Browsers fail the connection themselves when a requested subprotocol is not granted;
      // this guards the non-browser sockets (tests, future runtimes) to the same rule.
      if (socket.protocol !== undefined && socket.protocol !== SUBPROTOCOL) {
        this.fail(new Error(`server did not echo subprotocol ${SUBPROTOCOL}`), 'protocol-mismatch');
        return;
      }
      const acceptsVideo = MsePlayer.supported();
      conn.send({
        type: 'hello',
        proto: 2,
        accept: {
          audio: ['pcm16'],
          ...(acceptsVideo ? { video: ['fmp4'] } : {}),
        },
        // Only meaningful alongside `accept.video`: a poster-mode client decodes nothing.
        ...(acceptsVideo && opts.videoCodecs?.length
          ? { video: { codecs: opts.videoCodecs } }
          : {}),
        ...(opts.mic
          ? {
              mic: {
                codec: 'pcm16',
                sample_rate: MIC_SAMPLE_RATE,
                ...(opts.micCodecs?.length ? { codecs: opts.micCodecs } : {}),
              },
            }
          : {}),
        ...(this.langs.length ? { langs: this.langs } : {}),
        ...(this.responseLanguage !== undefined
          ? { response_language: this.responseLanguage }
          : {}),
        features: [Feature.UTTERANCE_TIMING_V1, Feature.MEDIA_UNIT_FLAGS_V1],
        resume: null,
      });
      this.handshakeTimer = setTimeout(() => {
        this.fail(new Error('handshake timeout: no accept from the box'), 'handshake', 'handshake');
      }, HANDSHAKE_TIMEOUT_MS);
    });

    conn.onMessage((msg) => this.onServerMessage(msg));
    conn.onFrame((frame) => this.onMediaFrame(frame));
    conn.onViolation((v) => {
      this.log('debug', '[v2] protocol violation', { kind: v.kind, detail: v.detail });
      this.diag({ type: 'protocol_violation', violation: v.kind, state: v.state });
    });
    conn.onClose((ev) => this.onSocketClose(ev.code, ev.reason));
  }

  private onServerMessage(msg: ServerMessage): void {
    if (this.finished) return;
    switch (msg.type) {
      case 'accept':
        this.onAccept(msg);
        break;
      case 'partial':
        this.opts.handlers.onPartial(msg.text);
        break;
      case 'turn': {
        const turn: Turn = {
          text: msg.text,
          reply: msg.reply ?? '',
          language: msg.language,
          speechId: msg.speech_id,
          ...(this.timedUtterances ? { timedUtterances: true } : {}),
        };
        const waiter = msg.request_id ? this.textWaiters.get(msg.request_id) : undefined;
        if (waiter && msg.request_id) {
          clearTimeout(waiter.timer);
          this.textWaiters.delete(msg.request_id);
          waiter.resolve(turn);
        } else {
          this.opts.handlers.onTurn(turn);
        }
        break;
      }
      case 'speech_start':
        if (!this.timedUtterances) this.opts.handlers.onSpeechStart(msg.speech_id);
        break;
      case 'speech_end':
        if (!this.timedUtterances) this.opts.handlers.onSpeechEnd(msg.speech_id);
        break;
      case 'utterance_start':
        if (this.timedUtterances) this.scheduler?.receiveStart(msg);
        break;
      case 'utterance_text':
        if (this.timedUtterances) this.scheduler?.receiveText(msg);
        break;
      case 'utterance_end':
        if (this.timedUtterances) this.scheduler?.receiveEnd(msg);
        break;
      case 'interruption':
        if (msg.cutoff_pts_us === null) {
          this.player?.flush();
          const cutoff = this.clock?.playedPtsUs() ?? 0;
          this.unitAssembler.discardFrom(cutoff);
          if (this.mse) {
            void this.mse
              .discardFrom(cutoff)
              .then(() => this.opts.handlers.onMediaDiscarded(cutoff));
          } else {
            this.opts.handlers.onMediaDiscarded(cutoff);
          }
        } else {
          this.unitAssembler.discardFrom(msg.cutoff_pts_us);
          const cutoff = msg.cutoff_pts_us;
          const discarded = this.clock?.discardFrom(cutoff) ?? Promise.resolve();
          void discarded.then(() => this.opts.handlers.onMediaDiscarded(cutoff));
          if ('utterance_ids' in msg) {
            this.scheduler?.interrupt(msg.cutoff_pts_us, msg.utterance_ids);
          }
        }
        break;
      case 'instruction_set':
        // idempotent ack; nothing to surface
        break;
      case 'error': {
        const error = new Error(msg.message ?? msg.code);
        const waiter = msg.request_id ? this.textWaiters.get(msg.request_id) : undefined;
        this.diag({ type: 'server_error', code: msg.code, inFlightRequest: Boolean(waiter) });
        if (waiter && msg.request_id) {
          clearTimeout(waiter.timer);
          this.textWaiters.delete(msg.request_id);
          waiter.reject(error);
        } else {
          // In-band: the box reported a problem but the socket stays up. Keep the wire `code` on
          // the error — flattening it into the message used to lose it (charmingly#288, §D.10).
          this.opts.handlers.onError(
            toAvatarError(error, 'server', { terminal: false, serverCode: msg.code }),
            false
          );
        }
        break;
      }
      case 'session_end':
        this.endReason = (END_REASONS as readonly string[]).includes(msg.reason)
          ? (msg.reason as EndReason)
          : 'generic';
        this.diag({ type: 'session_end', reason: msg.reason, mapped: this.endReason });
        break;
      case 'ping':
        this.conn?.send({ type: 'pong', t: msg.t });
        break;
      case 'pong':
        // The keepalive round trip: the box echoed the `t` we stamped when we sent the ping.
        this.diag({ type: 'rtt', ms: Math.max(0, Date.now() - msg.t) });
        break;
      case 'go_away':
        this.diag({ type: 'go_away', deadlineS: msg.deadline_s ?? null });
        break;
    }
  }

  private onAccept(accept: AcceptMessage): void {
    if (this.accepted) return;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    this.phase('accept');
    this.accepted = accept;
    const acceptedFeatures = accept.features ?? [];
    this.timedUtterances = acceptedFeatures.includes(Feature.UTTERANCE_TIMING_V1);
    this.framedMediaUnits = acceptedFeatures.includes(Feature.MEDIA_UNIT_FLAGS_V1);
    const { handlers } = this.opts;

    const channels = accept.channels;
    const videoCh = channels.find((c): c is VideoChannelDescriptor => c.kind === 'video');
    this.audioCh =
      channels.find((c): c is AudioChannelDescriptor => c.kind === 'audio' && c.dir === 'down') ??
      null;
    this.micCh =
      channels.find((c): c is AudioChannelDescriptor => c.kind === 'audio' && c.dir === 'up') ??
      null;

    this.diag({
      type: 'negotiated',
      micCodec: this.micCh?.codec ?? null,
      videoCodec: videoCh ? (videoCh.video_codec ?? 'h264') : null,
      hasVideo: Boolean(videoCh),
      posterMode: !videoCh,
      features: acceptedFeatures,
    });

    if (this.audioCh) {
      this.player = new PcmPlayer(() => handlers.onAudioBlocked());
      this.clock = this.player;
    }
    this.pingTimer = setInterval(() => {
      this.conn?.send({ type: 'ping', t: Date.now() });
    }, KEEPALIVE_PING_MS);

    if (videoCh) {
      const mse = new MsePlayer(this.opts.videoEl, this.log);
      this.mse = mse;
      // Accepted, but nothing ever plays: a box whose render path stalled after the handshake.
      // Video sessions only — poster mode reports its first frame synchronously just below.
      this.mediaTimer = setTimeout(() => {
        this.fail(
          new Error(`no first video frame within ${FIRST_MEDIA_TIMEOUT_MS / 1000}s of accept`),
          'timeout',
          'first-media'
        );
      }, FIRST_MEDIA_TIMEOUT_MS);
      mse.attach({
        onFirstFrame: () => {
          if (this.mediaTimer) clearTimeout(this.mediaTimer);
          this.mediaTimer = null;
          this.phase('first_frame');
          handlers.onFirstFrame();
        },
        onError: (err) => handlers.onError(toAvatarError(err, 'media', { terminal: false }), false),
        onAudioBlocked: () => handlers.onAudioBlocked(),
        onDiagnostic: (d) => this.diag(d),
      });
      mse.setMime(videoCh.mime);
      if (videoCh.fps !== undefined && videoCh.seg_frames !== undefined) {
        mse.setMediaUnitTiming(videoCh.fps, videoCh.seg_frames);
      }
      this.clock = mse;
    } else {
      // Poster mode: no video channel this session; the poster is the visual.
      if (accept.poster?.url) this.opts.videoEl.poster = accept.poster.url;
      this.phase('first_frame');
      handlers.onFirstFrame();
    }

    if (this.timedUtterances && this.clock) {
      this.scheduler = new UtteranceScheduler(this.clock, {
        onStart: (utterance) => {
          handlers.onUtteranceStart(utterance);
          handlers.onSpeechStart(utterance.utteranceId);
        },
        onText: (utterance) => handlers.onUtteranceText(utterance),
        onEnd: (utterance) => {
          handlers.onUtteranceEnd(utterance);
          handlers.onSpeechEnd(utterance.utteranceId);
        },
      });
    }
    this.ackTimer = setInterval(() => {
      const clock = this.clock;
      const playedPtsUs = clock?.playedPtsUs() ?? null;
      if (!clock || playedPtsUs === null) return;
      this.conn?.send({
        type: 'playout_ack',
        played_pts_us: playedPtsUs,
        buffered_ms: clock.bufferedMs(),
      });
    }, PLAYOUT_ACK_INTERVAL_MS);

    if (this.opts.mic && this.micCh) this.startMic(this.micCh);

    handlers.onAccept({
      capSeconds: accept.cap_seconds,
      personaKey: accept.persona_key,
      posterUrl: accept.poster?.url ?? null,
      hasVideo: Boolean(videoCh),
      // Absent `video_codec` = h264: a box that serves only the baseline says nothing at all.
      videoCodec: videoCh ? (videoCh.video_codec ?? 'h264') : null,
    });
  }

  private startMic(micCh: AudioChannelDescriptor): void {
    // The box chose the uplink codec from our hello.mic.codecs; its ch1 descriptor is the answer.
    // pcm16: the pipeline's Int16 frames go out as-is. opus: one WebCodecs packet per frame.
    let onFrame = (pcm: Int16Array, info: MicFrameInfo): void =>
      this.sendMicFrame(micCh.id, new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), info);
    if (micCh.codec === 'opus') {
      let encoder: OpusMicEncoder;
      try {
        encoder = new OpusMicEncoder({
          logger: this.log,
          onPacket: (packet, info) => this.sendMicFrame(micCh.id, packet, info),
          // A dead encoder is a dead mic: terminal, like a worklet that failed to load.
          onError: (err) => this.fail(err, 'mic-failed'),
        });
      } catch (err) {
        this.fail(err, 'mic-failed');
        return;
      }
      this.encoder = encoder;
      onFrame = (pcm, info) => encoder.encode(pcm, info);
    }
    const pipeline = new MicPipeline();
    this.pipeline = pipeline;
    pipeline
      .start({
        workletUrl: this.opts.workletUrl,
        stream: this.opts.permittedStream,
        logger: this.log,
        getVideoMediaTimeMs: this.mse ? (t) => this.mse?.mediaTimeAt(t) ?? null : undefined,
        onFrame,
        onDiagnostic: (d) => this.diag(d),
      })
      .then(() => {
        if (this.finished) return;
        this.phase('mic_ready');
        this.opts.handlers.onMicReady();
      })
      .catch((err: unknown) => {
        // getUserMedia denial / worklet load failure — terminal, matching the v1 contract.
        // Classified here so the host can tell "you denied the mic" from "the worklet died".
        this.fail(err, classifyMicError(err));
      });
  }

  private sendMicFrame(channelId: number, payload: Uint8Array, info: MicFrameInfo): void {
    const conn = this.conn;
    if (this.finished || !conn || conn.protocolState !== 'active') return;
    // Spec: mic-uplink pts is the displayed media time at capture; 0 when it cannot be
    // determined (poster mode, or before the first displayed video frame).
    const ptsUs =
      info.videoMediaTimeMs === VIDEO_MEDIA_TIME_UNKNOWN ? 0 : info.videoMediaTimeMs * 1000;
    conn.sendFrame({
      frameType: FrameType.MEDIA,
      channelId,
      flags: 0,
      seq: info.micSeq % (MAX_SEQ + 1),
      ptsUs,
      payload,
    });
    this.opts.handlers.onAudioFrameSent(info);
  }

  private onMediaFrame(frame: MediaFrame): void {
    if (this.finished) return;
    if (frame.frameType !== FrameType.MEDIA_INIT && frame.frameType !== FrameType.MEDIA) return;
    const unit = this.framedMediaUnits
      ? this.unitAssembler.push(frame)
      : {
          frameType: frame.frameType,
          channelId: frame.channelId,
          ptsUs: frame.ptsUs,
          payload: frame.payload,
        };
    if (!unit) return;
    this.onMediaUnit(unit);
  }

  private onMediaUnit(unit: MediaUnit): void {
    if (this.audioCh && unit.channelId === this.audioCh.id) {
      if (unit.payload.byteLength === 0 || unit.payload.byteLength % 2 !== 0) return;
      if (!this.firstAudioReported) {
        this.firstAudioReported = true;
        this.phase('first_audio');
      }
      // Copy: Int16Array needs 2-byte alignment, and a subarray into the frame buffer has
      // arbitrary byteOffset.
      const pcm = new Int16Array(
        unit.payload.buffer.slice(
          unit.payload.byteOffset,
          unit.payload.byteOffset + unit.payload.byteLength
        )
      );
      this.player?.enqueue({ pcm, sampleRate: this.audioCh.sample_rate, ptsUs: unit.ptsUs });
      return;
    }
    if (
      this.mse &&
      this.accepted?.channels.some((c) => c.kind === 'video' && c.id === unit.channelId)
    ) {
      this.mse.append(unit.payload, unit.ptsUs, unit.frameType === FrameType.MEDIA_INIT);
    }
    // Frames on undeclared/unknown channels: must-ignore.
  }

  private onSocketClose(code: number, reason = ''): void {
    if (this.finished) {
      this.teardown();
      return;
    }
    this.finished = true;
    const { handlers } = this.opts;
    const accepted = this.accepted !== null;
    const endReason = this.endReason;
    // Before the teardown that nulls everything: the code and whether we had accepted are exactly
    // what `edge_disconnect` used to flatten away (charmingly#288, §D.1). Fires before onEnded,
    // and unguarded, so a host that tears down on `close` still sees it.
    this.diag({ type: 'socket_closed', code, afterAccept: accepted, reasonLength: reason.length });
    this.teardown();
    if (endReason) {
      handlers.onEnded(endReason);
    } else if (accepted) {
      handlers.onEnded('edge_disconnect');
    } else {
      const known = CLOSE_CODE_ERRORS[code];
      handlers.onError(
        new AvatarError(
          known?.kind ?? 'connect',
          known?.message ?? `session socket closed before accept (${code})`,
          { closeCode: code }
        ),
        true
      );
    }
  }

  private fail(err: unknown, kind: AvatarErrorKind = 'connect', stage?: AvatarErrorStage): void {
    if (this.finished) return;
    this.finished = true;
    this.teardown();
    try {
      this.conn?.close(CloseCode.NORMAL);
    } catch {
      /* */
    }
    this.opts.handlers.onError(toAvatarError(err, kind, { stage }), true);
  }

  async sendText(text: string): Promise<Turn> {
    const value = text.trim();
    if (!value) throw new Error('text is required');
    if (value.length > MAX_TEXT_CHARS) throw new Error('text is too long');
    const conn = this.conn;
    if (this.finished || !conn || conn.protocolState !== 'active') {
      this.diag({ type: 'text_failed', reason: 'transport' });
      throw new Error('text transport is unavailable');
    }
    this.textSequence += 1;
    const id = `text-${this.textSequence}`;
    const result = new Promise<Turn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.textWaiters.delete(id);
        this.diag({ type: 'text_failed', reason: 'timeout' });
        reject(new Error('text response timed out'));
      }, TEXT_TIMEOUT_MS);
      this.textWaiters.set(id, { resolve, reject, timer });
    });
    conn.send({ type: 'text', id, text: value });
    return result;
  }

  /** Re-pin the ASR recognition language(s) mid-session; applied by the box on the next turn. */
  setLangs(langs: string[]): void {
    this.langs = langs;
    if (this.conn?.protocolState === 'active') this.conn.send({ type: 'set_langs', langs });
  }

  /** Change the preferred REPLY language mid-session (BCP-47; '' clears). */
  setResponseLanguage(language: string): void {
    this.responseLanguage = language;
    if (this.conn?.protocolState === 'active') {
      this.conn.send({ type: 'set_response_language', language });
    }
  }

  /** Replace the hidden runtime instruction appended to the avatar's system prompt. */
  setRuntimeInstruction(instruction: string): void {
    const value = instruction.trim();
    if (value.length > MAX_INSTRUCTION_CHARS) throw new Error('runtime instruction is too long');
    if (this.conn?.protocolState === 'active') {
      this.conn.send({ type: 'set_instruction', instruction: value });
    }
  }

  setMuted(muted: boolean): void {
    this.pipeline?.setMuted(muted);
  }

  unmuteAudio(): boolean {
    const mse = this.mse?.unmuteAudio() ?? true;
    const pcm = this.player?.unmute() ?? true;
    return mse && pcm;
  }

  /** Avatar voice queued ahead of the playhead, in ms — how much is still to be heard. `null`
   *  when this session has no playout clock to ask: a video session, whose audio is muxed into
   *  the fMP4 and never reaches a `PcmPlayer`, or a session that has not accepted yet. `null`
   *  means "unknown", never "nothing left", so a caller must not read it as zero. */
  bufferedVoiceMs(): number | null {
    return this.clock?.bufferedMs() ?? null;
  }

  playedPtsUs(): number | null {
    return this.clock?.playedPtsUs() ?? null;
  }

  /** Deliberate local end: say goodbye, close, release resources. Fires no handler — the
   *  caller (AvatarSession) already decided the outcome. */
  stop(): void {
    const wasFinished = this.finished;
    this.finished = true;
    if (!wasFinished && this.conn) {
      if (this.conn.protocolState === 'active') {
        try {
          this.conn.send({ type: 'bye' });
        } catch {
          /* */
        }
      }
      try {
        this.conn.close(CloseCode.NORMAL);
      } catch {
        /* */
      }
    }
    this.teardown();
  }

  private teardown(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    if (this.mediaTimer) clearTimeout(this.mediaTimer);
    this.mediaTimer = null;
    if (this.ackTimer) clearInterval(this.ackTimer);
    this.ackTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const waiter of this.textWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('session ended'));
    }
    this.textWaiters.clear();
    this.pipeline?.stop();
    this.encoder?.stop();
    this.encoder = null;
    this.pipeline = null;
    this.player?.stop();
    this.player = null;
    this.mse?.stop();
    this.mse = null;
    this.scheduler?.stop();
    this.scheduler = null;
    this.clock = null;
    this.unitAssembler.clear();
  }
}
