export interface Turn {
    text: string;
    reply: string;
    language?: string;
    speechId?: string;
}
export interface MicHandlers {
    onPartial?: (text: string) => void;
    onTurn?: (turn: Turn) => void;
    onError?: (err: unknown) => void;
}
export declare class MicCapture {
    private ctx;
    private stream;
    private node;
    private sink;
    private ws;
    private handlers;
    private inRate;
    private resTail;
    private resPos;
    private readonly frame;
    private frameLen;
    private closed;
    private muted;
    private pcmCallCount;
    private langs;
    static ensurePermission(): Promise<MediaStream>;
    start(wsUrl: string, lang: string, handlers?: MicHandlers, workletUrl?: string, stream?: MediaStream, dev?: boolean, langs?: string[]): Promise<void>;
    private openWs;
    private onServerMessage;
    private onPcm;
    setMuted(m: boolean): void;
    /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
     *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
    setLangs(langs: string[]): void;
    private flushFrame;
    stop(): void;
}
