# Changelog

All notable changes to `@casola/avatar-client` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
