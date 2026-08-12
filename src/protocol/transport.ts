// GENERATED from packages/avatar-protocol/src/transport.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
/**
 * The transport seam. A Transport moves opaque text and binary payloads between two peers and
 * nothing else — no protocol knowledge, no JSON, no framing. The protocol layer
 * (connection.ts) binds to this interface, which is what makes it testable over an in-memory
 * pair and portable to a future WebRTC data-channel binding.
 */

export type TransportState = 'connecting' | 'open' | 'closing' | 'closed';

export interface TransportCloseEvent {
  code: number;
  reason: string;
}

export type Unsubscribe = () => void;

export interface Transport {
  readonly state: TransportState;
  sendText(data: string): void;
  sendBinary(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen(fn: () => void): Unsubscribe;
  onText(fn: (data: string) => void): Unsubscribe;
  onBinary(fn: (data: Uint8Array) => void): Unsubscribe;
  onClose(fn: (ev: TransportCloseEvent) => void): Unsubscribe;
}

/** Minimal listener registry shared by the transport implementations. */
export class Listeners<T> {
  private fns = new Set<(v: T) => void>();
  add(fn: (v: T) => void): Unsubscribe {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const fn of [...this.fns]) fn(v);
  }
}
