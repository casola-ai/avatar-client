# Changelog

All notable changes to `@casola/avatar-client` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.10.0] - 2026-09-20

### Added
- **`micLevel` event** — the microphone's loudness about 20 times a second while a stream backs
  the channel: `{ rms, peak }`, linear full-scale 0..1 on the raw capture samples. For a level
  meter, and for noticing a microphone that is attached but hears nothing. Zeros while muted; no
  events while unbacked or while the capture context is not rendering. on()-only, and the
  measurement is skipped when nobody subscribes. `MicPipelineOpts.onLevel` for hosts driving the
  pipeline directly; `MicLevel` and `MIC_LEVEL_INTERVAL_S` exported.

## [0.9.0] - 2026-09-19

### Added
- **The microphone can arrive late.** The mic channel is declared in the hello and stays up for
  the whole session; whether a microphone is behind it can change. Unbacked, the session sends the
  same zeroed 100 ms frames mute sends — the box hears silence, not a stalled clock (its endpointer
  keeps time by counting frames, casola-ai/avatar#628). `permittedStream` may now be a **Promise**:
  a permission prompt the host is still waiting on. The session runs unbacked and attaches the
  stream when it resolves; `null` means "do not prompt again".
- **`session.enableMic(stream?)`** backs the channel later — the stream given, or one asked of
  getUserMedia (call from a gesture) — without a reconnect, rebuilding a dead Opus encoder on the
  way. Rejects with the raw error when the capture cannot come up, or when there is no mic channel.
- **`session.micBacked`**, the **`micBacking`** event and the **`mic_backing`** diagnostic (counted
  in `stats().counters.micBackingChanges`) say whether the frames on the wire are a microphone or
  zeros, with a bounded `MicBackingReason`: `attached`, `pending`, `declined`, `permission`,
  `unavailable`, `unsupported`, `failed`, `track_ended`, `encoder_failed`.
- `MicPipeline.attach()` / `.backed` for hosts driving the pipeline directly.

### Changed
- **Mic failures no longer end the session.** A refused `getUserMedia`, a worklet that fails to
  load, a track that ends (device unplugged, OS revoked, iOS backgrounded) or an Opus encoder that
  dies used to be terminal (`mic-permission` / `mic-unavailable` / `mic-failed`, or a silent
  channel). They now drop the channel to zeroed frames and report through `micBacking`; the
  session goes on, and `enableMic()` can recover it. Hosts that showed an end-of-call error on
  those kinds should listen to `micBacking` instead. `preflight()` and `enableMic()` still reject
  with the classified error.
- `micReady` fires on every attach, not only the first; the `mic_ready` connect phase is still
  reported once. A stream a promised `permittedStream` delivers after `leave()` is stopped.

## [0.8.0] - 2026-09-18

### Added
- **Session diagnostics.** A new `callbacks.onDiagnostic` and the `diagnostic` event deliver a
  bounded `AvatarDiagnostic` — the operational facts the SDK knew inside and no host could see.
  The driver emits connect-phase timings (`socket_open` → `mic_ready`), `socket_closed` with the
  close code (the number `edge_disconnect` used to flatten away), `protocol_violation`, in-band
  `server_error`, `go_away`, `session_end`, the `negotiated` shape, keepalive `rtt` and
  `text_failed`; the players and mic pipeline add `playback_rejected`, `media_error`,
  `buffer_evicted`, `stall`, `mic_context`, `mic_track` and `frame_dropped`. The vocabulary is
  bounded on purpose: DOMException *names* not messages, close *codes* and wire enums, a reason
  *length* never its text — no person, no URL. Receivers must ignore an unrecognized `type`; the
  union grows.
- **`AvatarSession.stats()`** folds that stream into one snapshot — the connect timeline, the close
  code, the last keepalive RTT, the negotiated shape and running counters — readable after the
  session has ended. **`AvatarSession.negotiated`** exposes the codecs in force.
- **`AvatarSessionOpts.sessionId` / `traceId`** are stamped on every diagnostic so a report joins
  the mint and the support trace. They never go on the wire.
- **`AvatarSessionOpts.logger`** (`(level, message, detail?) => void`) routes the SDK's internal
  logs — the driver, players, mic pipeline and state machine — through one sink. Absent, behavior
  is unchanged: a dev-gated console.
- **`AvatarError.closeCode` and `AvatarError.serverCode`** — the raw WebSocket close code behind a
  kind, and the box's in-band error `code`, which the flattened error message used to drop.

### Fixed
- **iOS codec probe.** MSE source-buffer setup probed the global `MediaSource.isTypeSupported`, but
  the hello offer probes the implementation the player actually uses (`ManagedMediaSource` on iOS,
  which decodes HEVC the global refuses) — so an iPad session could be failed for a codec it can
  play. Setup now probes the same implementation.

## [0.7.0] - 2026-09-10

### Added
- **Negotiable downlink video codec.** The hello now carries `video.codecs` — every codec this
  browser can decode, probed with `MediaSource.isTypeSupported` against the same implementation the
  player uses (`ManagedMediaSource` on iOS) — and the box answers with the one it will serve in the
  ch3 descriptor's new `video_codec`, alongside that stream's own `mime`. The list is a
  **capability, not a preference**: the box walks its own order (av1 → hevc → h264, by measured
  bits-per-quality) and serves the first entry the client named, because it is the side holding the
  numbers. On the GPU box av1 ships the same quality as h264 for ~20–40 % fewer bits.
  Compatibility is total in both directions: a box that predates the feature ignores `hello.video`
  and sends no `video_codec`, which means h264 — today's stream, byte for byte — and a client that
  offers nothing gets the same.
- **`AvatarSessionOpts.videoCodec`** (`'auto' | 'h264'`, default `'auto'`), mirroring `micCodec`.
  `'h264'` offers nothing and is the opt-out if a platform's hardware decode misbehaves.
- **`AvatarSession.videoCodec`** — the codec the box negotiated for this session (`'h264'` from a
  box that does not negotiate), `undefined` before the accept and in poster mode — and
  **`AvatarSession.decodableVideoCodecs()`** / `MsePlayer.decodableVideoCodecs()`, what the hello
  offers. Report the pair to explain where a given session landed.
- The `VideoCodec` type and `VIDEO_CODECS` are exported.

## [0.6.0] - 2026-09-06

### Added
- **Connect watchdogs.** The session socket must `open` within 30 s of being created and, for a
  video session, show a first frame within 20 s of the box's `accept`; either overrun ends the
  session with a terminal `AvatarError` of the new kind `'timeout'`. Before this, the only
  connect-phase timer started on `open`, so a black-holed upgrade left the host at "Connecting…"
  forever (avatar#513). A `prewarm` that runs past 5 s no longer holds the connect: the session
  proceeds and emits a non-terminal `timeout` so the host can count it.
- **`AvatarError.stage`** (`'prewarm' | 'open' | 'handshake' | 'first-media'`) on the errors a
  watchdog produced, and the exported `AvatarErrorStage` type. The existing handshake timeout keeps
  its kind (`'handshake'`) and gains `stage: 'handshake'`.

## [0.5.1] - 2026-09-06

### Fixed
- **A re-start of an utterance ignores a stale end that precedes it.** When the box reported
  "utterance N started", "utterance N ended" and "utterance N started" again before the local
  playhead had reached the first start, `UtteranceScheduler.receiveStart` merged the re-start
  with the dropped interval and kept its old end; an interval that ends before it begins never
  fires, and the caption stopped at the first sentence. An inherited end at or before the new
  start is now cleared, so the re-start is a fresh interval. See #692.

## [0.5.0] - 2026-09-01

### Changed
- **Microphone capture now requests `autoGainControl: true`**, completing the pair started in
  0.4.2. Nothing else in the chain normalizes level — the worklet, the resampler and the box are
  all unity gain — so without AGC the box compares a raw hardware capture level against absolute
  VAD bars, and a user with low input gain has no path to being heard. Minor rather than patch:
  the box's `MIC_ONSET_RMS`/`MIC_OFFSET_RMS` are calibrated for AGC-off capture and may need
  re-tuning alongside this. See #687.

## [0.4.2] - 2026-09-01

### Changed
- **Microphone capture now requests `noiseSuppression: true`.** It was off because this capture
  once fed a box-side *linear* echo canceller (`SERVER_AEC`), for which a nonlinear time-varying
  gain ahead of it breaks the echo-path model. That canceller was retired in `casola-ai/avatar`
  #227 — the browser's AEC3 has been the sole echo handler since — so the constraint had outlived
  its reason, while the box's own debug UI has run noise suppression on throughout. Hosts need no
  change; `echoCancellation` stays on and `autoGainControl` stays off (tracked in #687, which
  needs a measured rollout because it rescales the signal the box's absolute VAD bars are
  calibrated against).

## [0.4.1] - 2026-09-01

### Fixed
- **0.4.0's Opus uplink failed on every WebCodecs browser.** It encoded one 100 ms Opus packet per
  mic frame; Chromium (151 verified) answers `isConfigSupported: true` for that and then fails the
  first `encode()` with `EncodingError: Failed to add to Repacketizer`, which hosts saw as a
  terminal `mic-failed` right after the accept. The encoder now produces native 20 ms packets and
  each wire frame carries five of them, each prefixed by a big-endian u16 length (spec §4). Wire
  cadence, `seq`, `pts_us` and `onAudioFrameSent` are unchanged. Boxes need the matching decoder
  (casola-ai/avatar #459 as updated); they keep accepting 0.4.0's bare single packet as well.

## [0.4.0] - 2026-08-31

Additive. A host that passes nothing new behaves as on 0.3.1 except that, where the browser and the
box both support it, the microphone now goes up as Opus instead of raw PCM.

### Added
- Opus mic uplink: the hello carries `mic.codecs: ['opus', 'pcm16']` when this browser's WebCodecs
  `AudioEncoder` can produce the wire's 100 ms Opus packets, and a box that accepts `opus` on
  channel 1 receives one 32 kbit/s packet per mic frame (~400 B) instead of 3200 B of PCM16 — an
  ~8× smaller uplink. Frame cadence, `seq`, `pts_us`, mute-as-silence and `onAudioFrameSent` are
  unchanged. A box or browser without Opus support lands on pcm16 with no host involvement.
- `AvatarSessionOpts.micCodec` (`'auto'` | `'pcm16'`) — `'pcm16'` never offers Opus.
- `AvatarError` kind `mic-failed` now also covers a WebCodecs encoder failure mid-session.

## [0.3.1] - 2026-08-12

### Added
- Negotiated timed utterances (`utterance_timing_v1`): lifecycle callbacks are scheduled against
  the local audio/video playout clock rather than socket arrival, pending text revisions remain
  hidden until their start PTS, and interruption cancels the unheard caption and media tail.
- Explicit media-unit boundaries (`media_unit_flags_v1`) so fragmented MP4 units can be reassembled
  before append and discarded atomically when an interruption cuts through a unit.
- `onUtteranceStart`, `onUtteranceText`, and `onUtteranceEnd` callbacks, with matching caption
  controller methods for hosts that render the negotiated lifecycle.

### Fixed
- The public 0.3.0 package contained the timed-utterance implementation, but its release notes only
  described the earlier caption-tail fix. This release makes the shipped API and changelog agree.

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
