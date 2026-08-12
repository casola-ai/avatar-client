import { ClockMap } from './clock-map';
export declare const MIC_FRAME_SAMPLES = 1600;
/** The v1 wire's "video media time unknown" sentinel, kept for the onAudioFrameSent callback's
 *  `videoMediaTimeMs` field (its shape predates v2 and is unchanged). On the v2 wire an unknown
 *  value is sent as `pts_us = 0` instead — the sentinel never leaves the process. */
export declare const VIDEO_MEDIA_TIME_UNKNOWN = 4294967295;
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
    /** Pre-fetched MediaStream from ensurePermission() — avoids a second getUserMedia call. */
    stream?: MediaStream;
    dev?: boolean;
    /** Typically MsePlayer.mediaTimeAt — kept as a plain function so the pipeline stays
     *  decoupled/testable. undefined = no video calibration source (poster mode); frames then
     *  report VIDEO_MEDIA_TIME_UNKNOWN. */
    getVideoMediaTimeMs?: (performanceTimeMs: number) => number | null;
    /** One call per assembled 100 ms 16 kHz frame. `pcm` is a fresh copy the receiver owns.
     *  Muted frames arrive zeroed (capture keeps running so timing stays continuous). */
    onFrame: (pcm: Int16Array, info: MicFrameInfo) => void;
}
/**
 * Microphone capture: getUserMedia → AudioWorklet → resample to 16 kHz → 1600-sample Int16
 * frames with capture-instant calibration. Wire-agnostic — the v2 driver turns the emitted
 * frames into channel-1 media frames. Extracted from the v1 MicCapture (which also owned the
 * /mic_stream socket); the audio path is unchanged.
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
    private readonly audioClockMap;
    private inputLatencySeconds;
    private frameStartContextTime;
    private micSeq;
    static ensurePermission(): Promise<MediaStream>;
    start(opts: MicPipelineOpts): Promise<void>;
    private onPcm;
    private flushFrame;
    setMuted(m: boolean): void;
    stop(): void;
}
