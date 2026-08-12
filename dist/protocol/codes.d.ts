/** WebSocket subprotocol naming the wire generation. Offered by the client at upgrade and
 *  echoed by the server; a missing echo means the peer does not speak v2. */
export declare const SUBPROTOCOL = "casola.avatar.v2";
/** WebSocket close codes (docs/avatar-protocol-v2-spec.md §Close codes). */
export declare const CloseCode: {
    readonly NORMAL: 1000;
    readonly UNAUTHORIZED: 4001;
    readonly PROTOCOL_MISMATCH: 4002;
    readonly PERSONA_UNRESOLVABLE: 4003;
    readonly CAPACITY: 4004;
    readonly POLICY: 4008;
};
export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode];
/** Stable in-band `error.code` strings (§Error codes). New codes are additive; clients treat
 *  unknown codes as INTERNAL. */
export declare const ErrorCode: {
    readonly UNAUTHORIZED: "unauthorized";
    readonly PROTOCOL_MISMATCH: "protocol_mismatch";
    readonly PERSONA_UNRESOLVABLE: "persona_unresolvable";
    readonly UNSUPPORTED_CODEC: "unsupported_codec";
    readonly INVALID_MESSAGE: "invalid_message";
    readonly TOO_LONG: "too_long";
    readonly INTERNAL: "internal";
};
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
