// GENERATED from packages/avatar-protocol/src/transports/websocket.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { Transport, TransportCloseEvent, TransportState } from '../transport';
import { Listeners } from '../transport';

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
  // biome-ignore lint/suspicious/noExplicitAny: bridges three listener type systems (DOM, Workers, `ws`) — method bivariance needs a parameter every concrete union accepts
  addEventListener(type: string, listener: (ev: any) => void): void;
}

const READY_STATE: Record<number, TransportState> = {
  0: 'connecting',
  1: 'open',
  2: 'closing',
  3: 'closed',
};

export function webSocketTransport(ws: WebSocketLike): Transport {
  // Browsers default to Blob delivery, which forces async reads; every runtime here supports
  // arraybuffer. Workers server sockets ignore the property (they already deliver ArrayBuffer).
  try {
    ws.binaryType = 'arraybuffer';
  } catch {
    // read-only on some implementations — they deliver ArrayBuffer anyway
  }

  const open = new Listeners<void>();
  const text = new Listeners<string>();
  const binary = new Listeners<Uint8Array>();
  const closed = new Listeners<TransportCloseEvent>();

  ws.addEventListener('open', () => open.emit());
  ws.addEventListener('message', (ev: WebSocketEventLike) => {
    const d = ev.data;
    if (typeof d === 'string') text.emit(d);
    else if (d instanceof ArrayBuffer) binary.emit(new Uint8Array(d));
    else if (ArrayBuffer.isView(d)) {
      const v = d as ArrayBufferView;
      binary.emit(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
    // anything else (e.g. an unexpected Blob) is dropped — the protocol layer treats missing
    // data as transport loss, and no runtime we bind to should produce it
  });
  ws.addEventListener('close', (ev: WebSocketEventLike) => {
    closed.emit({ code: ev.code ?? 1005, reason: ev.reason ?? '' });
  });
  ws.addEventListener('error', () => {
    // surfaced via the close event that follows; nothing protocol-visible here
  });

  return {
    get state() {
      return READY_STATE[ws.readyState] ?? 'closed';
    },
    sendText(data) {
      ws.send(data);
    },
    sendBinary(data) {
      // slice to an exact ArrayBuffer: `ws.send` of a view sends the whole backing buffer on
      // some implementations
      const exact =
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer
          : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      ws.send(exact as ArrayBuffer);
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    onOpen: (fn) => open.add(fn),
    onText: (fn) => text.add(fn),
    onBinary: (fn) => binary.add(fn),
    onClose: (fn) => closed.add(fn),
  };
}
