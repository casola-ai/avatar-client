/**
 * diagnostics.ts — the bounded operational vocabulary a session reports about itself.
 *
 * WHY: the SDK knew things no host could see. A post-accept socket close flattened to
 * `edge_disconnect` (the code was dropped); a protocol violation was a `dev`-only `console.warn`;
 * a `play()` rejection, a suspended mic AudioContext, a lost mic track, every connect-phase
 * timing and the negotiated mic codec were swallowed. Hosts built their own `WebSocket` /
 * `AudioContext` monkey-patches to infer from outside what the SDK already knew inside.
 *
 * `onDiagnostic` is that inside view, made explicit and BOUNDED: DOMException *names* not messages,
 * close *codes* and wire enums not free text, a reason *length* never its content. Nothing here
 * identifies a person or carries a URL. It is diagnostics, not a second transcript — the moments a
 * `turn`/`partial`/`speechStart` already cover are not repeated here.
 *
 * Receivers MUST treat an unrecognized `type` as ignorable: this union grows, and a host that
 * switches on it needs a default that drops the unknown rather than throwing.
 */

import type { VideoCodec } from './protocol';
import type { EndReason } from './v2/driver';

/** The connect-phase milestones on the way to a live session, each timed from the socket's
 *  creation (`ms`). Absent phases did not happen this session (poster mode has no `first_frame`;
 *  a receive-only session has no `mic_ready`). */
export type ConnectPhase = 'socket_open' | 'accept' | 'first_frame' | 'first_audio' | 'mic_ready';

/** Where a media-pipeline error came from. `codec_unsupported`: the declared mime failed
 *  `isTypeSupported`; `source_buffer`/`element`: the MSE SourceBuffer or the video element fired
 *  `error`. */
export type MediaErrorSource = 'source_buffer' | 'element' | 'codec_unsupported';

/** What the pause watchdog did about an unexpected pause: resumed, or resumed muted after the
 *  browser refused an unmuted resume (iOS Safari). */
export type StallAction = 'resume' | 'resume_muted';

/** The negotiated shape of a session, known at the accept — the codecs actually in force and
 *  whether video is playing at all. `micCodec` is `null` for a receive-only session. */
export interface NegotiatedInfo {
  micCodec: string | null;
  videoCodec: VideoCodec | null;
  hasVideo: boolean;
  posterMode: boolean;
  features: string[];
}

interface DiagnosticBase {
  /** `Date.now()` at emission. */
  at: number;
  /** The mint's session id and the support trace id, echoed on every diagnostic when the host
   *  passed them in `AvatarSessionOpts`. Absent otherwise — the SDK invents neither. */
  sessionId?: string;
  traceId?: string;
}

/**
 * The variant payloads, without the `at`/`sessionId`/`traceId` envelope — what an emitter passes;
 * the session stamps the envelope on. A discriminated union on `type`; branch on it, and
 * default-ignore an unrecognized member.
 */
export type DiagnosticData =
  | { type: 'connect_phase'; phase: ConnectPhase; ms: number }
  /** The session socket closed. `afterAccept` is the whole point: before the accept this is a
   *  connect failure the close-code error already carries; after it, this is the code that
   *  `edge_disconnect` used to throw away. `reasonLength` never the reason itself. */
  | { type: 'socket_closed'; code: number; afterAccept: boolean; reasonLength: number }
  | { type: 'protocol_violation'; violation: string; state: string }
  /** The box sent an in-band `error`. `inFlightRequest` = it was correlated to a `sendText`
   *  (which rejects) rather than an unsolicited session error. */
  | { type: 'server_error'; code: string; inFlightRequest: boolean }
  | { type: 'go_away'; deadlineS: number | null }
  | { type: 'session_end'; reason: string; mapped: EndReason }
  | ({ type: 'negotiated' } & NegotiatedInfo)
  /** Round-trip time of a keepalive ping the SDK sent, in ms. */
  | { type: 'rtt'; ms: number }
  /** A `sendText` did not complete for a reason that is not itself a `server_error`: `timeout`
   *  (no reply within the text timeout), `transport` (the socket was not active when called). A
   *  box-rejected turn arrives as `server_error{inFlightRequest:true}` instead. */
  | { type: 'text_failed'; reason: 'timeout' | 'transport' }
  | { type: 'playback_rejected'; name: string; readyState: number; muted: boolean }
  | { type: 'media_error'; source: MediaErrorSource; name: string }
  /** MSE evicted buffered media under `QuotaExceededError`; `attempt` counts how many times this
   *  session has. */
  | { type: 'buffer_evicted'; attempt: number }
  | { type: 'stall'; action: StallAction; attempt: number }
  /** The mic AudioContext was `suspended` when capture started; `resumed` says whether a
   *  `resume()` recovered it. A false here is a mic that reports ready but sends silence. */
  | { type: 'mic_context'; state: string; resumed: boolean }
  | { type: 'mic_track'; event: 'ended' | 'mute' | 'unmute' | 'device_change' }
  | { type: 'frame_dropped'; reason: 'no_start' | 'mismatch' };

/** One operational fact about a live session: a {@link DiagnosticData} variant plus the envelope
 *  ({@link DiagnosticBase}) the SDK stamps on it. */
export type AvatarDiagnostic = DiagnosticBase & DiagnosticData;

/** What {@link AvatarSession.stats} returns: a session's diagnostic stream folded into one
 *  snapshot, readable after the session ends (the driver is gone by then, so this is accumulated
 *  on the session as diagnostics arrive). */
export interface AvatarSessionStats {
  /** ms-from-connect for each phase that happened. */
  connect: Partial<Record<ConnectPhase, number>>;
  /** The close code, once the socket has closed. `null` while still open. */
  closeCode: number | null;
  /** The most recent keepalive round-trip, in ms. `null` before the first pong. */
  rttMs: number | null;
  negotiated: NegotiatedInfo | null;
  counters: {
    protocolViolations: number;
    serverErrors: number;
    mediaErrors: number;
    bufferEvictions: number;
    playbackRejections: number;
    stalls: number;
    micTrackEvents: number;
    framesDropped: number;
    textFailures: number;
    /** Outgoing mic frames — the count the 10 Hz `onAudioFrameSent` callback used to be read as. */
    micFramesSent: number;
  };
}

/** A fresh zeroed stats snapshot. */
export function emptyStats(): AvatarSessionStats {
  return {
    connect: {},
    closeCode: null,
    rttMs: null,
    negotiated: null,
    counters: {
      protocolViolations: 0,
      serverErrors: 0,
      mediaErrors: 0,
      bufferEvictions: 0,
      playbackRejections: 0,
      stalls: 0,
      micTrackEvents: 0,
      framesDropped: 0,
      textFailures: 0,
      micFramesSent: 0,
    },
  };
}
