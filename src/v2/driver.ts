import { type MicFrameInfo, MicPipeline, VIDEO_MEDIA_TIME_UNKNOWN } from '../mic-pipeline';
import { MsePlayer } from '../mse-player';
import { PcmPlayer } from '../pcm-player';
import {
  type AcceptMessage,
  type AudioChannelDescriptor,
  type ClientConnection,
  CloseCode,
  clientProtocolConnection,
  FrameType,
  HANDSHAKE_TIMEOUT_MS,
  MAX_INSTRUCTION_CHARS,
  MAX_SEQ,
  MAX_TEXT_CHARS,
  type MediaFrame,
  type ServerMessage,
  SUBPROTOCOL,
  type VideoChannelDescriptor,
  type WebSocketLike,
  webSocketTransport,
} from '../protocol';

export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';

export interface Turn {
  text: string;
  reply: string;
  language?: string;
  speechId?: string;
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
  }): void;
  onFirstFrame(): void;
  onMicReady(): void;
  onPartial(text: string): void;
  onTurn(turn: Turn): void;
  onSpeechStart(speechId: string): void;
  onSpeechEnd(speechId: string): void;
  onAudioFrameSent(info: MicFrameInfo): void;
  onAudioBlocked(): void;
  /** The session is over after a successful handshake — server end or transport loss. */
  onEnded(reason: EndReason): void;
  /** terminal=true: the session cannot proceed (connect/handshake/mic failure).
   *  terminal=false: an in-band server error or media hiccup; the session keeps running. */
  onError(err: unknown, terminal: boolean): void;
}

export interface V2DriverOpts {
  videoEl: HTMLVideoElement;
  sessionWsUrl: string;
  mic: boolean;
  langs: string[];
  responseLanguage?: string;
  workletUrl: string;
  permittedStream?: MediaStream;
  dev: boolean;
  handlers: V2DriverHandlers;
  /** Test seam — defaults to `new WebSocket(url, protocols)`. */
  createSocket?: (url: string, protocols: string[]) => DriverSocket;
}

const CLOSE_CODE_ERRORS: Record<number, string> = {
  [CloseCode.UNAUTHORIZED]: 'session token rejected (4001 unauthorized)',
  [CloseCode.PROTOCOL_MISMATCH]: 'box does not speak protocol v2 (4002)',
  [CloseCode.PERSONA_UNRESOLVABLE]: 'persona unresolvable on the box (4003)',
  [CloseCode.CAPACITY]: 'box at capacity (4004)',
  [CloseCode.POLICY]: 'protocol policy violation (4008)',
};

const END_REASONS: readonly EndReason[] = ['cap', 'kicked', 'expired', 'dropped'];
const PLAYOUT_ACK_INTERVAL_MS = 300;
const KEEPALIVE_PING_MS = 15_000;
const TEXT_TIMEOUT_MS = 30_000;

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
  private pipeline: MicPipeline | null = null;

  private accepted: AcceptMessage | null = null;
  private audioCh: AudioChannelDescriptor | null = null;
  private micCh: AudioChannelDescriptor | null = null;
  private endReason: EndReason | null = null;
  private finished = false;

  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private textSequence = 0;
  private readonly textWaiters = new Map<string, TextWaiter>();

  private langs: string[];
  private responseLanguage: string | undefined;

  constructor(private readonly opts: V2DriverOpts) {
    this.langs = opts.langs;
    this.responseLanguage = opts.responseLanguage;
  }

  connect(): void {
    const { opts } = this;
    const create =
      opts.createSocket ?? ((url: string, protocols: string[]) => new WebSocket(url, protocols));
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

    transport.onOpen(() => {
      if (this.finished) return;
      // Browsers fail the connection themselves when a requested subprotocol is not granted;
      // this guards the non-browser sockets (tests, future runtimes) to the same rule.
      if (socket.protocol !== undefined && socket.protocol !== SUBPROTOCOL) {
        this.fail(new Error(`server did not echo subprotocol ${SUBPROTOCOL}`));
        return;
      }
      conn.send({
        type: 'hello',
        proto: 2,
        accept: {
          audio: ['pcm16'],
          ...(MsePlayer.supported() ? { video: ['fmp4'] } : {}),
        },
        ...(opts.mic ? { mic: { codec: 'pcm16', sample_rate: 16000 } } : {}),
        ...(this.langs.length ? { langs: this.langs } : {}),
        ...(this.responseLanguage !== undefined
          ? { response_language: this.responseLanguage }
          : {}),
      });
      this.handshakeTimer = setTimeout(() => {
        this.fail(new Error('handshake timeout: no accept from the box'));
      }, HANDSHAKE_TIMEOUT_MS);
    });

    conn.onMessage((msg) => this.onServerMessage(msg));
    conn.onFrame((frame) => this.onMediaFrame(frame));
    conn.onViolation((v) => {
      if (opts.dev) console.warn('[v2] protocol violation', v.kind, v.detail);
    });
    conn.onClose((ev) => this.onSocketClose(ev.code));
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
        this.opts.handlers.onSpeechStart(msg.speech_id);
        break;
      case 'speech_end':
        this.opts.handlers.onSpeechEnd(msg.speech_id);
        break;
      case 'interruption':
        if (msg.cutoff_pts_us === null) this.player?.flush();
        else this.player?.flushFrom(msg.cutoff_pts_us);
        break;
      case 'instruction_set':
        // idempotent ack; nothing to surface
        break;
      case 'error': {
        const error = new Error(msg.message ?? msg.code);
        const waiter = msg.request_id ? this.textWaiters.get(msg.request_id) : undefined;
        if (waiter && msg.request_id) {
          clearTimeout(waiter.timer);
          this.textWaiters.delete(msg.request_id);
          waiter.reject(error);
        } else {
          this.opts.handlers.onError(error, false);
        }
        break;
      }
      case 'session_end':
        this.endReason = (END_REASONS as readonly string[]).includes(msg.reason)
          ? (msg.reason as EndReason)
          : 'generic';
        break;
      case 'ping':
        this.conn?.send({ type: 'pong', t: msg.t });
        break;
      case 'pong':
      case 'go_away': // spec-reserved; no client behavior this revision
        break;
    }
  }

  private onAccept(accept: AcceptMessage): void {
    if (this.accepted) return;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    this.accepted = accept;
    const { handlers } = this.opts;

    const channels = accept.channels;
    const videoCh = channels.find((c): c is VideoChannelDescriptor => c.kind === 'video');
    this.audioCh =
      channels.find((c): c is AudioChannelDescriptor => c.kind === 'audio' && c.dir === 'down') ??
      null;
    this.micCh =
      channels.find((c): c is AudioChannelDescriptor => c.kind === 'audio' && c.dir === 'up') ??
      null;

    if (this.audioCh) {
      this.player = new PcmPlayer(() => handlers.onAudioBlocked());
      this.ackTimer = setInterval(() => {
        const player = this.player;
        if (!player) return;
        this.conn?.send({
          type: 'playout_ack',
          played_pts_us: player.playedPtsUs(),
          buffered_ms: player.bufferedMs(),
        });
      }, PLAYOUT_ACK_INTERVAL_MS);
    }
    this.pingTimer = setInterval(() => {
      this.conn?.send({ type: 'ping', t: Date.now() });
    }, KEEPALIVE_PING_MS);

    if (videoCh) {
      const mse = new MsePlayer(this.opts.videoEl, this.opts.dev);
      this.mse = mse;
      mse.attach({
        onFirstFrame: () => handlers.onFirstFrame(),
        onError: (err) => handlers.onError(err, false),
        onAudioBlocked: () => handlers.onAudioBlocked(),
      });
      mse.setMime(videoCh.mime);
    } else {
      // Poster mode: no video channel this session; the poster is the visual.
      if (accept.poster?.url) this.opts.videoEl.poster = accept.poster.url;
      handlers.onFirstFrame();
    }

    if (this.opts.mic && this.micCh) this.startMic(this.micCh);

    handlers.onAccept({
      capSeconds: accept.cap_seconds,
      personaKey: accept.persona_key,
      posterUrl: accept.poster?.url ?? null,
      hasVideo: Boolean(videoCh),
    });
  }

  private startMic(micCh: AudioChannelDescriptor): void {
    const pipeline = new MicPipeline();
    this.pipeline = pipeline;
    pipeline
      .start({
        workletUrl: this.opts.workletUrl,
        stream: this.opts.permittedStream,
        dev: this.opts.dev,
        getVideoMediaTimeMs: this.mse ? (t) => this.mse?.mediaTimeAt(t) ?? null : undefined,
        onFrame: (pcm, info) => this.sendMicFrame(micCh.id, pcm, info),
      })
      .then(() => {
        if (!this.finished) this.opts.handlers.onMicReady();
      })
      .catch((err: unknown) => {
        // getUserMedia denial / worklet load failure — terminal, matching the v1 contract.
        this.fail(err);
      });
  }

  private sendMicFrame(channelId: number, pcm: Int16Array, info: MicFrameInfo): void {
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
      payload: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
    });
    this.opts.handlers.onAudioFrameSent(info);
  }

  private onMediaFrame(frame: MediaFrame): void {
    if (this.finished) return;
    if (frame.frameType !== FrameType.MEDIA_INIT && frame.frameType !== FrameType.MEDIA) return;
    if (this.audioCh && frame.channelId === this.audioCh.id) {
      if (frame.payload.byteLength === 0 || frame.payload.byteLength % 2 !== 0) return;
      // Copy: Int16Array needs 2-byte alignment, and a subarray into the frame buffer has
      // arbitrary byteOffset.
      const pcm = new Int16Array(
        frame.payload.buffer.slice(
          frame.payload.byteOffset,
          frame.payload.byteOffset + frame.payload.byteLength
        )
      );
      this.player?.enqueue({ pcm, sampleRate: this.audioCh.sample_rate, ptsUs: frame.ptsUs });
      return;
    }
    if (
      this.mse &&
      this.accepted?.channels.some((c) => c.kind === 'video' && c.id === frame.channelId)
    ) {
      this.mse.append(frame.payload);
    }
    // Frames on undeclared/unknown channels: must-ignore.
  }

  private onSocketClose(code: number): void {
    if (this.finished) {
      this.teardown();
      return;
    }
    this.finished = true;
    const { handlers } = this.opts;
    const accepted = this.accepted !== null;
    const endReason = this.endReason;
    this.teardown();
    if (endReason) {
      handlers.onEnded(endReason);
    } else if (accepted) {
      handlers.onEnded('edge_disconnect');
    } else {
      handlers.onError(
        new Error(CLOSE_CODE_ERRORS[code] ?? `session socket closed before accept (${code})`),
        true
      );
    }
  }

  private fail(err: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.teardown();
    try {
      this.conn?.close(CloseCode.NORMAL);
    } catch {
      /* */
    }
    this.opts.handlers.onError(err, true);
  }

  async sendText(text: string): Promise<Turn> {
    const value = text.trim();
    if (!value) throw new Error('text is required');
    if (value.length > MAX_TEXT_CHARS) throw new Error('text is too long');
    const conn = this.conn;
    if (this.finished || !conn || conn.protocolState !== 'active') {
      throw new Error('text transport is unavailable');
    }
    this.textSequence += 1;
    const id = `text-${this.textSequence}`;
    const result = new Promise<Turn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.textWaiters.delete(id);
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
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
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
    this.pipeline = null;
    this.player?.stop();
    this.player = null;
    this.mse?.stop();
    this.mse = null;
  }
}
