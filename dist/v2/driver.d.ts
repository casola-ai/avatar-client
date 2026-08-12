import { AvatarError } from '../errors';
import { type MicFrameInfo } from '../mic-pipeline';
import { type WebSocketLike } from '../protocol';
export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';
export interface Turn {
    text: string;
    reply: string;
    language?: string;
    speechId?: string;
}
/** The socket the driver opens. Browser `WebSocket` satisfies this; tests inject a fake. */
export interface DriverSocket extends WebSocketLike {
    /** The subprotocol the server echoed on the 101 (empty until open). */
    readonly protocol?: string;
}
export interface V2DriverHandlers {
    onAccept(info: {
        capSeconds: number;
        personaKey: string;
        posterUrl: string | null;
        hasVideo: boolean;
    }): void;
    onFirstFrame(): void;
    onMicReady(): void;
    onPartial(text: string): void;
    onTurn(turn: Turn): void;
    onSpeechStart(speechId: string): void;
    onSpeechEnd(speechId: string): void;
    onAudioFrameSent(info: MicFrameInfo): void;
    onAudioBlocked(): void;
    /** The session is over after a successful handshake — server end or transport loss. */
    onEnded(reason: EndReason): void;
    /** terminal=true: the session cannot proceed (connect/handshake/mic failure).
     *  terminal=false: an in-band server error or media hiccup; the session keeps running.
     *  Always an `AvatarError` — the driver classifies before it hands anything up. */
    onError(err: AvatarError, terminal: boolean): void;
}
export interface V2DriverOpts {
    videoEl: HTMLVideoElement;
    sessionWsUrl: string;
    mic: boolean;
    langs: string[];
    responseLanguage?: string;
    workletUrl: string;
    permittedStream?: MediaStream;
    dev: boolean;
    handlers: V2DriverHandlers;
    /** Test seam — defaults to `new WebSocket(url, protocols)`. */
    createSocket?: (url: string, protocols: string[]) => DriverSocket;
}
/**
 * The protocol-v2 session driver: one WebSocket, JSON control + binary media frames
 * (docs/avatar-protocol-v2-spec.md). Owns the connection, the mic pipeline (channel 1 up),
 * PCM playback (channel 2 down) and MSE video (channel 3 down); AvatarSession owns the
 * user-facing state machine and callbacks.
 */
export declare class V2Driver {
    private readonly opts;
    private conn;
    private mse;
    private player;
    private pipeline;
    private accepted;
    private audioCh;
    private micCh;
    private endReason;
    private finished;
    private handshakeTimer;
    private ackTimer;
    private pingTimer;
    private textSequence;
    private readonly textWaiters;
    private langs;
    private responseLanguage;
    constructor(opts: V2DriverOpts);
    connect(): void;
    private onServerMessage;
    private onAccept;
    private startMic;
    private sendMicFrame;
    private onMediaFrame;
    private onSocketClose;
    private fail;
    sendText(text: string): Promise<Turn>;
    /** Re-pin the ASR recognition language(s) mid-session; applied by the box on the next turn. */
    setLangs(langs: string[]): void;
    /** Change the preferred REPLY language mid-session (BCP-47; '' clears). */
    setResponseLanguage(language: string): void;
    /** Replace the hidden runtime instruction appended to the avatar's system prompt. */
    setRuntimeInstruction(instruction: string): void;
    setMuted(muted: boolean): void;
    unmuteAudio(): boolean;
    /** Deliberate local end: say goodbye, close, release resources. Fires no handler — the
     *  caller (AvatarSession) already decided the outcome. */
    stop(): void;
    private teardown;
}
