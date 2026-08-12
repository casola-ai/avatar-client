// GENERATED from packages/avatar-protocol/src/transports/memory.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { Transport, TransportCloseEvent, TransportState } from '../transport';
import { Listeners } from '../transport';

/**
 * An in-memory transport pair for tests: whatever one side sends, the other side's listeners
 * receive. Delivery is asynchronous on a shared promise chain, so ordering matches a real
 * socket: strictly FIFO by send time, including sends performed inside receive handlers. Tests
 * settle deliveries with one macrotask hop, e.g. `await new Promise(r => setTimeout(r, 0))`.
 * The pair starts 'open'.
 */

interface Side {
  transport: Transport;
  setPeer(p: Side): void;
  receiveText(data: string): void;
  receiveBinary(data: Uint8Array): void;
  receiveClose(ev: TransportCloseEvent): void;
}

export function createTransportPair(): [Transport, Transport] {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => void): void => {
    tail = tail.then(fn);
  };

  function makeSide(): Side {
    const text = new Listeners<string>();
    const binary = new Listeners<Uint8Array>();
    const closed = new Listeners<TransportCloseEvent>();
    const open = new Listeners<void>();
    let peer: Side | null = null;
    let state: TransportState = 'open';

    const doClose = (ev: TransportCloseEvent): void => {
      if (state === 'closed') return;
      state = 'closed';
      closed.emit(ev);
    };

    const transport: Transport = {
      get state() {
        return state;
      },
      sendText(data) {
        if (state !== 'open') throw new Error('transport is not open');
        enqueue(() => peer?.receiveText(data));
      },
      sendBinary(data) {
        if (state !== 'open') throw new Error('transport is not open');
        const copy = data.slice();
        enqueue(() => peer?.receiveBinary(copy));
      },
      close(code = 1000, reason = '') {
        if (state !== 'open') return;
        state = 'closing';
        enqueue(() => {
          doClose({ code, reason });
          peer?.receiveClose({ code, reason });
        });
      },
      onOpen: (fn) => open.add(fn),
      onText: (fn) => text.add(fn),
      onBinary: (fn) => binary.add(fn),
      onClose: (fn) => closed.add(fn),
    };

    return {
      transport,
      setPeer(p) {
        peer = p;
      },
      receiveText(data) {
        if (state === 'open') text.emit(data);
      },
      receiveBinary(data) {
        if (state === 'open') binary.emit(data);
      },
      receiveClose(ev) {
        doClose(ev);
      },
    };
  }

  const a = makeSide();
  const b = makeSide();
  a.setPeer(b);
  b.setPeer(a);
  return [a.transport, b.transport];
}
