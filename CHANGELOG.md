# Changelog

All notable changes to `@casola/avatar-client` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.0] - 2026-08-12

Additive and opt-in. A host that calls neither addition behaves exactly as on 0.2.1.

### Added
- `AvatarSession.bufferedVoiceMs()` — avatar voice still queued to play, in ms, or `null` when
  this session has no playout clock to ask (a video session, or one that has not accepted yet).
  `null` means "unknown", never "nothing left".
- `attachCaptions`'s `remainingVoiceMs` option — a supplier for the above. `speech_end` means the
  box stopped *producing* audio, not that the speaker stopped, so the words a reply has not
  revealed yet should be spent over the voice that is actually left. Supplying it replaces the
  fixed `tailMs` guess for that utterance; `tailMs` remains the fallback when the supplier is
  absent or answers `null`. Wire it as
  `remainingVoiceMs: () => session?.bufferedVoiceMs() ?? null` — captions are usually attached
  before the session they pace against exists.

### Fixed
- A reply whose utterance had ended could keep crawling well past the voice, or dump early,
  because the tail spent a constant instead of the audio remaining.

## [0.2.1] - 2026-08-12

Everything here is additive and opt-in. A host that calls none of it behaves exactly as on 0.2.0,
and with `sideEffects: false` bundles none of it.

### Added
- `attachCaptions(target, options)` — the streaming caption surface: ASR partials, settled user
  turns, and the avatar's reply revealed against the utterance that speaks it. It paces the reply
  from `speech_start` / `speech_end` and the `speechId` they share with the turn, rather than from
  a delay constant, and compresses the remaining words once the utterance ends. Wire
  `onSpeechStart` / `onSpeechEnd` alongside `onPartial` / `onTurn` to get the alignment.
  `captions.line({text, kind, speaker})` writes a line your application authored — a written
  fallback, an interstitial — into the same ribbon.
- `session.on(event, handler)` — subscribe after construction, unsubscribe with the returned
  function. The constructor `callbacks` still work and fire first; this exists because a callback
  bag fixed at construction cannot be joined later, which forced every host to hand-forward events
  into the DOM helpers. A throwing handler cannot break the session or the other subscribers.
- `attachSessionUI(container, options)` — mounts the disclosure, controls and captions together and
  wires them to a session, including which states show what. It does not own layout or product
  copy. `visibleWhen` / `controlsEnabledWhen` / `setLive()` exist because "live" is not always the
  SDK's `WidgetState.live` — some products wait for the first frame *and* the mic.
- `AvatarSession.preflight()` — microphone permission, MSE support and the browser gate in one
  call, returning a classified result instead of a raw `DOMException`. Hold its `stream` and pass
  it as `permittedStream` to avoid a second permission prompt.
- `AvatarSession.suppressMic(bool)`, plus `userMuted` / `micSuppressed` / `micMuted` and a
  `muteChange` event — hold the mic closed around an app-driven turn without discarding the user's
  own choice. `setMuted(true)` … `setMuted(previous)` loses that intent whenever the two
  interleave, and fights any UI bound to the mute state.
- `SESSION_UI_CSS` and `adoptSessionUIStyles(root)`, plus a `@casola/avatar-client/styles.css`
  subpath — the default look for the helpers, themed through custom properties. It ships as a
  string as well as a file because a shadow root never sees a document stylesheet, and a
  shadow-root embed is exactly the surface that most needs a default.

### Changed
- **`callbacks.onError` now receives a classified `AvatarError`** (`kind` + `terminal`) instead of
  `unknown`. Existing handlers typed `(e: unknown)` keep compiling — this narrows what the SDK
  passes, it does not change what it calls. Branch on `e.kind` rather than sniffing DOMException
  names: a box that cannot bind the pinned avatar arrives as `persona-unavailable`, and telling
  that user to check their microphone is a bug this replaces. `classifyMicError` and `isMicError`
  are exported for hosts that map errors to their own copy.

## [0.2.0] - 2026-08-11

### Changed
- **BREAKING:** the SDK now speaks avatar protocol v2 exclusively — one session WebSocket
  (`/v2/session`) carrying JSON control messages and binary media frames, replacing the v1
  `/mse` + `/mic_stream` pair. Your backend must mint sessions with `protocol_versions: [2]`
  against a fleet containing protocol-v2 boxes; stay on 0.1.x for v1 fleets.
- **BREAKING:** `connectViaToken` drops `edgePaths` (the session path is well-known) and its
  target now carries `sessionWsUrl` instead of `mseWsUrl`/`micWsUrl`.
- **BREAKING:** `AvatarSessionOpts` drops `textTransport` (typed turns are always in-band) and
  `lang` (use `langs` / `responseLanguage`); the deprecated `onQueueStatus` callback is removed
  as promised in its deprecation note.

### Added
- Poster-mode and fMP4-video sessions from one API: the box's handshake decides, the SDK renders
  either without configuration.
- `attachDisclosure` and `attachSessionControls` carried forward from 0.1.4/0.1.5, unchanged. They
  are protocol-agnostic DOM helpers, so upgrading from 0.1.5 does not lose them.
- `session.personaKey` — the avatar version the box bound, echoed in the handshake.
- `onSpeechStart` / `onSpeechEnd` callbacks marking assistant utterances.
- Interruption-aware audio: server-signalled interruptions drop exactly the unheard tail of
  scheduled playback, and the SDK reports playout progress for echo-window alignment.

## [0.1.5] - 2026-08-10

### Added
- `attachSessionControls(target, options)` — optional SDK-rendered mute and hang-up buttons. The
  SDK owns button semantics, accessible state and pending-hang-up protection; the host owns the
  behavior through `onMutedChange` / `onHangup`, so product-specific cleanup is not bypassed.

## [0.1.4] - 2026-08-10

### Added
- `attachDisclosure(target, options)` — the canonical persistent `● REC · AI · name` session
  disclosure, with the required wording, safe DOM construction and accessible label owned by the
  SDK and placement owned by the application.

## [0.1.3] - 2026-08-07

### Added
- Added `setRuntimeInstruction()` for hidden, in-session guidance that applies to future turns without creating a user message or immediate reply.

### Docs
- Corrected README and docs to reflect `connectViaToken` as the shipping connection strategy; removed references to the never-implemented `connectViaQueue`.

## [0.1.2] - 2026-06-23

### Added
- `LICENSE` (MIT) and `README.md` added to the published package.
- Repository link updated to `casola-ai/avatar-client` (public repo).

## [0.1.1] - 2026-06-01

### Added
- Initial npm publish. MSE video + mic streaming SDK with a token-based connection strategy.
