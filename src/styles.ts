/**
 * styles.ts — the default look for the SDK's DOM helpers, as a string.
 *
 * Shipped two ways from this one source: `dist/styles.css` (written by scripts/build.mjs) for
 * ordinary pages, and this export for shadow-root hosts. `<avatar-embed>` is the reason for the
 * second form — it renders into a shadow root, which a document stylesheet never reaches, so a
 * `.css` file alone would leave exactly the surface that most needs a default look without one.
 *
 * EVERY value that a themed integration is likely to change is a custom property, and the list is
 * deliberately deeper than "colours": a real integration restyles the font, the speaker label, the
 * blur, and how tall the ribbon grows before it scrolls. If those are not properties, a themed host
 * overrides most of the rules anyway and the stylesheet earns nothing.
 *
 * Set properties on the container (or `:root`) — never edit this sheet:
 *
 * ```css
 * .my-call { --casola-accent: #d7ab63; --casola-caption-font: 'Instrument Serif', serif; }
 * ```
 */

export const SESSION_UI_CSS = `
.casola-captions,
.casola-session-controls,
.casola-disclosure {
  --casola-accent: #6366f1;
  --casola-surface: rgb(8 6 4 / 0.55);
  --casola-on-surface: #fff;
  --casola-blur: 12px;
  --casola-radius: 14px;
  --casola-gap: 6px;
  --casola-font: system-ui, -apple-system, sans-serif;
}

/* ── captions ─────────────────────────────────────────────────────────────── */

.casola-captions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--casola-captions-gap, var(--casola-gap));
  font-family: var(--casola-caption-font, var(--casola-font));
  color: var(--casola-caption-color, var(--casola-on-surface));
  pointer-events: none;
}

.casola-captions[hidden] {
  display: none;
}

.casola-captions__line {
  max-width: var(--casola-caption-max-width, min(72%, 520px));
  max-height: var(--casola-caption-max-height, none);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--casola-caption-padding, 7px 13px);
  border-radius: var(--casola-caption-radius, var(--casola-radius));
  background: var(--casola-caption-bg, var(--casola-surface));
  backdrop-filter: blur(var(--casola-caption-blur, var(--casola-blur))) saturate(140%);
  -webkit-backdrop-filter: blur(var(--casola-caption-blur, var(--casola-blur))) saturate(140%);
  box-shadow: var(--casola-caption-shadow, 0 1px 12px rgb(0 0 0 / 0.28));
  font-size: var(--casola-caption-size, 15px);
  line-height: var(--casola-caption-line-height, 1.4);
  text-shadow: var(--casola-caption-text-shadow, 0 1px 3px rgb(0 0 0 / 0.45));
  text-wrap: pretty;
  transition: opacity var(--casola-fade-ms, 300ms) ease;
}

/* In-progress ASR: a fainter bubble, not a faded one — element opacity is reserved for the
   fade-out below, and stacking the two makes partial→committed jump. */
.casola-captions__line--partial {
  background: var(--casola-caption-partial-bg, rgb(8 6 4 / 0.42));
  color: var(--casola-caption-partial-color, rgb(255 255 255 / 0.82));
  font-style: italic;
}

.casola-captions__line--reply {
  color: var(--casola-caption-reply-color, color-mix(in srgb, var(--casola-accent) 35%, #fff));
  font-weight: var(--casola-caption-reply-weight, 600);
}

.casola-captions__line--note {
  color: var(--casola-caption-note-color, rgb(255 255 255 / 0.88));
  font-style: italic;
}

.casola-captions__line--fading {
  opacity: 0;
}

.casola-captions__speaker {
  display: block;
  margin-bottom: var(--casola-speaker-gap, 4px);
  color: var(--casola-speaker-color, var(--casola-accent));
  font-size: var(--casola-speaker-size, 0.66em);
  font-weight: var(--casola-speaker-weight, 600);
  letter-spacing: var(--casola-speaker-tracking, 0.14em);
  text-transform: var(--casola-speaker-transform, uppercase);
}

/* ── controls ─────────────────────────────────────────────────────────────── */

.casola-session-controls {
  display: flex;
  align-items: center;
  gap: var(--casola-controls-gap, 10px);
}

.casola-session-controls[hidden] {
  display: none;
}

.casola-session-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--casola-control-size, 40px);
  padding: var(--casola-control-padding, 0 16px);
  border: var(--casola-control-border, 1px solid rgb(255 255 255 / 0.14));
  border-radius: var(--casola-control-radius, 999px);
  background: var(--casola-control-bg, var(--casola-surface));
  color: var(--casola-control-color, var(--casola-on-surface));
  font: inherit;
  font-family: var(--casola-font);
  font-size: var(--casola-control-font-size, 14px);
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.casola-session-controls button:disabled {
  opacity: 0.55;
  cursor: default;
}

.casola-session-controls[data-muted] .casola-session-controls__mute {
  background: var(--casola-control-active-bg, color-mix(in srgb, var(--casola-accent) 30%, #000));
}

.casola-session-controls__hangup {
  background: var(--casola-hangup-bg, #e5484d);
  border-color: transparent;
}

/* ── disclosure ───────────────────────────────────────────────────────────── */

.casola-disclosure {
  display: inline-flex;
  align-items: center;
  gap: var(--casola-disclosure-gap, 6px);
  padding: var(--casola-disclosure-padding, 5px 10px);
  border-radius: var(--casola-disclosure-radius, 8px);
  background: var(--casola-disclosure-bg, rgb(0 0 0 / 0.45));
  backdrop-filter: blur(var(--casola-blur));
  -webkit-backdrop-filter: blur(var(--casola-blur));
  color: var(--casola-disclosure-color, var(--casola-on-surface));
  font-family: var(--casola-font);
  font-size: var(--casola-disclosure-size, 13px);
  font-weight: 600;
  white-space: nowrap;
}

.casola-disclosure[hidden] {
  display: none;
}

/* Red, and always beside the word REC — colour must never be the only carrier of the notice. */
.casola-disclosure__recording-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--casola-rec-color, #ff453a);
}

.casola-disclosure__recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: casola-rec-pulse 1.4s ease-in-out infinite;
}

.casola-disclosure__separator {
  opacity: 0.5;
}

@keyframes casola-rec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .casola-disclosure__recording-dot { animation: none; }
  .casola-captions__line { transition: none; }
}
`;

/**
 * Adopt the default styles into a shadow root (or document) that supports constructable
 * stylesheets, falling back to an injected `<style>`. Returns a function that removes them.
 *
 * ```ts
 * const shadow = host.attachShadow({ mode: 'open' });
 * adoptSessionUIStyles(shadow);
 * ```
 */
export function adoptSessionUIStyles(root: ShadowRoot | Document): () => void {
  const supportsConstructable =
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in root;

  if (supportsConstructable) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SESSION_UI_CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return () => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }

  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
  const style = doc.createElement('style');
  style.textContent = SESSION_UI_CSS;
  (root instanceof Document ? (root.head ?? root.body) : root).appendChild(style);
  return () => style.remove();
}
