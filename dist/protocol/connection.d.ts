import { type MediaFrame } from './frames';
import { type ClientMessage, type ServerMessage } from './messages';
import { type ProtocolState } from './state-machine';
import type { Transport, TransportCloseEvent, Unsubscribe } from './transport';
/**
 * The protocol layer bound to a Transport: demuxes text frames into parsed control messages and
 * binary frames into MediaFrames, drives the connection state machine, and (server side) stamps
 * the monotonic `seq` on outgoing control messages. This is the seam both the fallback box and
 * test clients share; it owns no I/O beyond the Transport it is given.
 */
export interface ProtocolViolation {
    kind: 'illegal_message' | 'illegal_frame' | 'bad_frame' | 'sequence_violation';
    detail: string;
    state: ProtocolState;
}
interface ConnectionBase {
    readonly protocolState: ProtocolState;
    sendFrame(frame: MediaFrame): void;
    onFrame(fn: (f: MediaFrame) => void): Unsubscribe;
    onClose(fn: (ev: TransportCloseEvent) => void): Unsubscribe;
    onViolation(fn: (v: ProtocolViolation) => void): Unsubscribe;
    close(code?: number, reason?: string): void;
}
export interface ClientConnection extends ConnectionBase {
    send(msg: ClientMessage): void;
    onMessage(fn: (m: ServerMessage) => void): Unsubscribe;
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Server messages are authored without `seq`; the connection stamps it at send. */
export type UnsequencedServerMessage = Exclude<ServerMessage, {
    seq: number;
}> | DistributiveOmit<Extract<ServerMessage, {
    seq: number;
}>, 'seq'>;
export interface ServerConnection extends ConnectionBase {
    send(msg: UnsequencedServerMessage): void;
    onMessage(fn: (m: ClientMessage) => void): Unsubscribe;
}
export declare function clientProtocolConnection(transport: Transport): ClientConnection;
export declare function serverProtocolConnection(transport: Transport): ServerConnection;
export {};
