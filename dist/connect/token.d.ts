import type { ConnectStrategy } from '../session';
/**
 * The shipping connect strategy: turn a mint result (`connect_url` + `session_token`, minted by
 * your backend with `protocol_versions: [2]`) into the box's `/v2/session` WebSocket target.
 * The path is well-known per docs/avatar-protocol-v2-spec.md; the token rides `?token=`.
 */
export declare function connectViaToken(o: {
    connectUrl: string;
    sessionToken?: string;
    sessionCapSeconds?: number;
}): ConnectStrategy;
