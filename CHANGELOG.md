# Changelog

All notable changes to `@casola/avatar-client` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.5] - 2026-08-10

### Added
- Added `attachSessionControls()` for optional, accessible mute and hang-up buttons with host-owned callbacks and asynchronous ending-state protection.

## [0.1.4] - 2026-08-10

### Added
- Added `attachDisclosure()` for a canonical, safely rendered `REC · AI · name` session label with live updates and optional plain-text detail segments.

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
