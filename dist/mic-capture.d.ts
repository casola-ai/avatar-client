import { ClockMap } from './clock-map';
export interface Turn {
    text: string;
    reply: string;
    language?: string;
    speechId?: string;
}
export interface MicHandlers {
    /** Fired after the microphone socket is open and its hello/preroll frames have been sent. */
    onReady?: () => void;
    onPartial?: (text: string) => void;
    onTurn?: (turn: Turn) => void;
    onError?: (err: unknown) => void;
    onAudioBlocked?: () => void;
    /** Fired once per flushed 100ms frame with the capture-instant calibration for that frame's
     *  first sample (specs/av-sync-timestamps-notes.md section 2/3). Groundwork only for now —
     *  not yet sent over the wire; a later phase builds the header from this and prepends it in
     *  flushFrame(). */
    onFrameTimestamp?: (info: {
        micSeq: number;
        videoMediaTimeMs: number;
        captureEpochMs: number;
    }) => void;
}
/** The section-2 calibration step, extracted as a pure function so it's directly unit-testable
 *  without a real AudioContext/DOM: given a frame's (latency-compensated) capture instant on the
 *  AudioContext clock and the audio-clock calibration built up so far, look up the corresponding
 *  performance.now()-domain instant, then ask `getVideoMediaTimeMs` (typically
 *  MsePlayer.mediaTimeAt) what the avatar video was showing at that same instant. Returns null
 *  only when the audio clock map has no samples yet (never in practice — flushFrame always
 *  records one immediately before calling this). */
export declare function computeFrameTimestamp(frameStartContextTime: number, inputLatencySeconds: number, audioClockMap: ClockMap, getVideoMediaTimeMs: ((performanceTimeMs: number) => number | null) | undefined, timeOrigin: number): {
    videoMediaTimeMs: number;
    captureEpochMs: number;
} | null;
export declare class MicCapture {
    private ctx;
    private stream;
    private node;
    private sink;
    private ws;
    private player;
    private wsReady;
    private resolveWsReady;
    private rejectWsReady;
    private textSequence;
    private readonly textWaiters;
    private handlers;
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
    private getVideoMediaTimeMs;
    private langs;
    private responseLanguage;
    static ensurePermission(): Promise<MediaStream>;
    start(wsUrl: string, lang: string, handlers?: MicHandlers, workletUrl?: string, stream?: MediaStream, dev?: boolean, langs?: string[], responseLanguage?: string, getVideoMediaTimeMs?: (performanceTimeMs: number) => number | null): Promise<void>;
    /** Open only the fallback's in-band control/audio socket. This is created after `/mse`
     * advertises poster-pcm, so receive-only GPU sessions retain their legacy no-mic behavior. */
    startReceiveOnly(wsUrl: string, lang: string, handlers?: MicHandlers, dev?: boolean, langs?: string[], responseLanguage?: string): void;
    private openWs;
    private onServerMessage;
    private onPcm;
    setMuted(m: boolean): void;
    unmuteAudio(): boolean;
    sendText(text: string): Promise<Turn>;
    /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
     *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
    setLangs(langs: string[]): void;
    /** Change the preferred REPLY language mid-session (BCP-47; '' clears). Sends a
     *  {op:'set_response_language'} text frame the edge applies on the next turn; also stored so
     *  a socket reconnect's hello carries the latest pick. */
    setResponseLanguage(lang: string): void;
    private flushFrame;
    /** Prepends the wire header (section 4) to a 1600-sample PCM frame and sends it as one binary
     *  WS message. Used by both flushFrame() and the preroll send in openWs(). */
    private sendFrame;
    stop(): void;
    private rejectTextWaiters;
}
