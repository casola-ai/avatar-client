/**
 * captions.ts — the canonical streaming caption surface: live ASR partials, settled user turns,
 * and the avatar's reply revealed in step with the utterance that speaks it.
 *
 * This lives in the SDK because aligning caption text to avatar speech is a *wire-semantics*
 * problem, not a styling one. Protocol v2 delivers `turn.reply` as one finished string with no
 * per-word timing, so any host rendering it verbatim either dumps the whole reply before the
 * avatar has said a word, or invents a delay constant. What the protocol does give is the
 * utterance itself: `speech_start` / `speech_end` carry a `speech_id`, and `turn.speech_id`
 * names the utterance a reply belongs to. This helper is the one place that knows how to use
 * them, so every integration gets the same alignment instead of its own guess.
 *
 * Reveal schedule:
 *  - reply held for its `speech_start` — the real audio onset — when the box marks utterances,
 *    with `startTimeoutMs` as the backstop for a marker that never lands;
 *  - never held at all when the box has sent no marker this session (nothing to wait for);
 *  - `speech_end` retimes the remaining words to finish inside the voice that is left, so the
 *    text cannot keep crawling after the speaker has stopped. That marker means the box stopped
 *    *producing* audio, not that the user stopped hearing it, so the budget is the player's own
 *    buffered voice via `remainingVoiceMs`, falling back to the fixed `tailMs` guess;
 *  - a reply committed for an already-ended utterance opens straight into that tail pace.
 *
 * The SDK owns DOM construction, safe text rendering, the live-region behavior and the schedule.
 * The host owns placement and presentation through the documented class hooks, and feeds this
 * controller from its `AvatarSession` callbacks (`onPartial`, `onTurn`, `onSpeechStart`,
 * `onSpeechEnd`).
 *
 * Text is always written with `textContent`, never markup — every string here is remote input.
 */

import type { TimedUtterance } from './utterance-scheduler';

/** A committed turn, shaped like the SDK's `Turn` so a callback can be forwarded verbatim. */
export interface CaptionTurn {
  /** Final transcript of what the user said. */
  text?: string;
  /** The avatar's reply for this turn. */
  reply?: string | null;
  /** Utterance id tying the reply to its `speech_start` / `speech_end` markers. */
  speechId?: string;
  /** BCP-47 tag for the turn; sets `lang` on the rendered lines. */
  language?: string;
  /** Assistant text is delivered by timed utterance callbacks; keep reply transcript-only. */
  timedUtterances?: boolean;
}

/** Options for the streaming caption surface. */
export interface CaptionsOptions {
  /** Whether the caption surface is visible. Defaults to true. */
  visible?: boolean;
  /** Lines kept on screen; the oldest are dropped past this. Defaults to 6. */
  maxLines?: number;
  /** How long a settled line stays before fading out. 0 (the default) keeps it until trimmed. */
  holdMs?: number;
  /** Fade-out duration after `holdMs`; the host owns the transition, this owns the removal.
   *  Defaults to 300. */
  fadeMs?: number;
  /** Reply reveal pace while the avatar is still speaking. Defaults to 160. */
  wordsPerMinute?: number;
  /** How long a reply waits for its `speech_start` before revealing anyway. Defaults to 2000. */
  startTimeoutMs?: number;
  /** Fallback window the remaining words are compressed into once the utterance has ended, used
   *  when `remainingVoiceMs` is absent or cannot answer. Defaults to 1000. */
  tailMs?: number;
  /** How much avatar voice is still queued to play, in ms — `AvatarSession.bufferedVoiceMs`.
   *
   *  `speech_end` means the box has stopped *producing* audio, not that the speaker has stopped:
   *  what is buffered is still to be heard. Supplying this spends exactly that much time on the
   *  words not yet revealed, instead of the fixed `tailMs` guess. Return `null` when the answer
   *  is unknown (no playout clock) and `tailMs` is used for that utterance.
   *
   *  Captions are usually attached before the session exists, so close over a mutable reference:
   *  `remainingVoiceMs: () => session?.bufferedVoiceMs() ?? null`. Pass `null` to unset. */
  remainingVoiceMs?: (() => number | null) | null;
}

/** A line the application authored, rather than one that came off the wire. */
export interface CaptionLineInput {
  text: string;
  /** Visual treatment. `note` (the default) is for app-authored text that is neither side's
   *  speech — a fallback, an interstitial, a written summary. */
  kind?: 'user' | 'reply' | 'note';
  /** Optional label rendered before the text (e.g. the avatar's name). */
  speaker?: string;
  /** BCP-47 tag; sets `lang` on the line. */
  language?: string;
}

/** Handle returned by {@link attachCaptions}. */
export interface CaptionsController {
  /** Show or update the in-progress ASR line (`onPartial`). */
  partial(text: string): void;
  /**
   * Write a settled line the application authored — no reveal schedule, shown at once.
   *
   * The wire is not the only source of caption text: an app may show a written fallback when a
   * spoken reply fails, an interstitial while it works, or its own framing around a turn. Without
   * this, those call sites keep their own DOM beside the ribbon and the two drift apart.
   */
  line(line: CaptionLineInput): void;
  /** Commit a turn: the user's settled line, and the reply queued against its utterance
   *  (`onTurn`). */
  turn(turn: CaptionTurn): void;
  /** The box began speaking an utterance (`onSpeechStart`). */
  speechStart(speechId: string): void;
  /** The box finished an utterance (`onSpeechEnd`). */
  speechEnd(speechId: string): void;
  /** Show a timed assistant utterance. The SDK scheduler calls this only at its media PTS. */
  utteranceStart(utterance: TimedUtterance): void;
  /** Update the currently visible text without exposing a pending utterance. */
  utteranceText(utterance: TimedUtterance): void;
  utteranceEnd(utterance: TimedUtterance): void;
  /** Drop every line and cancel pending reveals, keeping the attachment. */
  clear(): void;
  /** Update any subset of the options. */
  update(options: Partial<CaptionsOptions>): void;
  /** Clear the surface and release the target for another attachment. */
  destroy(): void;
}

type SpeechState = 'started' | 'ended';

interface Reveal {
  el: HTMLElement;
  tokens: string[];
  index: number;
  speechId: string | undefined;
  /** Set once the utterance is over: a fixed pace that spends the remaining voice on the words
   *  left at that moment. Recomputing it per word would stretch the budget instead of spending
   *  it — and would re-read a buffer that is draining as the words come out. */
  tailIntervalMs: number | null;
  /** The armed step timer, so the tail can re-time a word that is already waiting. */
  timer: ReturnType<typeof setTimeout> | null;
}

interface Waiting {
  reply: string;
  speechId: string;
  language: string | undefined;
}

/** Every optional field settled, so the render path never re-derives defaults. The supplier
 *  settles to `null` rather than to a function, so "no supplier" stays one check. */
type ResolvedOptions = Required<Omit<CaptionsOptions, 'remainingVoiceMs'>> & {
  remainingVoiceMs: (() => number | null) | null;
};

const DEFAULTS: ResolvedOptions = {
  visible: true,
  maxLines: 6,
  holdMs: 0,
  fadeMs: 300,
  wordsPerMinute: 160,
  startTimeoutMs: 2000,
  tailMs: 1000,
  remainingVoiceMs: null,
};

/** Floor on the retimed tail, so a long reply cannot schedule a timer per animation frame. */
const MIN_INTERVAL_MS = 16;
/** Utterance ids retained for late-arriving turns. Bounded: a long session sends many. */
const MAX_TRACKED_SPEECHES = 16;

const BASE_CLASS = 'casola-captions';
const LINE_CLASS = `${BASE_CLASS}__line`;

/** One controller per target: re-attaching destroys the previous one rather than double-rendering. */
const attached = new WeakMap<HTMLElement, CaptionsController>();

function resolve(base: ResolvedOptions, next: Partial<CaptionsOptions>): ResolvedOptions {
  return {
    visible: next.visible ?? base.visible,
    maxLines: Math.max(1, Math.floor(next.maxLines ?? base.maxLines)),
    holdMs: Math.max(0, next.holdMs ?? base.holdMs),
    fadeMs: Math.max(0, next.fadeMs ?? base.fadeMs),
    wordsPerMinute: Math.max(1, next.wordsPerMinute ?? base.wordsPerMinute),
    startTimeoutMs: Math.max(0, next.startTimeoutMs ?? base.startTimeoutMs),
    tailMs: Math.max(0, next.tailMs ?? base.tailMs),
    // `undefined` means "leave it alone", so an explicit `null` is the only way to unset.
    remainingVoiceMs:
      next.remainingVoiceMs === undefined ? base.remainingVoiceMs : next.remainingVoiceMs,
  };
}

/** Words with their trailing space, so a partially revealed line never loses its spacing. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

/**
 * Populate an application-owned element with the SDK's streaming caption surface.
 *
 * The host wires it to a session and styles it; the SDK decides what a caption line is and when
 * the reply text appears relative to the avatar's voice (see the module comment for the schedule).
 * Calling this again for the same target replaces the previous attachment.
 *
 * ```ts
 * let session: AvatarSession | null = null;
 * const captions = attachCaptions(document.querySelector('#captions'), {
 *   holdMs: 2000,
 *   remainingVoiceMs: () => session?.bufferedVoiceMs() ?? null,
 * });
 * session = new AvatarSession({
 *   callbacks: {
 *     onPartial: (text) => captions.partial(text),
 *     onTurn: (turn) => captions.turn(turn),
 *     onSpeechStart: (id) => captions.speechStart(id),
 *     onSpeechEnd: (id) => captions.speechEnd(id),
 *   },
 *   // …
 * });
 * ```
 *
 * Accessibility: the target becomes a polite live region (`role="log"`). A line that is still
 * arriving — the ASR partial, a reply mid-reveal — is `aria-hidden` and announces once, whole,
 * when it settles, because a word-by-word live region is unusable with a screen reader.
 */
export function attachCaptions(
  target: HTMLElement,
  initial: CaptionsOptions = {}
): CaptionsController {
  attached.get(target)?.destroy();

  let options = resolve(DEFAULTS, initial);
  let destroyed = false;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const speeches = new Map<string, SpeechState>();
  /** Whether this box marks utterances at all — decides if a reply is worth holding. */
  let marksSpeech = false;
  let partialEl: HTMLElement | null = null;
  let waiting: Waiting | null = null;
  let reveal: Reveal | null = null;
  const timedLines = new Map<string, HTMLElement>();
  let timedMode = false;

  const after = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const cancel = (id: ReturnType<typeof setTimeout> | null): void => {
    if (id === null) return;
    clearTimeout(id);
    timers.delete(id);
  };

  const line = (modifier: string, text = '', language?: string, speaker?: string): HTMLElement => {
    const doc = target.ownerDocument;
    const el = doc.createElement('div');
    el.className = `${LINE_CLASS} ${LINE_CLASS}--${modifier}`;
    if (speaker) {
      const label = doc.createElement('span');
      label.className = `${BASE_CLASS}__speaker`;
      label.textContent = speaker;
      el.appendChild(label);
      const body = doc.createElement('span');
      body.className = `${BASE_CLASS}__text`;
      body.textContent = text;
      el.appendChild(body);
    } else {
      el.textContent = text;
    }
    if (language) el.lang = language;
    // Mixed-script sessions: the box picks the reply language, so direction is per line.
    el.dir = 'auto';
    return el;
  };

  /** The node reply text is appended to — the body span when a speaker label is present. */
  const bodyOf = (el: HTMLElement): HTMLElement =>
    (el.querySelector(`.${BASE_CLASS}__text`) as HTMLElement | null) ?? el;

  const scrollToEnd = (): void => {
    target.scrollTop = target.scrollHeight;
  };

  const trim = (): void => {
    while (target.children.length > options.maxLines) {
      const oldest = target.firstElementChild;
      if (!oldest) break;
      if (oldest === partialEl) partialEl = null;
      if (oldest === reveal?.el) reveal = null;
      for (const [id, el] of timedLines) {
        if (el === oldest) timedLines.delete(id);
      }
      oldest.remove();
    }
  };

  /** A line stops being work-in-progress: announce it once, then start its optional fade. */
  const settle = (el: HTMLElement): void => {
    el.removeAttribute('aria-hidden');
    if (options.holdMs <= 0) return;
    after(options.holdMs, () => {
      el.classList.add(`${LINE_CLASS}--fading`);
      after(options.fadeMs, () => {
        if (el === partialEl) partialEl = null;
        el.remove();
      });
    });
  };

  const intervalFor = (r: Reveal): number => r.tailIntervalMs ?? 60_000 / options.wordsPerMinute;

  const step = (): void => {
    const r = reveal;
    if (!r) return;
    r.timer = null;
    bodyOf(r.el).textContent += r.tokens[r.index] ?? '';
    r.index += 1;
    scrollToEnd();
    if (r.index < r.tokens.length) {
      r.timer = after(intervalFor(r), step);
      return;
    }
    reveal = null;
    settle(r.el);
  };

  /** How long the words still queued should take. The voice actually left in the player when the
   *  host supplies a reading, and the fixed `tailMs` guess when it does not — including when the
   *  supplier throws or answers with something that is not a duration, because a caption helper
   *  is not the place for a host bug to become an unhandled error. */
  const tailBudgetMs = (): number => {
    const read = options.remainingVoiceMs;
    if (!read) return options.tailMs;
    let ms: number | null;
    try {
      ms = read();
    } catch {
      return options.tailMs;
    }
    return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : options.tailMs;
  };

  /** The voice has stopped being *produced*: spend what is left of it on the words still queued,
   *  and re-time the word already waiting — it was armed at the slower speaking pace. */
  const enterTail = (r: Reveal): void => {
    if (r.tailIntervalMs !== null) return;
    const remaining = Math.max(1, r.tokens.length - r.index);
    r.tailIntervalMs = Math.max(MIN_INTERVAL_MS, tailBudgetMs() / remaining);
    if (r.timer === null) return;
    cancel(r.timer);
    r.timer = after(r.tailIntervalMs, step);
  };

  /** Write out whatever is left of the current reveal at once — the avatar has moved on. */
  const finishReveal = (): void => {
    const r = reveal;
    if (!r) return;
    reveal = null;
    cancel(r.timer);
    r.timer = null;
    bodyOf(r.el).textContent += r.tokens.slice(r.index).join('');
    settle(r.el);
  };

  const startReveal = (
    replyText: string,
    speechId: string | undefined,
    language: string | undefined,
    tail: boolean
  ): void => {
    const tokens = tokenize(replyText);
    const el = line('reply', tokens[0] ?? '', language);
    // Announced whole by settle(); a live region fed word by word is noise.
    el.setAttribute('aria-hidden', 'true');
    target.appendChild(el);
    const r: Reveal = { el, tokens, index: 1, speechId, tailIntervalMs: null, timer: null };
    reveal = r;
    trim();
    scrollToEnd();
    if (r.index >= tokens.length) {
      reveal = null;
      settle(el);
      return;
    }
    if (tail) enterTail(r);
    if (r.timer === null) r.timer = after(intervalFor(r), step);
  };

  const startWaiting = (): void => {
    const pending = waiting;
    if (!pending) return;
    waiting = null;
    startReveal(
      pending.reply,
      pending.speechId,
      pending.language,
      speeches.get(pending.speechId) === 'ended'
    );
  };

  const remember = (speechId: string, state: SpeechState): void => {
    marksSpeech = true;
    speeches.delete(speechId);
    speeches.set(speechId, state);
    while (speeches.size > MAX_TRACKED_SPEECHES) {
      const oldest = speeches.keys().next();
      if (oldest.done) break;
      speeches.delete(oldest.value);
    }
  };

  const cancelPending = (): void => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    waiting = null;
    reveal = null;
  };

  const render = (): void => {
    target.classList.add(BASE_CLASS);
    target.setAttribute('role', 'log');
    target.setAttribute('aria-live', 'polite');
    target.setAttribute('aria-atomic', 'false');
    target.hidden = !options.visible;
  };

  const controller: CaptionsController = {
    partial(text) {
      if (destroyed) return;
      const value = text.trim();
      if (!value) return;
      if (!partialEl) {
        partialEl = line('partial');
        // In-progress ASR: revised on nearly every frame, so kept out of the live region until
        // the turn commits it.
        partialEl.setAttribute('aria-hidden', 'true');
        target.appendChild(partialEl);
      }
      partialEl.textContent = value;
      trim();
      scrollToEnd();
    },

    line(input) {
      if (destroyed) return;
      const text = input.text?.trim() ?? '';
      if (!text) return;
      const el = line(input.kind ?? 'note', text, input.language, input.speaker);
      target.appendChild(el);
      settle(el);
      trim();
      scrollToEnd();
    },

    turn(turn) {
      if (destroyed) return;
      if (partialEl) {
        partialEl.remove();
        partialEl = null;
      }
      const text = turn.text?.trim() ?? '';
      if (text) {
        const el = line('user', text, turn.language);
        target.appendChild(el);
        settle(el);
      }
      const reply = turn.reply?.trim() ?? '';
      if (turn.timedUtterances) timedMode = true;
      if (reply && !timedMode) {
        // An earlier reply still crawling is finished on the spot rather than interleaved.
        finishReveal();
        const state = turn.speechId ? speeches.get(turn.speechId) : undefined;
        if (state === undefined && turn.speechId && marksSpeech) {
          // The reply text beat its audio here. Hold it for the real onset instead of guessing a
          // delay — with a backstop, because a box may drop the marker.
          waiting = { reply, speechId: turn.speechId, language: turn.language };
          const held = turn.speechId;
          after(options.startTimeoutMs, () => {
            if (waiting?.speechId === held) startWaiting();
          });
        } else {
          startReveal(reply, turn.speechId, turn.language, state === 'ended');
        }
      }
      trim();
      scrollToEnd();
    },

    speechStart(speechId) {
      if (destroyed || !speechId) return;
      remember(speechId, 'started');
      if (waiting?.speechId === speechId) startWaiting();
    },

    speechEnd(speechId) {
      if (destroyed || !speechId) return;
      remember(speechId, 'ended');
      if (waiting?.speechId === speechId) {
        startWaiting();
        return;
      }
      // Mid-reveal: the voice has stopped, so the words left cannot keep their speaking pace.
      if (reveal?.speechId === speechId) enterTail(reveal);
    },

    utteranceStart(utterance) {
      if (destroyed || !utterance.utteranceId) return;
      timedMode = true;
      waiting = null;
      finishReveal();
      const existing = timedLines.get(utterance.utteranceId);
      existing?.remove();
      const text = utterance.text?.trim() ?? '';
      const el = line('reply', text, utterance.language);
      if (!text) el.setAttribute('aria-hidden', 'true');
      target.appendChild(el);
      timedLines.set(utterance.utteranceId, el);
      trim();
      scrollToEnd();
    },

    utteranceText(utterance) {
      if (destroyed) return;
      const el = timedLines.get(utterance.utteranceId);
      if (!el) return;
      bodyOf(el).textContent = utterance.text ?? '';
      if (utterance.language) el.lang = utterance.language;
      if (utterance.text) el.removeAttribute('aria-hidden');
      scrollToEnd();
    },

    utteranceEnd(utterance) {
      if (destroyed) return;
      const el = timedLines.get(utterance.utteranceId);
      if (!el) return;
      timedLines.delete(utterance.utteranceId);
      settle(el);
    },

    clear() {
      if (destroyed) return;
      cancelPending();
      partialEl = null;
      timedLines.clear();
      target.replaceChildren();
    },

    update(next) {
      if (destroyed) return;
      options = resolve(options, next);
      render();
      trim();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPending();
      partialEl = null;
      timedLines.clear();
      if (attached.get(target) === controller) attached.delete(target);
      target.replaceChildren();
      target.classList.remove(BASE_CLASS);
      target.removeAttribute('role');
      target.removeAttribute('aria-live');
      target.removeAttribute('aria-atomic');
      target.hidden = true;
    },
  };

  attached.set(target, controller);
  render();
  return controller;
}
