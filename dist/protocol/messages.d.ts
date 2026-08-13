import type { ChannelDescriptor } from './channels';
/**
 * JSON control messages. The extensibility contract lives in the parsers below, once:
 * an unknown `type` parses as {ok:'unknown'} (receivers MUST ignore it), and unknown fields on a
 * known type are preserved untouched — the returned message is the parsed object itself, so
 * additive fields survive a round-trip through a peer that predates them.
 */
export interface HelloMessage {
    type: 'hello';
    proto: 2;
    /** Payload codecs the client can play, per kind. Absent kind = cannot play it. */
    accept: {
        audio?: string[];
        video?: string[];
    };
    /** Uplink microphone format the client will send. Absent = no mic uplink. */
    mic?: {
        codec: 'pcm16';
        sample_rate: number;
    };
    langs?: string[];
    response_language?: string;
    /** Optional feature names (unknown entries ignored) — minor evolution without a v3. */
    features?: string[];
    /** RESERVED for resume; always null when present in this protocol revision. */
    resume?: null;
}
export type ClientMessage = HelloMessage | {
    type: 'text';
    id: string;
    text: string;
} | {
    type: 'set_langs';
    id?: string;
    langs: string[];
} | {
    type: 'set_response_language';
    id?: string;
    language: string;
} | {
    type: 'set_instruction';
    id?: string;
    instruction: string;
} | {
    type: 'playout_ack';
    played_pts_us: number;
    buffered_ms: number;
} | {
    type: 'ping';
    t: number;
} | {
    type: 'pong';
    t: number;
} | {
    type: 'bye';
};
export interface AcceptMessage {
    type: 'accept';
    seq: number;
    proto: 2;
    /** The bound avatar_versions.id — the persona-pinning ack (docs/persona-pinning-design.md). */
    persona_key: string;
    cap_seconds: number;
    /** Live channels for this session. No video descriptor = poster mode (see `poster`). */
    channels: ChannelDescriptor[];
    poster?: {
        url: string;
    };
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
export type ServerMessage = AcceptMessage | {
    type: 'partial';
    seq: number;
    text: string;
    language?: string;
} | {
    type: 'turn';
    seq: number;
    text: string;
    reply: string | null;
    speech_id?: string;
    request_id?: string;
    language?: string;
} | {
    type: 'speech_start';
    seq: number;
    speech_id: string;
} | {
    type: 'speech_end';
    seq: number;
    speech_id: string;
} | UtteranceStartMessage | UtteranceTextMessage | UtteranceEndMessage | LegacyInterruptionMessage | InterruptionMessage | {
    type: 'instruction_set';
    seq: number;
    request_id?: string;
} | {
    type: 'error';
    seq: number;
    code: string;
    message?: string;
    request_id?: string;
} | {
    type: 'session_end';
    seq: number;
    reason: string;
} | {
    type: 'go_away';
    seq: number;
    deadline_s?: number;
} | {
    type: 'ping';
    t: number;
} | {
    type: 'pong';
    t: number;
};
export type ParsedMessage<T> = {
    ok: true;
    msg: T;
} | {
    ok: 'unknown';
    raw: Record<string, unknown>;
} | {
    ok: false;
    error: string;
};
export declare function parseClientMessage(text: string): ParsedMessage<ClientMessage>;
export declare function parseServerMessage(text: string): ParsedMessage<ServerMessage>;
