import type { Transport } from '../transport';
/**
 * Structural WebSocket shape covering the three sockets this repo runs on: browser `WebSocket`,
 * a Workers server-side socket after `accept()`, and the `ws` package's client (which implements
 * the browser-compatible addEventListener surface). Structural typing keeps the core DOM-free.
 */
/** The event shape the adapter reads — a structural slice of MessageEvent/CloseEvent. */
export interface WebSocketEventLike {
    data?: unknown;
    code?: number;
    reason?: string;
}
export interface WebSocketLike {
    readyState: number;
    binaryType?: string;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (ev: any) => void): void;
}
export declare function webSocketTransport(ws: WebSocketLike): Transport;
