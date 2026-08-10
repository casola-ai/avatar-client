export interface SessionControlLabels {
  /** Accessible and visible label while the microphone is active. */
  mute: string;
  /** Accessible and visible label while the microphone is muted. */
  unmute: string;
  /** Accessible and visible label for ending the session. */
  hangup: string;
  /** Accessible and visible label while an asynchronous hang-up is pending. */
  ending: string;
}

/** Options for SDK-rendered mute and hang-up controls. */
export interface SessionControlsOptions {
  /** Whether the controls are visible. Defaults to true. */
  visible?: boolean;
  /** Whether to render the mute control. Defaults to true. */
  mute?: boolean;
  /** Whether to render the hang-up control. Defaults to true. */
  hangup?: boolean;
  /** Current user-selected microphone state. Defaults to false. */
  muted?: boolean;
  /** Disable the mute control without hiding it. */
  muteDisabled?: boolean;
  /** Disable the hang-up control without hiding it. */
  hangupDisabled?: boolean;
  /** Show the pending hang-up state and disable both controls. */
  ending?: boolean;
  /** Accessible label for the generated control group. */
  label?: string;
  /** Optional product-specific button wording. */
  labels?: Partial<SessionControlLabels>;
  /** Apply the requested user mute state to the active session. */
  onMutedChange?(muted: boolean): void;
  /** Run the host application's complete end-of-session flow. */
  onHangup?(): void | Promise<void>;
  /** Receives callback errors after the control returns to an interactive state. */
  onError?(error: unknown): void;
}

/** Handle returned by {@link attachSessionControls}. */
export interface SessionControlsController {
  /** Update any subset of the control state or callbacks. */
  update(options: Partial<SessionControlsOptions>): void;
  /** Clear the generated controls and release the target for another attachment. */
  destroy(): void;
}

const DEFAULT_LABELS: SessionControlLabels = {
  mute: 'Mute microphone',
  unmute: 'Unmute microphone',
  hangup: 'End call',
  ending: 'Ending call…',
};

const attached = new WeakMap<HTMLElement, SessionControlsController>();

type ResolvedOptions = Required<
  Pick<
    SessionControlsOptions,
    'visible' | 'mute' | 'hangup' | 'muted' | 'muteDisabled' | 'hangupDisabled' | 'ending' | 'label'
  >
> &
  Pick<SessionControlsOptions, 'onMutedChange' | 'onHangup' | 'onError'> & {
    labels: SessionControlLabels;
  };

function resolve(initial: SessionControlsOptions): ResolvedOptions {
  return {
    visible: initial.visible ?? true,
    mute: initial.mute ?? true,
    hangup: initial.hangup ?? true,
    muted: initial.muted ?? false,
    muteDisabled: initial.muteDisabled ?? false,
    hangupDisabled: initial.hangupDisabled ?? false,
    ending: initial.ending ?? false,
    label: initial.label?.trim() || 'Call controls',
    labels: { ...DEFAULT_LABELS, ...initial.labels },
    onMutedChange: initial.onMutedChange,
    onHangup: initial.onHangup,
    onError: initial.onError,
  };
}

function buttonLabel(document: Document, className: string, text: string): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = className;
  label.textContent = text;
  return label;
}

/**
 * Populate an application-owned element with optional mute and hang-up buttons.
 *
 * The SDK owns native button semantics, accessible state, pending-state protection, safe text
 * rendering, and the update lifecycle. The host owns the actual mute and end-of-session behavior
 * through callbacks, because ending a product session can also release seats, request feedback,
 * generate a report, or finish another domain-specific flow.
 */
export function attachSessionControls(
  target: HTMLElement,
  initial: SessionControlsOptions = {}
): SessionControlsController {
  attached.get(target)?.destroy();

  let options = resolve(initial);
  let destroyed = false;

  const render = () => {
    if (destroyed) return;

    const document = target.ownerDocument;
    const children: HTMLButtonElement[] = [];

    if (options.mute) {
      const label = options.muted ? options.labels.unmute : options.labels.mute;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'casola-session-controls__mute';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(options.muted));
      button.disabled = options.ending || options.muteDisabled || !options.onMutedChange;
      button.appendChild(buttonLabel(document, 'casola-session-controls__mute-label', label));
      button.addEventListener('click', () => {
        if (destroyed || button.disabled) return;
        const previous = options.muted;
        options = { ...options, muted: !previous };
        render();
        try {
          options.onMutedChange?.(!previous);
        } catch (error) {
          options = { ...options, muted: previous };
          render();
          options.onError?.(error);
        }
      });
      children.push(button);
    }

    if (options.hangup) {
      const label = options.ending ? options.labels.ending : options.labels.hangup;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'casola-session-controls__hangup';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-busy', String(options.ending));
      button.disabled = options.ending || options.hangupDisabled || !options.onHangup;
      button.appendChild(buttonLabel(document, 'casola-session-controls__hangup-label', label));
      button.addEventListener('click', () => {
        if (destroyed || button.disabled) return;
        options = { ...options, ending: true };
        render();
        Promise.resolve()
          .then(() => options.onHangup?.())
          .catch((error) => {
            if (!destroyed) options.onError?.(error);
          })
          .finally(() => {
            if (destroyed) return;
            options = { ...options, ending: false };
            render();
          });
      });
      children.push(button);
    }

    target.replaceChildren(...children);
    target.classList.add('casola-session-controls');
    target.setAttribute('role', 'group');
    target.setAttribute('aria-label', options.label);
    target.toggleAttribute('data-muted', options.muted);
    target.toggleAttribute('data-ending', options.ending);
    target.hidden = !options.visible || children.length === 0;
  };

  const controller: SessionControlsController = {
    update(next) {
      if (destroyed) return;
      options = {
        ...options,
        ...next,
        label: next.label?.trim() || (next.label === undefined ? options.label : 'Call controls'),
        labels: next.labels ? { ...options.labels, ...next.labels } : options.labels,
      };
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attached.get(target) === controller) attached.delete(target);
      target.replaceChildren();
      target.classList.remove('casola-session-controls');
      target.removeAttribute('role');
      target.removeAttribute('aria-label');
      target.removeAttribute('data-muted');
      target.removeAttribute('data-ending');
      target.hidden = true;
    },
  };

  attached.set(target, controller);
  render();
  return controller;
}
