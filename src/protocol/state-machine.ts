// GENERATED from packages/avatar-protocol/src/state-machine.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
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

/** Message types legal in `handshaking`, per receiving role. */
const HANDSHAKE_OK: Record<Role, ReadonlySet<string>> = {
  server: new Set(['hello', 'ping', 'pong', 'bye']),
  client: new Set(['accept', 'error', 'session_end', 'go_away', 'ping', 'pong']),
};

/** Types that are only ever legal during handshake. */
const HANDSHAKE_ONLY: Record<Role, ReadonlySet<string>> = {
  server: new Set(['hello']),
  client: new Set(['accept']),
};

/** All known types a peer can receive, per role (mirrors messages.ts checks). */
const KNOWN: Record<Role, ReadonlySet<string>> = {
  server: new Set([
    'hello',
    'text',
    'set_langs',
    'set_response_language',
    'set_instruction',
    'playout_ack',
    'ping',
    'pong',
    'bye',
  ]),
  client: new Set([
    'accept',
    'partial',
    'turn',
    'speech_start',
    'speech_end',
    'utterance_start',
    'utterance_text',
    'utterance_end',
    'interruption',
    'instruction_set',
    'error',
    'session_end',
    'go_away',
    'ping',
    'pong',
  ]),
};

/** Receiving `type` while in `state`: what happens. */
export function onReceive(role: Role, state: ProtocolState, type: string): Transition {
  if (!KNOWN[role].has(type)) return { next: state, verdict: 'ignore' };
  switch (state) {
    case 'handshaking': {
      if (!HANDSHAKE_OK[role].has(type)) return { next: state, verdict: 'violation' };
      if (role === 'server' && type === 'hello') return { next: state, verdict: 'deliver' };
      if (role === 'client' && type === 'accept') return { next: 'active', verdict: 'deliver' };
      if (type === 'session_end' || type === 'bye') return { next: 'ending', verdict: 'deliver' };
      return { next: state, verdict: 'deliver' };
    }
    case 'active': {
      if (HANDSHAKE_ONLY[role].has(type)) return { next: state, verdict: 'violation' };
      if (type === 'session_end' || type === 'bye') return { next: 'ending', verdict: 'deliver' };
      return { next: state, verdict: 'deliver' };
    }
    case 'ending':
      // The session is over; nothing the peer says changes that. Deliverable for logging only.
      return { next: state, verdict: 'ignore' };
    case 'closed':
      return { next: state, verdict: 'ignore' };
  }
}

/** Sending `type` while in `state`: the sender's own transition. */
export function onSend(role: Role, state: ProtocolState, type: string): ProtocolState {
  if (role === 'server' && type === 'accept' && state === 'handshaking') return 'active';
  if (role === 'server' && type === 'session_end') return 'ending';
  if (role === 'client' && type === 'bye') return 'ending';
  return state;
}

/** Binary frames are legal only while `active` (media before accept has no channel map). */
export function frameVerdict(state: ProtocolState): Verdict {
  return state === 'active' ? 'deliver' : state === 'closed' ? 'ignore' : 'violation';
}
