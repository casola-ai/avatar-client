import type { ConnectHandlers, ConnectStrategy } from '../session';

export function connectViaToken(o: {
  connectUrl: string;
  sessionToken?: string;
  edgePaths?: { mse?: string; micStream?: string };
  sessionCapSeconds?: number;
}): ConnectStrategy {
  const msePath = o.edgePaths?.mse ?? '/mse';
  const micPath = o.edgePaths?.micStream ?? '/mic_stream';

  function toWss(base: string, path: string): string {
    const u = new URL(path, base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    if (o.sessionToken) u.searchParams.set('token', o.sessionToken);
    return u.toString();
  }

  return {
    connect(h: ConnectHandlers): void {
      h.onReady({
        mseWsUrl: toWss(o.connectUrl, msePath),
        micWsUrl: toWss(o.connectUrl, micPath),
        sessionCapSeconds: o.sessionCapSeconds,
      });
    },
    close(): void {
      /* no persistent connection to close */
    },
  };
}
