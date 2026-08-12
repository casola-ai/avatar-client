// GENERATED from packages/avatar-protocol/src/connection.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import { decodeFrame, encodeFrame, type MediaFrame } from './frames';
import {
  type ClientMessage,
  type ParsedMessage,
  parseClientMessage,
  parseServerMessage,
  type ServerMessage,
} from './messages';
import { frameVerdict, onReceive, onSend, type ProtocolState, type Role } from './state-machine';
import type { Transport, TransportCloseEvent, Unsubscribe } from './transport';
import { Listeners } from './transport';

/**
 * The protocol layer bound to a Transport: demuxes text frames into parsed control messages and
 * binary frames into MediaFrames, drives the connection state machine, and (server side) stamps
 * the monotonic `seq` on outgoing control messages. This is the seam both the fallback box and
 * test clients share; it owns no I/O beyond the Transport it is given.
 */

export interface ProtocolViolation {
  kind: 'illegal_message' | 'illegal_frame' | 'bad_frame';
  detail: string;
  state: ProtocolState;
}

interface ConnectionBase {
  readonly protocolState: ProtocolState;
  sendFrame(frame: MediaFrame): void;
  onFrame(fn: (f: MediaFrame) => void): Unsubscribe;
  onClose(fn: (ev: TransportCloseEvent) => void): Unsubscribe;
  onViolation(fn: (v: ProtocolViolation) => void): Unsubscribe;
  close(code?: number, reason?: string): void;
}

export interface ClientConnection extends ConnectionBase {
  send(msg: ClientMessage): void;
  onMessage(fn: (m: ServerMessage) => void): Unsubscribe;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Server messages are authored without `seq`; the connection stamps it at send. */
export type UnsequencedServerMessage =
  | Exclude<ServerMessage, { seq: number }>
  | DistributiveOmit<Extract<ServerMessage, { seq: number }>, 'seq'>;

export interface ServerConnection extends ConnectionBase {
  send(msg: UnsequencedServerMessage): void;
  onMessage(fn: (m: ClientMessage) => void): Unsubscribe;
}

function makeConnection(
  transport: Transport,
  role: Role,
  parse: (text: string) => ParsedMessage<ClientMessage | ServerMessage>,
  stampSeq: boolean
): {
  base: ConnectionBase;
  send(msg: Record<string, unknown>): void;
  messages: Listeners<ClientMessage | ServerMessage>;
} {
  let state: ProtocolState = 'handshaking';
  let nextSeq = 1;
  const messages = new Listeners<ClientMessage | ServerMessage>();
  const frames = new Listeners<MediaFrame>();
  const violations = new Listeners<ProtocolViolation>();

  transport.onText((text) => {
    const parsed = parse(text);
    if (parsed.ok === 'unknown') return; // must-ignore
    if (parsed.ok === false) {
      violations.emit({ kind: 'illegal_message', detail: parsed.error, state });
      return;
    }
    const { next, verdict } = onReceive(role, state, parsed.msg.type);
    state = next;
    if (verdict === 'violation') {
      violations.emit({ kind: 'illegal_message', detail: `unexpected ${parsed.msg.type}`, state });
      return;
    }
    if (verdict === 'deliver') messages.emit(parsed.msg);
  });

  transport.onBinary((bytes) => {
    const verdict = frameVerdict(state);
    if (verdict === 'ignore') return;
    if (verdict === 'violation') {
      violations.emit({ kind: 'illegal_frame', detail: `binary frame while ${state}`, state });
      return;
    }
    let frame: MediaFrame;
    try {
      frame = decodeFrame(bytes);
    } catch (err) {
      violations.emit({ kind: 'bad_frame', detail: String(err), state });
      return;
    }
    frames.emit(frame);
  });

  transport.onClose(() => {
    state = 'closed';
  });

  const base: ConnectionBase = {
    get protocolState() {
      return state;
    },
    sendFrame(frame) {
      transport.sendBinary(encodeFrame(frame));
    },
    onFrame: (fn) => frames.add(fn),
    onClose: (fn) => transport.onClose(fn),
    onViolation: (fn) => violations.add(fn),
    close(code, reason) {
      state = 'closed';
      transport.close(code, reason);
    },
  };

  return {
    base,
    send(msg) {
      const out =
        stampSeq && msg.type !== 'ping' && msg.type !== 'pong' ? { ...msg, seq: nextSeq++ } : msg;
      state = onSend(role, state, String(msg.type));
      transport.sendText(JSON.stringify(out));
    },
    messages,
  };
}

// Note: no object spread of `base` here — spreading would snapshot the protocolState getter
// into a frozen value; the wrappers delegate it instead.

export function clientProtocolConnection(transport: Transport): ClientConnection {
  const { base, send, messages } = makeConnection(transport, 'client', parseServerMessage, false);
  return {
    get protocolState() {
      return base.protocolState;
    },
    sendFrame: base.sendFrame,
    onFrame: base.onFrame,
    onClose: base.onClose,
    onViolation: base.onViolation,
    close: base.close,
    send: (msg: ClientMessage) => send(msg as unknown as Record<string, unknown>),
    onMessage: (fn) => messages.add(fn as (m: ClientMessage | ServerMessage) => void),
  };
}

export function serverProtocolConnection(transport: Transport): ServerConnection {
  const { base, send, messages } = makeConnection(transport, 'server', parseClientMessage, true);
  return {
    get protocolState() {
      return base.protocolState;
    },
    sendFrame: base.sendFrame,
    onFrame: base.onFrame,
    onClose: base.onClose,
    onViolation: base.onViolation,
    close: base.close,
    send: (msg: UnsequencedServerMessage) => send(msg as unknown as Record<string, unknown>),
    onMessage: (fn) => messages.add(fn as (m: ClientMessage | ServerMessage) => void),
  };
}
