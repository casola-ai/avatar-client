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

import { attachCaptions, type CaptionsController, type CaptionsOptions } from './captions';
import {
  attachSessionControls,
  type SessionControlsController,
  type SessionControlsOptions,
} from './controls';
import { attachDisclosure, type DisclosureController, type DisclosureOptions } from './disclosure';
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

const PART_CLASS: Record<SessionUIPart, string> = {
  disclosure: 'casola-session-ui__disclosure',
  controls: 'casola-session-ui__controls',
  captions: 'casola-session-ui__captions',
};

/** One controller per container: re-attaching destroys the previous one. */
const attached = new WeakMap<HTMLElement, SessionUIController>();

function optionsFor<T extends object>(value: boolean | T | undefined): T | null {
  if (value === false) return null;
  if (value === undefined || value === true) return {} as T;
  return value;
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
export function attachSessionUI(
  container: HTMLElement,
  initial: SessionUIOptions = {}
): SessionUIController {
  attached.get(container)?.destroy();

  const document = container.ownerDocument;
  let destroyed = false;
  let unbind: (() => void) | null = null;
  let liveOverride: boolean | null = null;
  let name = initial.name;
  let recording = initial.recording ?? true;

  const mount = (part: SessionUIPart): HTMLElement => {
    const el = document.createElement('div');
    el.className = PART_CLASS[part];
    container.appendChild(el);
    return el;
  };

  const disclosureOpts = optionsFor<DisclosureOptions>(initial.disclosure);
  const controlsOpts = optionsFor<SessionControlsOptions>(initial.controls);
  const captionsOpts = optionsFor<CaptionsOptions>(initial.captions);

  // Everything starts hidden: none of these mean anything before the call is on screen.
  const disclosure = disclosureOpts
    ? attachDisclosure(mount('disclosure'), {
        name,
        recording,
        visible: false,
        ...disclosureOpts,
      })
    : null;
  const controls = controlsOpts
    ? attachSessionControls(mount('controls'), {
        visible: false,
        ...controlsOpts,
        onHangup: controlsOpts.onHangup ?? initial.onHangup,
        onError: controlsOpts.onError ?? initial.onError,
      })
    : null;
  const captions = captionsOpts
    ? attachCaptions(mount('captions'), { visible: false, ...captionsOpts })
    : null;

  container.classList.add('casola-session-ui');

  const isVisible = (state: WidgetState, session: AvatarSession): boolean => {
    if (liveOverride !== null) return liveOverride;
    return initial.visibleWhen ? initial.visibleWhen(state, session) : state === 'live';
  };

  const controlsEnabled = (state: WidgetState, session: AvatarSession): boolean =>
    initial.controlsEnabledWhen
      ? initial.controlsEnabledWhen(state, session)
      : isVisible(state, session);

  const applyState = (session: AvatarSession): void => {
    if (destroyed) return;
    const state = session.state;
    const visible = isVisible(state, session);
    disclosure?.update({ visible, name, recording });
    captions?.update({ visible });
    if (!visible) captions?.clear();
    controls?.update({
      visible,
      muted: session.userMuted,
      // Held closed by the application: the button must not fight it, and must not read as
      // the user's own choice either.
      muteDisabled: session.micSuppressed || !controlsEnabled(state, session),
    });
  };

  const controller: SessionUIController = {
    disclosure,
    controls,
    captions,

    bind(session) {
      unbind?.();
      if (destroyed) return () => {};

      controls?.update({ onMutedChange: (muted) => session.setMuted(muted) });

      const offs = [
        session.on('state', () => applyState(session)),
        session.on('firstFrame', () => applyState(session)),
        session.on('micReady', () => applyState(session)),
        session.on('muteChange', () => applyState(session)),
        session.on('partial', (text) => captions?.partial(text)),
        session.on('turn', (turn) => captions?.turn(turn)),
        session.on('speechStart', (id) => captions?.speechStart(id)),
        session.on('speechEnd', (id) => captions?.speechEnd(id)),
      ];
      applyState(session);

      const off = (): void => {
        for (const remove of offs) remove();
        if (unbind === off) unbind = null;
      };
      unbind = off;
      return off;
    },

    setLive(live) {
      liveOverride = live;
    },

    update(next) {
      if (destroyed) return;
      if (next.name !== undefined) name = next.name;
      if (next.recording !== undefined) recording = next.recording;
      disclosure?.update({ name, recording });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      unbind?.();
      unbind = null;
      disclosure?.destroy();
      controls?.destroy();
      captions?.destroy();
      if (attached.get(container) === controller) attached.delete(container);
      container.replaceChildren();
      container.classList.remove('casola-session-ui');
    },
  };

  attached.set(container, controller);
  return controller;
}
