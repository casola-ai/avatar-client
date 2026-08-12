// GENERATED from packages/avatar-protocol/src/messages.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { ChannelDescriptor } from './channels';

/**
 * JSON control messages. The extensibility contract lives in the parsers below, once:
 * an unknown `type` parses as {ok:'unknown'} (receivers MUST ignore it), and unknown fields on a
 * known type are preserved untouched — the returned message is the parsed object itself, so
 * additive fields survive a round-trip through a peer that predates them.
 */

// ---------------------------------------------------------------------------
// client → server

export interface HelloMessage {
  type: 'hello';
  proto: 2;
  /** Payload codecs the client can play, per kind. Absent kind = cannot play it. */
  accept: { audio?: 'pcm16'[]; video?: 'fmp4'[] };
  /** Uplink microphone format the client will send. Absent = no mic uplink. */
  mic?: { codec: 'pcm16'; sample_rate: number };
  langs?: string[];
  response_language?: string;
  /** Optional feature names (unknown entries ignored) — minor evolution without a v3. */
  features?: string[];
  /** RESERVED for resume; servers ignore it this protocol revision. */
  resume?: { token: string; last_seq: number };
}

export type ClientMessage =
  | HelloMessage
  | { type: 'text'; id: string; text: string }
  | { type: 'set_langs'; id?: string; langs: string[] }
  | { type: 'set_response_language'; id?: string; language: string }
  | { type: 'set_instruction'; id?: string; instruction: string }
  | { type: 'playout_ack'; played_pts_us: number; buffered_ms: number }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number }
  | { type: 'bye' };

// ---------------------------------------------------------------------------
// server → client — every message except ping/pong carries `seq` (monotonic from 1),
// the wire-readiness for resume.

export interface AcceptMessage {
  type: 'accept';
  seq: number;
  proto: 2;
  /** The bound avatar_versions.id — the persona-pinning ack (docs/persona-pinning-design.md). */
  persona_key: string;
  cap_seconds: number;
  /** Live channels for this session. No video descriptor = poster mode (see `poster`). */
  channels: ChannelDescriptor[];
  poster?: { url: string };
  features: string[];
  /** RESERVED: always null this protocol revision. */
  resume: null;
}

export type ServerMessage =
  | AcceptMessage
  | { type: 'partial'; seq: number; text: string; language?: string }
  | {
      type: 'turn';
      seq: number;
      text: string;
      reply: string | null;
      speech_id?: string;
      request_id?: string;
      language?: string;
    }
  | { type: 'speech_start'; seq: number; speech_id: string }
  | { type: 'speech_end'; seq: number; speech_id: string }
  | { type: 'interruption'; seq: number; cutoff_pts_us: number | null }
  | { type: 'instruction_set'; seq: number; request_id?: string }
  | { type: 'error'; seq: number; code: string; message?: string; request_id?: string }
  | { type: 'session_end'; seq: number; reason: string }
  | { type: 'go_away'; seq: number; deadline_s?: number }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number };

// ---------------------------------------------------------------------------
// tolerant parsing

export type ParsedMessage<T> =
  | { ok: true; msg: T }
  | { ok: 'unknown'; raw: Record<string, unknown> }
  | { ok: false; error: string };

type Raw = Record<string, unknown>;
type FieldCheck = (m: Raw) => boolean;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown): boolean => Array.isArray(v) && v.every(isStr);

/** Required-field shape per known type. Optional fields are not checked: an absent optional and
 *  a wrongly-typed optional both read the same to a tolerant receiver (ignored). */
const CLIENT_CHECKS: Record<string, FieldCheck> = {
  hello: (m) =>
    m.proto === 2 && typeof m.accept === 'object' && m.accept !== null && !Array.isArray(m.accept),
  text: (m) => isStr(m.id) && isStr(m.text),
  set_langs: (m) => isStrArray(m.langs),
  set_response_language: (m) => isStr(m.language),
  set_instruction: (m) => isStr(m.instruction),
  playout_ack: (m) => isNum(m.played_pts_us) && isNum(m.buffered_ms),
  ping: (m) => isNum(m.t),
  pong: (m) => isNum(m.t),
  bye: () => true,
};

const SERVER_CHECKS: Record<string, FieldCheck> = {
  accept: (m) =>
    isNum(m.seq) &&
    m.proto === 2 &&
    isStr(m.persona_key) &&
    isNum(m.cap_seconds) &&
    Array.isArray(m.channels),
  partial: (m) => isNum(m.seq) && isStr(m.text),
  turn: (m) => isNum(m.seq) && isStr(m.text) && (m.reply === null || isStr(m.reply)),
  speech_start: (m) => isNum(m.seq) && isStr(m.speech_id),
  speech_end: (m) => isNum(m.seq) && isStr(m.speech_id),
  interruption: (m) => isNum(m.seq) && (m.cutoff_pts_us === null || isNum(m.cutoff_pts_us)),
  instruction_set: (m) => isNum(m.seq),
  error: (m) => isNum(m.seq) && isStr(m.code),
  session_end: (m) => isNum(m.seq) && isStr(m.reason),
  go_away: (m) => isNum(m.seq),
  ping: (m) => isNum(m.t),
  pong: (m) => isNum(m.t),
};

function parse<T>(text: string, checks: Record<string, FieldCheck>): ParsedMessage<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'not_an_object' };
  }
  const m = raw as Raw;
  if (!isStr(m.type)) return { ok: false, error: 'missing_type' };
  const check = checks[m.type];
  if (!check) return { ok: 'unknown', raw: m };
  if (!check(m)) return { ok: false, error: `invalid_${m.type}` };
  return { ok: true, msg: m as T };
}

export function parseClientMessage(text: string): ParsedMessage<ClientMessage> {
  return parse<ClientMessage>(text, CLIENT_CHECKS);
}

export function parseServerMessage(text: string): ParsedMessage<ServerMessage> {
  return parse<ServerMessage>(text, SERVER_CHECKS);
}
