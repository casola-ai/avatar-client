import { ClockMap } from './clock-map';
import type { DiagnosticData } from './diagnostics';
import { type Logger } from './logger';
/** The uplink sample rate, whichever codec ch1 negotiated (spec §4). */
export declare const MIC_SAMPLE_RATE = 16000;
export declare const MIC_FRAME_SAMPLES = 1600;
/** The v1 wire's "video media time unknown" sentinel, kept for the onAudioFrameSent callback's
 *  `videoMediaTimeMs` field (its shape predates v2 and is unchanged). On the v2 wire an unknown
 *  value is sent as `pts_us = 0` instead — the sentinel never leaves the process. */
export declare const VIDEO_MEDIA_TIME_UNKNOWN = 4294967295;
/**
 * Why the mic channel is, or is not, backed by a capture stream.
 *
 * - `attached` — a stream is capturing; the frames on the wire are the microphone.
 * - `pending` — the host promised a stream (`stream` was a Promise) and it has not resolved yet.
 * - `declined` — the host's promise resolved `null`: no stream, and no prompt of our own.
 * - `permission` / `unavailable` / `unsupported` / `failed` — `getUserMedia` or the worklet refused,
 *   classified like `classifyMicError`.
 * - `track_ended` — the capture track ended (device unplugged, OS revoked the mic, iOS backgrounded).
 * - `encoder_failed` — the driver's Opus encoder died; the pipeline itself never reports this.
 *
 * Whenever the channel is unbacked it keeps sending zeroed frames on the 100 ms cadence, so the
 * box sees one continuous uplink and reads the gap as silence, never as a stalled clock.
 */
export type MicBackingReason = 'attached' | 'pending' | 'declined' | 'permission' | 'unavailable' | 'unsupported' | 'failed' | 'track_ended' | 'encoder_failed';
/** Per-frame capture calibration, produced once per flushed 100 ms frame. */
export interface MicFrameInfo {
    micSeq: number;
    videoMediaTimeMs: number;
    captureEpochMs: number;
}
/** The capture-instant calibration step, extracted as a pure function so it's directly
 *  unit-testable without a real AudioContext/DOM: given a frame's (latency-compensated) capture
 *  instant on the AudioContext clock and the audio-clock calibration built up so far, look up the
 *  corresponding performance.now()-domain instant, then ask `getVideoMediaTimeMs` (typically
 *  MsePlayer.mediaTimeAt) what the avatar video was showing at that same instant. Returns null
 *  only when the audio clock map has no samples yet (never in practice — flushFrame always
 *  records one immediately before calling this). */
export declare function computeFrameTimestamp(frameStartContextTime: number, inputLatencySeconds: number, audioClockMap: ClockMap, getVideoMediaTimeMs: ((performanceTimeMs: number) => number | null) | undefined, timeOrigin: number): {
    videoMediaTimeMs: number;
    captureEpochMs: number;
} | null;
export interface MicPipelineOpts {
    workletUrl: string;
    /** Where the capture stream comes from. A `MediaStream` (pre-fetched via `ensurePermission()`,
     *  which avoids a second getUserMedia prompt) attaches at once. A Promise is a stream the host
     *  is still waiting for — typically a permission prompt the visitor has not answered yet: the
     *  channel runs unbacked (zeroed frames) until it resolves, and a `null` resolution means the
     *  host chose not to prompt again. `undefined` asks `getUserMedia` here, as before. */
    stream?: MediaStream | Promise<MediaStream | null>;
    dev?: boolean;
    /** Typically MsePlayer.mediaTimeAt — kept as a plain function so the pipeline stays
     *  decoupled/testable. undefined = no video calibration source (poster mode); frames then
     *  report VIDEO_MEDIA_TIME_UNKNOWN. */
    getVideoMediaTimeMs?: (performanceTimeMs: number) => number | null;
    /** Where the pipeline routes its logs. Defaults to a dev-gated console. */
    logger?: Logger;
    /** One call per assembled 100 ms 16 kHz frame. `pcm` is a fresh copy the receiver owns.
     *  Muted frames arrive zeroed (capture keeps running so timing stays continuous). */
    onFrame: (pcm: Int16Array, info: MicFrameInfo) => void;
    /** Bounded mic diagnostics — `mic_context` (a suspended AudioContext at start, which used to be
     *  swallowed) and `mic_track` (the track ending / muting / a device change). Optional. */
    onDiagnostic?: (d: DiagnosticData) => void;
    /** The channel gained or lost its capture stream. `true` means the frames are the microphone
     *  from now on; `false` means they are zeros, and `reason` says why. Optional. */
    onBacking?: (backed: boolean, reason: MicBackingReason) => void;
    /** Clock for the unbacked cadence, in ms. Test seam; defaults to `performance.now`. */
    now?: () => number;
}
/**
 * Microphone capture: getUserMedia → AudioWorklet → resample to 16 kHz → 1600-sample Int16
 * frames with capture-instant calibration. Wire-agnostic — the v2 driver turns the emitted
 * frames into channel-1 media frames. Extracted from the v1 MicCapture (which also owned the
 * /mic_stream socket); the audio path is unchanged.
 *
 * The channel outlives its stream. From `start()` until `stop()` frames go out on the 100 ms
 * cadence no matter what: zeros while no stream backs the channel (a prompt still open, a refusal,
 * a track that ended), the microphone once one does. The box's endpointer keeps time by counting
 * frames (casola-ai/avatar#628), so a gap would read as a frozen clock, not as silence — and the
 * same zeroed frames are what mute has always sent. `attach()` brings a stream in later; a track
 * that ends drops back to zeros instead of going quiet. `onBacking` says which of the two the
 * wire is carrying.
 */
export declare class MicPipeline {
    private ctx;
    private stream;
    private node;
    private sink;
    private opts;
    private inRate;
    private resTail;
    private resPos;
    private readonly frame;
    private frameLen;
    private closed;
    private muted;
    private pcmCallCount;
    private audioClockMap;
    private inputLatencySeconds;
    private frameStartContextTime;
    private micSeq;
    private teardownListeners;
    private log;
    private _backed;
    private attaching;
    private silentTimer;
    private silentT0;
    private silentEmitted;
    /** Whether a capture stream backs the channel right now (else the frames are zeros). */
    get backed(): boolean;
    static ensurePermission(): Promise<MediaStream>;
    /**
     * Bring the channel up. Resolves once frames are flowing — which is immediately: the unbacked
     * cadence starts first, and the stream (given, promised, or requested from `getUserMedia`)
     * attaches on top of it. A capture that fails to attach is reported through `onBacking`, never
     * thrown from here; `attach()` is the call that rejects, for a host that asked explicitly.
     */
    start(opts: MicPipelineOpts): Promise<void>;
    /**
     * Back the channel with a capture stream. With no `stream`, asks `getUserMedia` (call it from a
     * user gesture — iOS refuses otherwise). A stream that is already attached is replaced.
     * Rejects with the raw error when the capture cannot be brought up; the channel then stays
     * unbacked and keeps its cadence.
     */
    attach(stream?: MediaStream): Promise<void>;
    private doAttach;
    /** The capture graph: AudioContext at the track's rate → worklet → silent sink. */
    private bringUp;
    private onTrackEnded;
    /** Tear the capture graph down and forget it. The cadence and `micSeq` are untouched: the
     *  channel goes on, the frames just stop being the microphone. */
    private detachCapture;
    private setBacking;
    private startSilent;
    private stopSilent;
    private now;
    private silentTick;
    private emitSilentFrame;
    private onPcm;
    private flushFrame;
    setMuted(m: boolean): void;
    /** Idempotent. Ends the cadence and the capture; a stream still promised is stopped when it
     *  arrives, so a late permission grant never leaves a live microphone behind. */
    stop(): void;
}
