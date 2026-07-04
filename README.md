# @casola/avatar-client

Browser SDK for Casola live-avatar sessions. Manages the edge connection, MSE video playback, and mic streaming.

## Install

```bash
npm i @casola/avatar-client
```

## Quickstart

```typescript
import { AvatarSession, connectViaToken } from '@casola/avatar-client';

// Get a connect URL and session token from your server (POST /api/v1/sessions)
const { connect_url, session_token } = await fetch('/my-backend/start-session').then(r => r.json());

const session = new AvatarSession({
  videoEl: document.querySelector('video#avatar'),
  connect: connectViaToken({ connectUrl: connect_url, sessionToken: session_token }),
  workletUrl: '/mic-worklet.js', // serve dist/worklet/mic-worklet.js from your CDN
  callbacks: {
    onStateChange(next) { updateUI(next); },
    onPartial(text)     { console.log('partial:', text); },
    onTurn(t)           { console.log('turn:', t.text); },
    onFirstFrame()      { hideSpinner(); },
    onClose(reason)     { console.log('ended:', reason); },
    onError(err)        { console.error(err); },
  },
});

await AvatarSession.ensureMicPermission();
await session.start();

// End the session
session.leave();
```

The worklet file (`dist/worklet/mic-worklet.js`) must be served from the same origin as the page, or from a URL explicitly allowed by the browser's AudioWorklet loader.

## API

### `connectViaToken(opts)`

Returns a `ConnectStrategy` for the token-based connection path: connects directly to the edge using a short-lived JWT minted by your server.

| Option | Type | Default |
|--------|------|---------|
| `connectUrl` | `string` | — |
| `sessionToken` | `string` | — |
| `edgePaths.mse` | `string` | `'/mse'` |
| `edgePaths.micStream` | `string` | `'/mic_stream'` |
| `sessionCapSeconds` | `number` | — |

### `AvatarSession`

```typescript
new AvatarSession(opts: AvatarSessionOpts)
```

| Member | Description |
|--------|-------------|
| `.start()` | Begin the session: connect to the edge and start streaming. |
| `.leave()` | End the session and fire `onClose('generic')`. |
| `.destroy()` | Tear down without callbacks (use in component cleanup). |
| `.setMuted(muted)` | Mute or unmute the mic mid-session. |
| `.state` | Current `WidgetState`. |
| `.sessionCapSeconds` | Server-set cap, populated once the edge target is known (`ready` state). |
| `AvatarSession.ensureMicPermission()` | Request mic permission before `start()`. |
| `AvatarSession.mediaSupported()` | `false` on browsers without MSE. |

### Key types

**`WidgetState`**
```
'idle' | 'selecting' | 'verifying' | 'waiting' | 'ready' | 'connecting' | 'live' | 'ended' | 'error'
```

**`EndReason`**
```
'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic'
```

**`AvatarSessionOpts`**
```typescript
{
  videoEl: HTMLVideoElement;
  connect: ConnectStrategy;
  lang?: string;           // BCP 47, default 'en'
  workletUrl?: string;     // default '/mic-worklet.js'
  prewarm?: () => Promise<void> | void;
  dev?: boolean;           // log unexpected state transitions
  callbacks?: { ... };
}
```

## License

MIT © 2026 Casola
