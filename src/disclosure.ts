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

/** One controller per target: re-attaching destroys the previous one rather than double-rendering. */
const attached = new WeakMap<HTMLElement, DisclosureController>();

const SEPARATOR = '·';

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}

function detailsFrom(value: string | readonly string[] | undefined): string[] {
  return (typeof value === 'string' ? [value] : (value ?? []))
    .map((part) => part.trim())
    .filter(Boolean);
}

function textSpan(document: Document, className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
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
export function attachDisclosure(
  target: HTMLElement,
  initial: DisclosureOptions = {}
): DisclosureController {
  attached.get(target)?.destroy();

  let options: DisclosureOptions = {
    name: initial.name,
    recording: initial.recording ?? true,
    details: initial.details,
    visible: initial.visible ?? true,
  };
  let destroyed = false;

  const render = (): void => {
    if (destroyed) return;
    const document = target.ownerDocument;

    // Built in parallel: the visual row carries the dot (aria-hidden, colour is never the only
    // carrier) while the accessible label spells "Recording" out for assistive technology.
    const visualSegments: HTMLElement[] = [];
    const accessibleSegments: string[] = [];

    if (options.recording) {
      const recording = document.createElement('span');
      recording.className = 'casola-disclosure__recording-group';
      const dot = document.createElement('span');
      dot.className = 'casola-disclosure__recording-dot';
      dot.setAttribute('aria-hidden', 'true');
      recording.replaceChildren(dot, textSpan(document, 'casola-disclosure__recording', 'REC'));
      visualSegments.push(recording);
      accessibleSegments.push('Recording');
    }

    // The AI segment is not conditional. It is the one thing every session must disclose.
    visualSegments.push(textSpan(document, 'casola-disclosure__ai', 'AI'));
    accessibleSegments.push('AI');

    const name = clean(options.name);
    if (name) {
      visualSegments.push(textSpan(document, 'casola-disclosure__name', name));
      accessibleSegments.push(name);
    }

    for (const detail of detailsFrom(options.details)) {
      visualSegments.push(textSpan(document, 'casola-disclosure__detail', detail));
      accessibleSegments.push(detail);
    }

    const children: HTMLElement[] = [];
    for (const [index, segment] of visualSegments.entries()) {
      if (index > 0) {
        const separator = textSpan(document, 'casola-disclosure__separator', SEPARATOR);
        separator.setAttribute('aria-hidden', 'true');
        children.push(separator);
      }
      children.push(segment);
    }

    target.replaceChildren(...children);
    target.classList.add('casola-disclosure');
    // A host that hid the element before attaching must not leave it hidden from screen readers:
    // the label below is the disclosure.
    target.removeAttribute('aria-hidden');
    target.setAttribute('aria-label', accessibleSegments.join(` ${SEPARATOR} `));
    target.toggleAttribute('data-recording', options.recording);
    target.hidden = !options.visible;
  };

  const controller: DisclosureController = {
    update(next) {
      if (destroyed) return;
      options = { ...options, ...next };
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attached.get(target) === controller) attached.delete(target);
      target.replaceChildren();
      target.classList.remove('casola-disclosure');
      target.removeAttribute('aria-label');
      target.removeAttribute('data-recording');
      target.hidden = true;
    },
  };

  attached.set(target, controller);
  render();
  return controller;
}
