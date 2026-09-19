export type {
  CaptionLineInput,
  CaptionsController,
  CaptionsOptions,
  CaptionTurn,
} from './captions';
export { attachCaptions } from './captions';
export { connectViaToken } from './connect/token';
export type {
  SessionControlLabels,
  SessionControlsController,
  SessionControlsOptions,
} from './controls';
export { attachSessionControls } from './controls';
export type {
  AvatarDiagnostic,
  AvatarSessionStats,
  ConnectPhase,
  MediaErrorSource,
  NegotiatedInfo,
  StallAction,
} from './diagnostics';
export type { DisclosureController, DisclosureOptions } from './disclosure';
export { attachDisclosure } from './disclosure';
export type { AvatarErrorKind, AvatarErrorStage } from './errors';
export { AvatarError, classifyMicError, isMicError } from './errors';
export type { Logger, LogLevel } from './logger';
export type { PlayoutClock } from './playout-clock';
// Wire identifiers, for advanced integrations (custom ConnectStrategy / diagnostics).
export type { VideoCodec } from './protocol';
export { CloseCode, SUBPROTOCOL, VIDEO_CODECS } from './protocol';
export type {
  AvatarSessionEvents,
  AvatarSessionOpts,
  ConnectHandlers,
  ConnectStrategy,
  EdgeTarget,
  EndReason,
  MicBackingReason,
  MicBackingState,
  MicFrameSentInfo,
  MicMuteState,
  PreflightResult,
  Turn,
} from './session';
export { AvatarSession } from './session';
export type { SessionUIController, SessionUIOptions, SessionUIPart } from './session-ui';
export { attachSessionUI } from './session-ui';
export type { Listener, WidgetState } from './state';
export { adoptSessionUIStyles, SESSION_UI_CSS } from './styles';
export type { TimedUtterance, UtteranceSchedulerHandlers } from './utterance-scheduler';
export { UtteranceScheduler } from './utterance-scheduler';
