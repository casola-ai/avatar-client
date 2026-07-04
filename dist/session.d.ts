import type { Turn } from './mic-capture';
import type { WidgetState } from './state';
export type { Turn, WidgetState };
export type EndReason = 'cap' | 'edge_disconnect' | 'kicked' | 'expired' | 'dropped' | 'generic';
export interface EdgeTarget {
    mseWsUrl: string;
    micWsUrl: string;
    sessionCapSeconds?: number;
}
export interface ConnectHandlers {
    onStatus?(s: {
        phase: 'open';
    }): void;
    onReady(t: EdgeTarget): void;
    onEnded?(r: EndReason): void;
    onError?(e: unknown): void;
}
export interface ConnectStrategy {
    connect(h: ConnectHandlers): void;
    close(): void;
}
export interface AvatarSessionOpts {
    videoEl: HTMLVideoElement;
    connect: ConnectStrategy;
    lang?: string;
    /** Initial ASR language pin (box language names, e.g. ['English']). [] / omitted = auto-detect. */
    langs?: string[];
    workletUrl?: string;
    prewarm?: () => Promise<void> | void;
    dev?: boolean;
    /** Pre-fetched MediaStream from ensureMicPermission() — avoids a second getUserMedia call. */
    permittedStream?: MediaStream;
    callbacks?: {
        onStateChange?(next: WidgetState, prev: WidgetState): void;
        onQueueStatus?(s: {
            phase: 'open';
        }): void;
        onPartial?(text: string): void;
        onTurn?(t: Turn): void;
        onFirstFrame?(): void;
        onClose?(r: EndReason): void;
        onError?(e: unknown): void;
    };
}
export declare class AvatarSession {
    private readonly opts;
    private readonly sm;
    private mse;
    private mic;
    private done;
    private _sessionCapSeconds;
    private permittedStream;
    private langs;
    constructor(opts: AvatarSessionOpts);
    get state(): WidgetState;
    get sessionCapSeconds(): number | undefined;
    static ensureMicPermission(): Promise<MediaStream>;
    static mediaSupported(): boolean;
    start(): Promise<void>;
    private openMedia;
    leave(): void;
    setMuted(muted: boolean): void;
    /** Change the ASR recognition language(s) — applies live mid-session and persists for the
     *  session (and any socket reconnect). [] = auto-detect across the box's configured set. */
    setLangs(langs: string[]): void;
    get asrLangs(): string[];
    destroy(): void;
    private internalEnd;
    private internalFail;
    private teardown;
}
