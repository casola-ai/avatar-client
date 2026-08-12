import type { ConnectHandlers, ConnectStrategy } from '../session';

/**
 * The shipping connect strategy: turn a mint result (`connect_url` + `session_token`, minted by
 * your backend with `protocol_versions: [2]`) into the box's `/v2/session` WebSocket target.
 * The path is well-known per docs/avatar-protocol-v2-spec.md; the token rides `?token=`.
 */
export function connectViaToken(o: {
  connectUrl: string;
  sessionToken?: string;
  sessionCapSeconds?: number;
}): ConnectStrategy {
  const u = new URL('/v2/session', o.connectUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  if (o.sessionToken) u.searchParams.set('token', o.sessionToken);
  const sessionWsUrl = u.toString();

  return {
    connect(h: ConnectHandlers): void {
      h.onReady({ sessionWsUrl, sessionCapSeconds: o.sessionCapSeconds });
    },
    close(): void {
      /* no persistent connection to close */
    },
  };
}
