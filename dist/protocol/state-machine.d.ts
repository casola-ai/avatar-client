/**
 * Table-driven connection state machine. Pure: callers feed it message types and it answers with
 * the next state and what to do — it never touches a socket. `connecting` is a transport concern;
 * the protocol machine starts at `handshaking` when the socket opens.
 *
 *   handshaking → active → ending → closed
 *
 * Unknown message types are 'ignore' in every state (the must-ignore rule). A known type arriving
 * in a state where it is illegal is 'violation' — the peer is speaking the protocol wrong, and the
 * caller decides whether to drop or close (servers SHOULD close with POLICY).
 */
export type ProtocolState = 'handshaking' | 'active' | 'ending' | 'closed';
export type Role = 'client' | 'server';
export type Verdict = 'deliver' | 'ignore' | 'violation';
export interface Transition {
    next: ProtocolState;
    verdict: Verdict;
}
/** Receiving `type` while in `state`: what happens. */
export declare function onReceive(role: Role, state: ProtocolState, type: string): Transition;
/** Sending `type` while in `state`: the sender's own transition. */
export declare function onSend(role: Role, state: ProtocolState, type: string): ProtocolState;
/** Binary frames are legal only while `active` (media before accept has no channel map). */
export declare function frameVerdict(state: ProtocolState): Verdict;
