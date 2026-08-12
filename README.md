# @casola/avatar-client

Browser SDK for Casola live-avatar sessions, speaking **avatar protocol v2**: one WebSocket per
session carrying JSON control messages and binary media frames (mic uplink, avatar audio, fMP4
video). Sessions render as MSE video when the box streams video, or as a poster image + PCM audio
when it doesn't — the SDK handles both from the same API.

> **v1 boxes:** this SDK speaks protocol v2 only. Against a fleet that still serves the legacy
> two-socket wire (`/mse` + `/mic_stream`), stay on `@casola/avatar-client@0.1.x`.

## Install

```bash
npm i @casola/avatar-client
```

## Quickstart

```typescript
import { AvatarSession, connectViaToken } from '@casola/avatar-client';

// Your backend mints the session (POST /api/v1/sessions with protocol_versions: [2])
// and hands the browser the box URL + short-lived session token.
const { connect_url, session_token } = await fetch('/my-backend/start-session').then(r => r.json());

const session = new AvatarSession({
  videoEl: document.querySelector('video#avatar'),
  connect: connectViaToken({ connectUrl: connect_url, sessionToken: session_token }),
  workletUrl: '/mic-worklet.js', // serve dist/worklet/mic-worklet.js from your origin
  callbacks: {
    onStateChange(next) { updateUI(next); },
    onPartial(text)     { console.log('partial:', text); },
    onTurn(t)           { console.log('turn:', t.text); },
    onFirstFrame()      { hideSpinner(); },
    onMicReady()        { showReadyToSpeak(); },
    onAudioBlocked()    { showTapForSound(); }, // iOS refused unmuted playback — media runs muted
    onClose(reason)     { console.log('ended:', reason); },
    onError(err)        { console.error(err); },
  },
});

await AvatarSession.ensureMicPermission();
await session.start();

// Typed turns ride the same session socket.
const turn = await session.sendText('Tell me about your priorities.');
console.log(turn.reply);

// End the session
session.leave();
```

The worklet file (`dist/worklet/mic-worklet.js`) must be served from the same origin as the page,
or from a URL explicitly allowed by the browser's AudioWorklet loader.

## API

### `connectViaToken(opts)`

Returns a `ConnectStrategy` that points the session at the box's well-known `/v2/session`
endpoint using the short-lived JWT minted by your server.

| Option | Type | Default |
|--------|------|---------|
| `connectUrl` | `string` | — |
| `sessionToken` | `string` | — |
| `sessionCapSeconds` | `number` | — (superseded by the box's `cap_seconds` once connected) |

### `AvatarSession`

```typescript
new AvatarSession(opts: AvatarSessionOpts)
```

| Member | Description |
|--------|-------------|
| `.start()` | Begin the session: open the session socket, handshake, start streaming. |
| `.sendText(text)` | Send a typed turn over the session socket; resolves with `{text, reply}` plus optional speech metadata. |
| `.leave()` | End the session and fire `onClose('generic')`. |
| `.destroy()` | Tear down without callbacks (use in component cleanup). |
| `.setMuted(muted)` | Mute or unmute the mic mid-session (muted frames are sent as silence, keeping timing continuous). |
| `.setLangs(langs)` | Re-pin the ASR recognition language(s) mid-session; `[]` = auto-detect. |
| `.setResponseLanguage(lang)` | Preferred reply language (BCP-47; `''` returns the choice to the model). |
| `.setRuntimeInstruction(text)` | Replace hidden system-level guidance for subsequent turns without generating a reply or transcript entry; an empty string clears it. |
| `.unmuteAudio()` | Unmute avatar audio after `onAudioBlocked`; call from a tap/click handler. |
| `.state` | Current `WidgetState`. |
| `.sessionCapSeconds` | The session cap — the box's authoritative `cap_seconds` once connected. |
| `.personaKey` | The avatar version the box bound, echoed in the handshake (the persona-pinning ack). |
| `AvatarSession.ensureMicPermission()` | Request mic permission before `start()`. |
| `AvatarSession.primeVideoElement(video)` | Call synchronously in the call-button tap handler, before any `await`: clears WebKit's per-element gesture restrictions so iOS Safari honors the SDK's unmute (otherwise the first call in a fresh browsing context plays muted, and pre-fix rendered as a slideshow). |
| `AvatarSession.mediaSupported()` | `false` on browsers without MSE. Poster-mode sessions (poster + audio) work regardless — the SDK simply doesn't offer video in the handshake. |

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

### `attachSessionControls(target, options)`

Populates an application-owned element with optional native mute and hang-up buttons. The SDK owns
accessible state, button labels, pending hang-up protection, safe DOM construction, and the update
lifecycle. The host owns the behavior through `onMutedChange` and `onHangup`, so product-specific
cleanup, feedback, reporting, and navigation are not bypassed.

Style hooks are `casola-session-controls` on the target and
`casola-session-controls__mute`, `__mute-label`, `__hangup`, and `__hangup-label` on generated
children. State hooks are `[data-muted]` and `[data-ending]` on the target.

```typescript
const controls = attachSessionControls(document.querySelector('#call-controls'), {
  mute: true,
  hangup: true,
  muted: false,
  labels: { hangup: 'End reading' },
  onMutedChange: (muted) => session.setMuted(muted),
  onHangup: async () => finishProductFlow(),
});

controls.update({ muted: true, muteDisabled: false });
controls.destroy();
```

Both helpers are protocol-agnostic DOM utilities — they behave identically to 0.1.4/0.1.5.

### `attachCaptions(target, options)`

Populates an application-owned element with the streaming caption surface: the live ASR partial,
each settled user turn, and the avatar's reply revealed in step with the utterance that speaks it.

Reply text arrives whole, with no per-word timing, so rendering `turn.reply` directly either
races ahead of the voice or waits on an invented delay. This helper uses what the wire actually
provides — `speech_start` / `speech_end` and the `speechId` they share with the turn:

- a reply waits for its `speech_start`, the real audio onset, when the box marks utterances
  (`startTimeoutMs` is the backstop if that marker never lands);
- it does not wait at all when the box has sent no marker this session;
- `speech_end` retimes the words still queued to finish inside `tailMs`, so the text cannot keep
  crawling after the voice has stopped;
- a reply for an utterance that already ended opens straight into that tail pace.

Style hooks are `casola-captions` on the target and `casola-captions__line` on each line, with
`--partial`, `--user`, `--reply` and `--fading` modifiers. The target becomes a polite live region
(`role="log"`); a line still arriving is `aria-hidden` and announces once, whole, when it settles.

```typescript
const captions = attachCaptions(document.querySelector('#captions'), {
  maxLines: 6,
  holdMs: 2000, // 0 keeps lines until they are trimmed
  fadeMs: 600,
});

new AvatarSession({
  callbacks: {
    onPartial: (text) => captions.partial(text),
    onTurn: (turn) => captions.turn(turn),
    onSpeechStart: (id) => captions.speechStart(id),
    onSpeechEnd: (id) => captions.speechEnd(id),
  },
  // …
});

captions.update({ visible: false });
captions.destroy();
```

Wiring `onSpeechStart` / `onSpeechEnd` is what buys the alignment; without them the helper still
renders, it just reveals every reply as soon as it arrives.

`captions.line({ text, kind, speaker })` writes a line your application authored — a written
fallback when a spoken reply fails, an interstitial — into the same ribbon, with no reveal
schedule.

### `attachSessionUI(container, options)`

Mounts the disclosure, controls and captions together, wires them to a session, and decides which
states show what. The three helpers stay individually exported; this is composition.

```typescript
import { attachSessionUI, AvatarSession } from '@casola/avatar-client';
import '@casola/avatar-client/styles.css';

const ui = attachSessionUI(document.querySelector('#call'), {
  name: 'Mia',
  controls: { hangup: false },   // this product has its own end-call button
  onHangup: () => endCallFlow(),
});

const session = new AvatarSession({ videoEl, connect });
ui.bind(session);
session.start();
```

It owns no layout — it creates one child per part and stops, because a laptop mock, a modal and a
16:9 shadow root place these very differently. It owns no product copy either.

**"Live" is not always `WidgetState.live`.** If your product waits for the first frame *and* the
microphone before it considers the call started, say so with `visibleWhen`, or drive it yourself
with `ui.setLive(true)` / `ui.setLive(null)`.

### `session.on(event, handler)`

Subscribe after construction; the returned function unsubscribes. The constructor `callbacks` still
work and fire first. Events: `state`, `partial`, `turn`, `firstFrame`, `micReady`, `speechStart`,
`speechEnd`, `audioFrameSent`, `audioBlocked`, `muteChange`, `close`, `error`. A throwing handler
is caught, so one bad subscriber cannot break the session.

### `AvatarSession.preflight(options?)`

Microphone permission, MSE support and the browser gate in one call, before you spend a fleet seat:

```typescript
const pre = await AvatarSession.preflight();
if (!pre.ok) return showError(myCopy[pre.error.kind] ?? myCopy.generic);
const session = new AvatarSession({ permittedStream: pre.stream ?? undefined, videoEl, connect });
```

Hold `pre.stream` and pass it as `permittedStream` so the session does not prompt twice.
`pre.video === false` means poster mode is the only option here — a degradation, not a failure.

### Errors

`callbacks.onError` and the `error` event receive an `AvatarError`: a real `Error` with a `kind`
and a `terminal` flag. Branch on `kind` instead of sniffing `DOMException` names.

| kind | meaning |
|---|---|
| `mic-permission`, `mic-unavailable`, `mic-failed` | the microphone — the only kinds "check your mic" is correct for (`isMicError`) |
| `unsupported-browser` | this browser cannot do what the session needs |
| `connect`, `handshake` | the socket never opened, or the box never completed the handshake |
| `unauthorized`, `protocol-mismatch`, `persona-unavailable`, `capacity`, `policy` | the box refused: close 4001 / 4002 / 4003 / 4004 / 4008 |
| `server`, `media` | in-band error or a playback hiccup — usually `terminal: false` |

Treat an unrecognized kind as `unknown`; the list grows.

### Muting: user choice vs application suppression

`setMuted()` is the user's choice. `suppressMic(true)` holds the microphone closed *without*
discarding it, and `suppressMic(false)` restores whatever they had set — use it around app-driven
turns rather than `setMuted(true)` … `setMuted(previous)`, which loses the user's intent whenever
the two interleave. Read `userMuted` / `micSuppressed` / `micMuted`, or subscribe to `muteChange`.

### Default styles

```typescript
import '@casola/avatar-client/styles.css';        // ordinary pages
import { adoptSessionUIStyles } from '@casola/avatar-client';
adoptSessionUIStyles(myShadowRoot);               // shadow roots, which a stylesheet never reaches
```

Theme with custom properties on the container rather than overriding rules — `--casola-accent`,
`--casola-caption-font`, `--casola-caption-bg`, `--casola-caption-blur`, `--casola-caption-max-height`,
`--casola-speaker-*`, `--casola-control-*`, `--casola-disclosure-*`, `--casola-rec-color`.

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
  langs?: string[];           // ASR language pin; [] / omitted = auto-detect
  responseLanguage?: string;  // preferred reply language (BCP-47)
  workletUrl?: string;        // default '/mic-worklet.js'
  mic?: boolean;              // default true; false = receive-only (no getUserMedia, text via sendText)
  permittedStream?: MediaStream; // from ensureMicPermission(), avoids a second prompt
  prewarm?: () => Promise<void> | void;
  dev?: boolean;              // log unexpected state transitions + protocol violations
  callbacks?: { ... };        // see AvatarSessionOpts for the full set, incl.
                              // onSpeechStart/onSpeechEnd (assistant utterance markers)
}
```

## Migrating from 0.1.x

0.2.0 replaces the two-socket v1 wire with the single v2 session socket. Breaking changes:

- Your backend must mint with `protocol_versions: [2]` and the fleet must contain protocol-v2
  boxes; the SDK no longer speaks `/mse` + `/mic_stream`.
- `connectViaToken` lost `edgePaths` (the path is well-known) — pass `sessionCapSeconds` as before.
- `AvatarSessionOpts` lost `textTransport` (typed turns are always in-band) and `lang`
  (use `langs` / `responseLanguage`).
- The deprecated `onQueueStatus` callback was removed as promised in its deprecation note.

`attachDisclosure` and `attachSessionControls` are unchanged from 0.1.4/0.1.5 — they render DOM and
never touch the wire.

## License

MIT © 2026 Casola
