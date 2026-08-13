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
  accept: { audio?: string[]; video?: string[] };
  /** Uplink microphone format the client will send. Absent = no mic uplink. */
  mic?: { codec: 'pcm16'; sample_rate: number };
  langs?: string[];
  response_language?: string;
  /** Optional feature names (unknown entries ignored) — minor evolution without a v3. */
  features?: string[];
  /** RESERVED for resume; always null when present in this protocol revision. */
  resume?: null;
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
  /** Absent on pre-feature protocol-v2 boxes; clients treat absence as an empty set. */
  features?: string[];
  /** RESERVED: always null this protocol revision. */
  resume: null;
}

export interface UtteranceStartMessage {
  type: 'utterance_start';
  seq: number;
  turn_id: string;
  utterance_id: string;
  start_pts_us: number;
  text?: string;
  text_final: boolean;
  language?: string;
}

export interface UtteranceTextMessage {
  type: 'utterance_text';
  seq: number;
  turn_id: string;
  utterance_id: string;
  revision: number;
  text: string;
  final: boolean;
}

export type UtteranceEndReason = 'complete' | 'interrupted' | 'replaced' | 'error';

export interface UtteranceEndMessage {
  type: 'utterance_end';
  seq: number;
  turn_id: string;
  utterance_id: string;
  end_pts_us: number;
  reason: UtteranceEndReason;
}

/** Legacy interruption shape, retained for peers that did not negotiate timed utterances. */
export interface LegacyInterruptionMessage {
  type: 'interruption';
  seq: number;
  cutoff_pts_us: number | null;
}

export interface InterruptionMessage {
  type: 'interruption';
  seq: number;
  cutoff_pts_us: number;
  utterance_ids: string[];
  reason: 'barge_in';
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
  | UtteranceStartMessage
  | UtteranceTextMessage
  | UtteranceEndMessage
  | LegacyInterruptionMessage
  | InterruptionMessage
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
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUInt = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
const has = (m: Raw, key: string): boolean => Object.hasOwn(m, key);
const optional = (m: Raw, key: string, check: (v: unknown) => boolean): boolean =>
  !has(m, key) || check(m[key]);
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    isStr(v) && values.includes(v as T);

const isAcceptCodecs = (v: unknown): boolean =>
  isObj(v) && optional(v, 'audio', isStrArray) && optional(v, 'video', isStrArray);

const isMic = (v: unknown): boolean =>
  isObj(v) && v.codec === 'pcm16' && isUInt(v.sample_rate) && v.sample_rate > 0;

const isChannel = (v: unknown): boolean => {
  if (!isObj(v) || !isUInt(v.id) || v.id > 0xff) return false;
  if (v.dir !== 'up' && v.dir !== 'down') return false;
  if (v.kind === 'audio') {
    return v.codec === 'pcm16' && isUInt(v.sample_rate) && v.sample_rate > 0 && v.channels === 1;
  }
  if (v.kind === 'video') {
    return (
      v.dir === 'down' &&
      v.codec === 'fmp4' &&
      isStr(v.mime) &&
      optional(v, 'fps', (x) => isNum(x) && Number(x) > 0) &&
      optional(v, 'seg_frames', (x) => isUInt(x) && Number(x) > 0)
    );
  }
  return v.kind === 'data' && v.codec === 'binary';
};

/** Known fields are validated whenever present. Unknown fields remain tolerated for evolution. */
const CLIENT_CHECKS: Record<string, FieldCheck> = {
  hello: (m) =>
    m.proto === 2 &&
    isAcceptCodecs(m.accept) &&
    optional(m, 'mic', isMic) &&
    optional(m, 'langs', isStrArray) &&
    optional(m, 'response_language', isStr) &&
    optional(m, 'features', isStrArray) &&
    optional(m, 'resume', (v) => v === null),
  text: (m) => isStr(m.id) && isStr(m.text),
  set_langs: (m) => isStrArray(m.langs) && optional(m, 'id', isStr),
  set_response_language: (m) => isStr(m.language) && optional(m, 'id', isStr),
  set_instruction: (m) => isStr(m.instruction) && optional(m, 'id', isStr),
  playout_ack: (m) => isUInt(m.played_pts_us) && isNum(m.buffered_ms) && m.buffered_ms >= 0,
  ping: (m) => isNum(m.t),
  pong: (m) => isNum(m.t),
  bye: () => true,
};

const SERVER_CHECKS: Record<string, FieldCheck> = {
  accept: (m) =>
    isSeq(m.seq) &&
    m.proto === 2 &&
    isStr(m.persona_key) &&
    isNum(m.cap_seconds) &&
    m.cap_seconds >= 0 &&
    Array.isArray(m.channels) &&
    m.channels.every(isChannel) &&
    optional(m, 'features', isStrArray) &&
    m.resume === null &&
    optional(m, 'poster', (v) => isObj(v) && isStr(v.url)),
  partial: (m) => isSeq(m.seq) && isStr(m.text) && optional(m, 'language', isStr),
  turn: (m) =>
    isSeq(m.seq) &&
    isStr(m.text) &&
    has(m, 'reply') &&
    (m.reply === null || isStr(m.reply)) &&
    optional(m, 'speech_id', isStr) &&
    optional(m, 'request_id', isStr) &&
    optional(m, 'language', isStr),
  speech_start: (m) => isSeq(m.seq) && isStr(m.speech_id),
  speech_end: (m) => isSeq(m.seq) && isStr(m.speech_id),
  utterance_start: (m) =>
    isSeq(m.seq) &&
    isStr(m.turn_id) &&
    isStr(m.utterance_id) &&
    isUInt(m.start_pts_us) &&
    isBool(m.text_final) &&
    optional(m, 'text', isStr) &&
    optional(m, 'language', isStr),
  utterance_text: (m) =>
    isSeq(m.seq) &&
    isStr(m.turn_id) &&
    isStr(m.utterance_id) &&
    isUInt(m.revision) &&
    isStr(m.text) &&
    isBool(m.final),
  utterance_end: (m) =>
    isSeq(m.seq) &&
    isStr(m.turn_id) &&
    isStr(m.utterance_id) &&
    isUInt(m.end_pts_us) &&
    oneOf('complete', 'interrupted', 'replaced', 'error')(m.reason),
  interruption: (m) => {
    if (!isSeq(m.seq) || !(m.cutoff_pts_us === null || isUInt(m.cutoff_pts_us))) return false;
    const hasIds = has(m, 'utterance_ids');
    const hasReason = has(m, 'reason');
    if (!hasIds && !hasReason) return true;
    return (
      m.cutoff_pts_us !== null &&
      hasIds &&
      isStrArray(m.utterance_ids) &&
      hasReason &&
      m.reason === 'barge_in'
    );
  },
  instruction_set: (m) => isSeq(m.seq) && optional(m, 'request_id', isStr),
  error: (m) =>
    isSeq(m.seq) &&
    isStr(m.code) &&
    optional(m, 'message', isStr) &&
    optional(m, 'request_id', isStr),
  session_end: (m) => isSeq(m.seq) && isStr(m.reason),
  go_away: (m) => isSeq(m.seq) && optional(m, 'deadline_s', isNum),
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
