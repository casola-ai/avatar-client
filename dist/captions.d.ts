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
 *  - `speech_end` retimes the remaining words to finish inside `tailMs`, so the text cannot
 *    keep crawling after the voice has stopped;
 *  - a reply committed for an already-ended utterance opens straight into that tail pace.
 *
 * The SDK owns DOM construction, safe text rendering, the live-region behavior and the schedule.
 * The host owns placement and presentation through the documented class hooks, and feeds this
 * controller from its `AvatarSession` callbacks (`onPartial`, `onTurn`, `onSpeechStart`,
 * `onSpeechEnd`).
 *
 * Text is always written with `textContent`, never markup — every string here is remote input.
 */
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
    /** Window the remaining words are compressed into once the utterance has ended. Defaults
     *  to 1000. */
    tailMs?: number;
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
    /** Drop every line and cancel pending reveals, keeping the attachment. */
    clear(): void;
    /** Update any subset of the options. */
    update(options: Partial<CaptionsOptions>): void;
    /** Clear the surface and release the target for another attachment. */
    destroy(): void;
}
/**
 * Populate an application-owned element with the SDK's streaming caption surface.
 *
 * The host wires it to a session and styles it; the SDK decides what a caption line is and when
 * the reply text appears relative to the avatar's voice (see the module comment for the schedule).
 * Calling this again for the same target replaces the previous attachment.
 *
 * ```ts
 * const captions = attachCaptions(document.querySelector('#captions'), { holdMs: 2000 });
 * new AvatarSession({
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
export declare function attachCaptions(target: HTMLElement, initial?: CaptionsOptions): CaptionsController;
