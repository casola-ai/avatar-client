/**
 * disclosure.ts — the canonical persistent in-session disclosure: `● REC · AI · name · details`.
 *
 * The SDK owns the wording, the DOM construction, and the accessible label because the disclosure
 * is a compliance surface, not decoration: every integration must say the same thing the same way.
 * The application owns placement and presentation through the documented class hooks.
 *
 * Text is always written with `textContent`, never markup — `name` and `details` are host input.
 */
/** Options for the persistent in-session AI and recording disclosure. */
export interface DisclosureOptions {
    /** Avatar or character name shown after the required AI label. */
    name?: string;
    /** Whether this session is being recorded. Defaults to true. */
    recording?: boolean;
    /** Optional plain-text segments appended after the name. Markup is never interpreted. */
    details?: string | readonly string[];
    /** Whether the disclosure is visible. Defaults to true. */
    visible?: boolean;
}
/** Handle returned by {@link attachDisclosure}. */
export interface DisclosureController {
    /** Update any subset of the disclosure options. */
    update(options: Partial<DisclosureOptions>): void;
    /** Clear the disclosure and release this target for another attachment. */
    destroy(): void;
}
/**
 * Populate an application-owned element with the canonical persistent session disclosure:
 * `● REC · AI · name · details`. When `recording` is false, the REC segment and dot are omitted.
 *
 * The SDK owns the wording, safe DOM construction, accessibility label, and update lifecycle.
 * The application owns placement and presentation by styling the target's `casola-disclosure`
 * class and the documented child classes. Calling this again for the same target replaces the
 * previous attachment.
 */
export declare function attachDisclosure(target: HTMLElement, initial?: DisclosureOptions): DisclosureController;
