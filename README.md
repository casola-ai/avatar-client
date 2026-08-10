# @casola/avatar-client

Browser SDK for Casola live-avatar sessions. Manages the edge connection, MSE video playback, and mic streaming.

## Install

```bash
npm i @casola/avatar-client
```

## Quickstart

```typescript
import { AvatarSession, connectViaToken } from '@casola/avatar-client';
import { attachDisclosure } from '@casola/avatar-client';

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
    onMicReady()        { showReadyToSpeak(); },
    onAudioBlocked()    { showTapForSound(); }, // iOS refused unmuted playback — video runs muted
    onClose(reason)     { console.log('ended:', reason); },
    onError(err)        { console.error(err); },
  },
});

// Keep the AI and recording disclosure visible for the full live session.
const disclosure = attachDisclosure(document.querySelector('#call-label'), {
  name: 'Mia',
  recording: true,
  details: 'Customer support', // optional plain text, or an array of text segments
});

await AvatarSession.ensureMicPermission();
await session.start();

// Typed turns use the assigned edge's in-band transport when available.
const turn = await session.sendText('Tell me about your priorities.');
console.log(turn.reply);

// End the session
session.leave();
disclosure.destroy();
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
| `.sendText(text)` | Send a typed turn and resolve with `{text, reply}` plus optional speech metadata. Workers fallback edges use their in-band socket; other edges use `textTransport`. |
| `.leave()` | End the session and fire `onClose('generic')`. |
| `.destroy()` | Tear down without callbacks (use in component cleanup). |
| `.setMuted(muted)` | Mute or unmute the mic mid-session. |
| `.setRuntimeInstruction(text)` | Replace hidden system-level guidance for subsequent turns without generating a reply or transcript entry; an empty string clears it. |
| `.unmuteAudio()` | Unmute avatar audio after `onAudioBlocked`; call from a tap/click handler. |
| `.state` | Current `WidgetState`. |
| `.sessionCapSeconds` | Server-set cap, populated once the edge target is known (`ready` state). |
| `AvatarSession.ensureMicPermission()` | Request mic permission before `start()`. |
| `AvatarSession.primeVideoElement(video)` | Call synchronously in the call-button tap handler, before any `await`: clears WebKit's per-element gesture restrictions so iOS Safari honors the SDK's unmute (otherwise the first call in a fresh browsing context plays muted, and pre-fix rendered as a slideshow). |
| `AvatarSession.mediaSupported()` | `false` on browsers without MSE. |

### `attachDisclosure(target, options)`

Populates an application-owned element with the canonical persistent `● REC · AI · name` label.
The SDK owns the required wording, safe DOM construction, accessibility label, and update lifecycle;
your application owns placement and styling through the `casola-disclosure` class. When recording is
disabled, the REC segment is omitted. `details` accepts one string or an array of strings and always
renders them as plain text after the avatar name.

Style hooks are `casola-disclosure` on the target and
`casola-disclosure__recording-group`, `__recording-dot`, `__recording`, `__ai`, `__name`,
`__detail`, and `__separator` on its generated children.

```typescript
const disclosure = attachDisclosure(document.querySelector('#call-label'), {
  name: 'Mia',
  recording: true,
  details: ['Customer support', 'English'],
});

disclosure.update({ recording: false, visible: true });
disclosure.destroy();
```

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
  mic?: boolean;           // default true; false skips getUserMedia
  textTransport?: (text: string) => Promise<string>;
  prewarm?: () => Promise<void> | void;
  dev?: boolean;           // log unexpected state transitions
  callbacks?: { ... };
}
```

`textTransport` lets an application adapt an existing HTTP chat relay for GPU edges. It is not
used when the assigned edge advertises the SDK's in-band text transport. With `mic: false`, the SDK
also opens that in-band socket only after the edge advertises support, so receive-only GPU sessions
keep their existing connection shape.

## License

MIT © 2026 Casola
