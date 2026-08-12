// GENERATED from packages/avatar-protocol/src/limits.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
/**
 * Normative limits from docs/avatar-protocol-v2-spec.md §Limits. The codec and parsers are
 * structural only — enforcing these is the sending/receiving peer's job, which is why they are
 * exported constants rather than baked into encode/parse.
 */

/** Largest JSON control message either peer may send, in UTF-8 bytes. */
export const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;

/** `text.text` upper bound, carried over from the v1 wire. */
export const MAX_TEXT_CHARS = 2000;

/** `set_instruction.instruction` upper bound, carried over from the v1 wire. */
export const MAX_INSTRUCTION_CHARS = 2000;

/** Largest binary frame payload (header excluded). Media MUST be sliced under this. */
export const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024;

/** The server closes with POLICY if no `hello` arrives within this after socket open. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;

/** Recommended `playout_ack` cadence bounds while media is playing. */
export const PLAYOUT_ACK_MIN_MS = 250;
export const PLAYOUT_ACK_MAX_MS = 500;
