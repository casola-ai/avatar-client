// GENERATED from packages/avatar-protocol/src/codes.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
/** WebSocket subprotocol naming the wire generation. Offered by the client at upgrade and
 *  echoed by the server; a missing echo means the peer does not speak v2. */
export const SUBPROTOCOL = 'casola.avatar.v2';

/** WebSocket close codes (docs/avatar-protocol-v2-spec.md §Close codes). */
export const CloseCode = {
  NORMAL: 1000,
  UNAUTHORIZED: 4001,
  PROTOCOL_MISMATCH: 4002,
  PERSONA_UNRESOLVABLE: 4003,
  CAPACITY: 4004,
  POLICY: 4008,
} as const;
export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode];

/** Stable in-band `error.code` strings (§Error codes). New codes are additive; clients treat
 *  unknown codes as INTERNAL. */
export const ErrorCode = {
  UNAUTHORIZED: 'unauthorized',
  PROTOCOL_MISMATCH: 'protocol_mismatch',
  PERSONA_UNRESOLVABLE: 'persona_unresolvable',
  UNSUPPORTED_CODEC: 'unsupported_codec',
  INVALID_MESSAGE: 'invalid_message',
  TOO_LONG: 'too_long',
  INTERNAL: 'internal',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
