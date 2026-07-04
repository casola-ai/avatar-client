export interface MseHandlers {
    onFirstFrame?: () => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
}
export declare class MsePlayer {
    private readonly video;
    private readonly dev;
    static supported(): boolean;
    private ms;
    private sb;
    private ws;
    private mime;
    private readonly pending;
    private sourceOpen;
    private streaming;
    private started;
    private firstFrameFired;
    private closed;
    private handlers;
    private startSeeked;
    private lastSeekAt;
    constructor(video: HTMLVideoElement, dev?: boolean);
    connect(wsUrl: string, handlers?: MseHandlers): void;
    private openWs;
    private onMessage;
    private trySetup;
    private drain;
    private housekeep;
    stop(): void;
}
