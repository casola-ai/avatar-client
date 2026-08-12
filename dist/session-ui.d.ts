/**
 * session-ui.ts — mount the three session surfaces at once and wire them to a session.
 *
 * The helpers (`attachDisclosure`, `attachSessionControls`, `attachCaptions`) each solve one
 * problem well, and every host still had to do the same three things by hand: create them, forward
 * six callbacks into them, and decide from `WidgetState` what is visible and what is enabled.
 * That last part is where hosts quietly disagreed with each other. This does all three.
 *
 * What this deliberately does NOT do:
 *  - **Layout.** It creates one child element per part inside the container you give it and stops
 *    there. Surfaces position these very differently (a laptop mock, a modal, a 16:9 shadow root),
 *    so placement stays yours.
 *  - **Copy.** Status text, CTA labels and error messages are product wording. The only text here
 *    is the disclosure (a compliance surface, deliberately uniform) and the default control labels.
 *  - **Assume `WidgetState` is the whole truth.** `live` means the SDK reached the live state; some
 *    products define "live" differently — waiting for the first frame *and* the mic before they
 *    consider the call started. Pass `visibleWhen` / `controlsEnabledWhen` to say so, or drive it
 *    yourself with `setLive()`.
 */
import { type CaptionsController, type CaptionsOptions } from './captions';
import { type SessionControlsController, type SessionControlsOptions } from './controls';
import { type DisclosureController, type DisclosureOptions } from './disclosure';
import type { AvatarSession } from './session';
import type { WidgetState } from './state';
/** The session surface a mounted part belongs to. */
export type SessionUIPart = 'disclosure' | 'controls' | 'captions';
export interface SessionUIOptions {
    /** Avatar or character name for the disclosure. */
    name?: string;
    /** Whether this session is recorded. Defaults to true — see `attachDisclosure`. */
    recording?: boolean;
    /** Mount the disclosure. Defaults to true. */
    disclosure?: boolean | DisclosureOptions;
    /** Mount the controls. Defaults to true. Pass options to configure (e.g. `{ hangup: false }`
     *  when the product already owns a call-ending button). */
    controls?: boolean | SessionControlsOptions;
    /** Mount the captions. Defaults to true. */
    captions?: boolean | CaptionsOptions;
    /** Run the application's complete end-of-session flow. Without it the hang-up control renders
     *  disabled rather than lying about what it will do. */
    onHangup?(): void | Promise<void>;
    /** Receives errors thrown by `onHangup`. */
    onError?(error: unknown): void;
    /**
     * Which states count as "the call is on screen". Defaults to `live` only. Return `true` to show
     * the disclosure and captions.
     */
    visibleWhen?(state: WidgetState, session: AvatarSession): boolean;
    /** Which states allow the controls to be operated. Defaults to the same rule as `visibleWhen`. */
    controlsEnabledWhen?(state: WidgetState, session: AvatarSession): boolean;
}
/** Handle returned by {@link attachSessionUI}. */
export interface SessionUIController {
    /** The mounted part controllers, for anything this helper does not cover. */
    readonly disclosure: DisclosureController | null;
    readonly controls: SessionControlsController | null;
    readonly captions: CaptionsController | null;
    /** Bind to a session: subscribes to its events and drives every mounted part. Returns an
     *  unbind function. Binding a second session unbinds the first. */
    bind(session: AvatarSession): () => void;
    /**
     * Force the on-screen state instead of deriving it from `WidgetState` — for products whose
     * definition of "live" is not the SDK's (e.g. first frame AND mic ready both landed).
     * `null` returns control to the state rule.
     */
    setLive(live: boolean | null): void;
    /** Update the disclosure's name/recording without touching the rest. */
    update(options: Pick<SessionUIOptions, 'name' | 'recording'>): void;
    /** Unbind, destroy every mounted part, and empty the container. */
    destroy(): void;
}
/**
 * Mount the disclosure, controls and captions inside `container` and wire them to a session.
 *
 * ```ts
 * const ui = attachSessionUI(document.querySelector('#call'), {
 *   name: 'Mia',
 *   controls: { hangup: false },   // this product has its own end-call button
 *   onHangup: () => endCallFlow(),
 * });
 * const session = new AvatarSession({ videoEl, connect });
 * ui.bind(session);
 * session.start();
 * ```
 */
export declare function attachSessionUI(container: HTMLElement, initial?: SessionUIOptions): SessionUIController;
