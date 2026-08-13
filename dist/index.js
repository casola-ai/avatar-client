var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/captions.ts
var DEFAULTS = {
  visible: true,
  maxLines: 6,
  holdMs: 0,
  fadeMs: 300,
  wordsPerMinute: 160,
  startTimeoutMs: 2e3,
  tailMs: 1e3,
  remainingVoiceMs: null
};
var MIN_INTERVAL_MS = 16;
var MAX_TRACKED_SPEECHES = 16;
var BASE_CLASS = "casola-captions";
var LINE_CLASS = `${BASE_CLASS}__line`;
var attached = /* @__PURE__ */ new WeakMap();
function resolve(base, next) {
  return {
    visible: next.visible ?? base.visible,
    maxLines: Math.max(1, Math.floor(next.maxLines ?? base.maxLines)),
    holdMs: Math.max(0, next.holdMs ?? base.holdMs),
    fadeMs: Math.max(0, next.fadeMs ?? base.fadeMs),
    wordsPerMinute: Math.max(1, next.wordsPerMinute ?? base.wordsPerMinute),
    startTimeoutMs: Math.max(0, next.startTimeoutMs ?? base.startTimeoutMs),
    tailMs: Math.max(0, next.tailMs ?? base.tailMs),
    // `undefined` means "leave it alone", so an explicit `null` is the only way to unset.
    remainingVoiceMs: next.remainingVoiceMs === void 0 ? base.remainingVoiceMs : next.remainingVoiceMs
  };
}
function tokenize(text) {
  return text.match(/\S+\s*/g) ?? [text];
}
function attachCaptions(target, initial = {}) {
  attached.get(target)?.destroy();
  let options = resolve(DEFAULTS, initial);
  let destroyed = false;
  const timers = /* @__PURE__ */ new Set();
  const speeches = /* @__PURE__ */ new Map();
  let marksSpeech = false;
  let partialEl = null;
  let waiting = null;
  let reveal = null;
  const timedLines = /* @__PURE__ */ new Map();
  let timedMode = false;
  const after = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    if (id === null) return;
    clearTimeout(id);
    timers.delete(id);
  };
  const line = (modifier, text = "", language, speaker) => {
    const doc = target.ownerDocument;
    const el = doc.createElement("div");
    el.className = `${LINE_CLASS} ${LINE_CLASS}--${modifier}`;
    if (speaker) {
      const label = doc.createElement("span");
      label.className = `${BASE_CLASS}__speaker`;
      label.textContent = speaker;
      el.appendChild(label);
      const body = doc.createElement("span");
      body.className = `${BASE_CLASS}__text`;
      body.textContent = text;
      el.appendChild(body);
    } else {
      el.textContent = text;
    }
    if (language) el.lang = language;
    el.dir = "auto";
    return el;
  };
  const bodyOf = (el) => el.querySelector(`.${BASE_CLASS}__text`) ?? el;
  const scrollToEnd = () => {
    target.scrollTop = target.scrollHeight;
  };
  const trim = () => {
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
  const settle = (el) => {
    el.removeAttribute("aria-hidden");
    if (options.holdMs <= 0) return;
    after(options.holdMs, () => {
      el.classList.add(`${LINE_CLASS}--fading`);
      after(options.fadeMs, () => {
        if (el === partialEl) partialEl = null;
        el.remove();
      });
    });
  };
  const intervalFor = (r) => r.tailIntervalMs ?? 6e4 / options.wordsPerMinute;
  const step = () => {
    const r = reveal;
    if (!r) return;
    r.timer = null;
    bodyOf(r.el).textContent += r.tokens[r.index] ?? "";
    r.index += 1;
    scrollToEnd();
    if (r.index < r.tokens.length) {
      r.timer = after(intervalFor(r), step);
      return;
    }
    reveal = null;
    settle(r.el);
  };
  const tailBudgetMs = () => {
    const read = options.remainingVoiceMs;
    if (!read) return options.tailMs;
    let ms;
    try {
      ms = read();
    } catch {
      return options.tailMs;
    }
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : options.tailMs;
  };
  const enterTail = (r) => {
    if (r.tailIntervalMs !== null) return;
    const remaining = Math.max(1, r.tokens.length - r.index);
    r.tailIntervalMs = Math.max(MIN_INTERVAL_MS, tailBudgetMs() / remaining);
    if (r.timer === null) return;
    cancel(r.timer);
    r.timer = after(r.tailIntervalMs, step);
  };
  const finishReveal = () => {
    const r = reveal;
    if (!r) return;
    reveal = null;
    cancel(r.timer);
    r.timer = null;
    bodyOf(r.el).textContent += r.tokens.slice(r.index).join("");
    settle(r.el);
  };
  const startReveal = (replyText, speechId, language, tail) => {
    const tokens = tokenize(replyText);
    const el = line("reply", tokens[0] ?? "", language);
    el.setAttribute("aria-hidden", "true");
    target.appendChild(el);
    const r = { el, tokens, index: 1, speechId, tailIntervalMs: null, timer: null };
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
  const startWaiting = () => {
    const pending = waiting;
    if (!pending) return;
    waiting = null;
    startReveal(
      pending.reply,
      pending.speechId,
      pending.language,
      speeches.get(pending.speechId) === "ended"
    );
  };
  const remember = (speechId, state) => {
    marksSpeech = true;
    speeches.delete(speechId);
    speeches.set(speechId, state);
    while (speeches.size > MAX_TRACKED_SPEECHES) {
      const oldest = speeches.keys().next();
      if (oldest.done) break;
      speeches.delete(oldest.value);
    }
  };
  const cancelPending = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    waiting = null;
    reveal = null;
  };
  const render = () => {
    target.classList.add(BASE_CLASS);
    target.setAttribute("role", "log");
    target.setAttribute("aria-live", "polite");
    target.setAttribute("aria-atomic", "false");
    target.hidden = !options.visible;
  };
  const controller = {
    partial(text) {
      if (destroyed) return;
      const value = text.trim();
      if (!value) return;
      if (!partialEl) {
        partialEl = line("partial");
        partialEl.setAttribute("aria-hidden", "true");
        target.appendChild(partialEl);
      }
      partialEl.textContent = value;
      trim();
      scrollToEnd();
    },
    line(input) {
      if (destroyed) return;
      const text = input.text?.trim() ?? "";
      if (!text) return;
      const el = line(input.kind ?? "note", text, input.language, input.speaker);
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
      const text = turn.text?.trim() ?? "";
      if (text) {
        const el = line("user", text, turn.language);
        target.appendChild(el);
        settle(el);
      }
      const reply = turn.reply?.trim() ?? "";
      if (turn.timedUtterances) timedMode = true;
      if (reply && !timedMode) {
        finishReveal();
        const state = turn.speechId ? speeches.get(turn.speechId) : void 0;
        if (state === void 0 && turn.speechId && marksSpeech) {
          waiting = { reply, speechId: turn.speechId, language: turn.language };
          const held = turn.speechId;
          after(options.startTimeoutMs, () => {
            if (waiting?.speechId === held) startWaiting();
          });
        } else {
          startReveal(reply, turn.speechId, turn.language, state === "ended");
        }
      }
      trim();
      scrollToEnd();
    },
    speechStart(speechId) {
      if (destroyed || !speechId) return;
      remember(speechId, "started");
      if (waiting?.speechId === speechId) startWaiting();
    },
    speechEnd(speechId) {
      if (destroyed || !speechId) return;
      remember(speechId, "ended");
      if (waiting?.speechId === speechId) {
        startWaiting();
        return;
      }
      if (reveal?.speechId === speechId) enterTail(reveal);
    },
    utteranceStart(utterance) {
      if (destroyed || !utterance.utteranceId) return;
      timedMode = true;
      waiting = null;
      finishReveal();
      const existing = timedLines.get(utterance.utteranceId);
      existing?.remove();
      const text = utterance.text?.trim() ?? "";
      const el = line("reply", text, utterance.language);
      if (!text) el.setAttribute("aria-hidden", "true");
      target.appendChild(el);
      timedLines.set(utterance.utteranceId, el);
      trim();
      scrollToEnd();
    },
    utteranceText(utterance) {
      if (destroyed) return;
      const el = timedLines.get(utterance.utteranceId);
      if (!el) return;
      bodyOf(el).textContent = utterance.text ?? "";
      if (utterance.language) el.lang = utterance.language;
      if (utterance.text) el.removeAttribute("aria-hidden");
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
      target.removeAttribute("role");
      target.removeAttribute("aria-live");
      target.removeAttribute("aria-atomic");
      target.hidden = true;
    }
  };
  attached.set(target, controller);
  render();
  return controller;
}

// src/connect/token.ts
function connectViaToken(o) {
  const u = new URL("/v2/session", o.connectUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (o.sessionToken) u.searchParams.set("token", o.sessionToken);
  const sessionWsUrl = u.toString();
  return {
    connect(h) {
      h.onReady({ sessionWsUrl, sessionCapSeconds: o.sessionCapSeconds });
    },
    close() {
    }
  };
}

// src/controls.ts
var DEFAULT_LABELS = {
  mute: "Mute microphone",
  unmute: "Unmute microphone",
  hangup: "End call",
  ending: "Ending call\u2026"
};
var DEFAULT_GROUP_LABEL = "Call controls";
var attached2 = /* @__PURE__ */ new WeakMap();
function resolve2(initial) {
  return {
    visible: initial.visible ?? true,
    mute: initial.mute ?? true,
    hangup: initial.hangup ?? true,
    muted: initial.muted ?? false,
    muteDisabled: initial.muteDisabled ?? false,
    hangupDisabled: initial.hangupDisabled ?? false,
    ending: initial.ending ?? false,
    label: initial.label?.trim() || DEFAULT_GROUP_LABEL,
    labels: { ...DEFAULT_LABELS, ...initial.labels },
    onMutedChange: initial.onMutedChange,
    onHangup: initial.onHangup,
    onError: initial.onError
  };
}
function buttonLabel(document2, className, text) {
  const label = document2.createElement("span");
  label.className = className;
  label.textContent = text;
  return label;
}
function attachSessionControls(target, initial = {}) {
  attached2.get(target)?.destroy();
  let options = resolve2(initial);
  let destroyed = false;
  const render = () => {
    if (destroyed) return;
    const document2 = target.ownerDocument;
    const children = [];
    if (options.mute) {
      const label = options.muted ? options.labels.unmute : options.labels.mute;
      const button = document2.createElement("button");
      button.type = "button";
      button.className = "casola-session-controls__mute";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(options.muted));
      button.disabled = options.ending || options.muteDisabled || !options.onMutedChange;
      button.appendChild(buttonLabel(document2, "casola-session-controls__mute-label", label));
      button.addEventListener("click", () => {
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
      const button = document2.createElement("button");
      button.type = "button";
      button.className = "casola-session-controls__hangup";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-busy", String(options.ending));
      button.disabled = options.ending || options.hangupDisabled || !options.onHangup;
      button.appendChild(buttonLabel(document2, "casola-session-controls__hangup-label", label));
      button.addEventListener("click", () => {
        if (destroyed || button.disabled) return;
        options = { ...options, ending: true };
        render();
        Promise.resolve().then(() => options.onHangup?.()).catch((error) => {
          if (!destroyed) options.onError?.(error);
        }).finally(() => {
          if (destroyed) return;
          options = { ...options, ending: false };
          render();
        });
      });
      children.push(button);
    }
    target.replaceChildren(...children);
    target.classList.add("casola-session-controls");
    target.setAttribute("role", "group");
    target.setAttribute("aria-label", options.label);
    target.toggleAttribute("data-muted", options.muted);
    target.toggleAttribute("data-ending", options.ending);
    target.hidden = !options.visible || children.length === 0;
  };
  const controller = {
    update(next) {
      if (destroyed) return;
      options = {
        ...options,
        ...next,
        // An omitted `label` keeps the current one; an explicitly blank one resets to the default,
        // so the group is never left without an accessible name.
        label: next.label?.trim() || (next.label === void 0 ? options.label : DEFAULT_GROUP_LABEL),
        labels: next.labels ? { ...options.labels, ...next.labels } : options.labels
      };
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attached2.get(target) === controller) attached2.delete(target);
      target.replaceChildren();
      target.classList.remove("casola-session-controls");
      target.removeAttribute("role");
      target.removeAttribute("aria-label");
      target.removeAttribute("data-muted");
      target.removeAttribute("data-ending");
      target.hidden = true;
    }
  };
  attached2.set(target, controller);
  render();
  return controller;
}

// src/disclosure.ts
var attached3 = /* @__PURE__ */ new WeakMap();
var SEPARATOR = "\xB7";
function clean(value) {
  return value?.trim() ?? "";
}
function detailsFrom(value) {
  return (typeof value === "string" ? [value] : value ?? []).map((part) => part.trim()).filter(Boolean);
}
function textSpan(document2, className, text) {
  const span = document2.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}
function attachDisclosure(target, initial = {}) {
  attached3.get(target)?.destroy();
  let options = {
    name: initial.name,
    recording: initial.recording ?? true,
    details: initial.details,
    visible: initial.visible ?? true
  };
  let destroyed = false;
  const render = () => {
    if (destroyed) return;
    const document2 = target.ownerDocument;
    const visualSegments = [];
    const accessibleSegments = [];
    if (options.recording) {
      const recording = document2.createElement("span");
      recording.className = "casola-disclosure__recording-group";
      const dot = document2.createElement("span");
      dot.className = "casola-disclosure__recording-dot";
      dot.setAttribute("aria-hidden", "true");
      recording.replaceChildren(dot, textSpan(document2, "casola-disclosure__recording", "REC"));
      visualSegments.push(recording);
      accessibleSegments.push("Recording");
    }
    visualSegments.push(textSpan(document2, "casola-disclosure__ai", "AI"));
    accessibleSegments.push("AI");
    const name = clean(options.name);
    if (name) {
      visualSegments.push(textSpan(document2, "casola-disclosure__name", name));
      accessibleSegments.push(name);
    }
    for (const detail of detailsFrom(options.details)) {
      visualSegments.push(textSpan(document2, "casola-disclosure__detail", detail));
      accessibleSegments.push(detail);
    }
    const children = [];
    for (const [index, segment] of visualSegments.entries()) {
      if (index > 0) {
        const separator = textSpan(document2, "casola-disclosure__separator", SEPARATOR);
        separator.setAttribute("aria-hidden", "true");
        children.push(separator);
      }
      children.push(segment);
    }
    target.replaceChildren(...children);
    target.classList.add("casola-disclosure");
    target.removeAttribute("aria-hidden");
    target.setAttribute("aria-label", accessibleSegments.join(` ${SEPARATOR} `));
    target.toggleAttribute("data-recording", options.recording);
    target.hidden = !options.visible;
  };
  const controller = {
    update(next) {
      if (destroyed) return;
      options = { ...options, ...next };
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attached3.get(target) === controller) attached3.delete(target);
      target.replaceChildren();
      target.classList.remove("casola-disclosure");
      target.removeAttribute("aria-label");
      target.removeAttribute("data-recording");
      target.hidden = true;
    }
  };
  attached3.set(target, controller);
  render();
  return controller;
}

// src/errors.ts
var AvatarError = class extends Error {
  constructor(kind, message, options = {}) {
    super(message);
    __publicField(this, "kind");
    /** `false` when the session is still running and this is a degradation, not an ending. */
    __publicField(this, "terminal");
    this.name = "AvatarError";
    this.kind = kind;
    this.terminal = options.terminal ?? true;
    if (options.cause !== void 0) this.cause = options.cause;
  }
};
function isMicError(error) {
  return error instanceof AvatarError && (error.kind === "mic-permission" || error.kind === "mic-unavailable" || error.kind === "mic-failed");
}
function classifyMicError(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "mic-permission";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "mic-unavailable";
  if (name === "NotSupportedError") return "unsupported-browser";
  return "mic-failed";
}
function toAvatarError(error, kind, options = {}) {
  if (error instanceof AvatarError) return error;
  const message = options.message ?? (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));
  return new AvatarError(kind, message, { terminal: options.terminal, cause: error });
}

// src/protocol/codes.ts
var SUBPROTOCOL = "casola.avatar.v2";
var CloseCode = {
  NORMAL: 1e3,
  UNAUTHORIZED: 4001,
  PROTOCOL_MISMATCH: 4002,
  PERSONA_UNRESOLVABLE: 4003,
  CAPACITY: 4004,
  POLICY: 4008
};

// src/protocol/frames.ts
var FRAME_HEADER_BYTES = 16;
var FrameType = {
  /** Codec initialization payload for the channel (e.g. fMP4 ftyp+moov). */
  MEDIA_INIT: 1,
  /** Media payload (fMP4 segment, PCM slice, data blob). */
  MEDIA: 2
};
var FrameFlags = {
  /** Payload starts a keyframe-aligned group (video). */
  KEYFRAME: 1,
  /** Payload begins a complete codec unit (init segment, fMP4 segment, or PCM unit). */
  UNIT_START: 2,
  /** Payload ends a complete codec unit. A one-frame unit carries UNIT_START | UNIT_END. */
  UNIT_END: 4
};
var MAX_SEQ = 4294967295;
var MAX_PTS = BigInt(Number.MAX_SAFE_INTEGER);
function checkRange(name, value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`frame ${name} out of range: ${value}`);
  }
}
function encodeFrame(frame) {
  checkRange("frame_type", frame.frameType, 255);
  checkRange("channel_id", frame.channelId, 255);
  checkRange("flags", frame.flags, 65535);
  checkRange("seq", frame.seq, MAX_SEQ);
  if (!Number.isSafeInteger(frame.ptsUs) || frame.ptsUs < 0) {
    throw new RangeError(`frame pts_us out of range: ${frame.ptsUs}`);
  }
  const out = new Uint8Array(FRAME_HEADER_BYTES + frame.payload.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, frame.frameType);
  dv.setUint8(1, frame.channelId);
  dv.setUint16(2, frame.flags, true);
  dv.setUint32(4, frame.seq, true);
  dv.setBigUint64(8, BigInt(frame.ptsUs), true);
  out.set(frame.payload, FRAME_HEADER_BYTES);
  return out;
}
function decodeFrame(bytes) {
  if (bytes.byteLength < FRAME_HEADER_BYTES) {
    throw new RangeError(`frame shorter than header: ${bytes.byteLength} bytes`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pts = dv.getBigUint64(8, true);
  if (pts > MAX_PTS) {
    throw new RangeError(`frame pts_us exceeds safe integer range: ${pts}`);
  }
  return {
    frameType: dv.getUint8(0),
    channelId: dv.getUint8(1),
    flags: dv.getUint16(2, true),
    seq: dv.getUint32(4, true),
    ptsUs: Number(pts),
    payload: bytes.subarray(FRAME_HEADER_BYTES)
  };
}

// src/protocol/messages.ts
var isStr = (v) => typeof v === "string";
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isStrArray = (v) => Array.isArray(v) && v.every(isStr);
var isBool = (v) => typeof v === "boolean";
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isUInt = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
var isSeq = (v) => Number.isSafeInteger(v) && Number(v) >= 1;
var has = (m, key) => Object.hasOwn(m, key);
var optional = (m, key, check) => !has(m, key) || check(m[key]);
var oneOf = (...values) => (v) => isStr(v) && values.includes(v);
var isChannel = (v) => {
  if (!isObj(v) || !isUInt(v.id) || v.id > 255) return false;
  if (v.dir !== "up" && v.dir !== "down") return false;
  if (v.kind === "audio") {
    return v.codec === "pcm16" && isUInt(v.sample_rate) && v.sample_rate > 0 && v.channels === 1;
  }
  if (v.kind === "video") {
    return v.dir === "down" && v.codec === "fmp4" && isStr(v.mime) && optional(v, "fps", (x) => isNum(x) && Number(x) > 0) && optional(v, "seg_frames", (x) => isUInt(x) && Number(x) > 0);
  }
  return v.kind === "data" && v.codec === "binary";
};
var SERVER_CHECKS = {
  accept: (m) => isSeq(m.seq) && m.proto === 2 && isStr(m.persona_key) && isNum(m.cap_seconds) && m.cap_seconds >= 0 && Array.isArray(m.channels) && m.channels.every(isChannel) && optional(m, "features", isStrArray) && m.resume === null && optional(m, "poster", (v) => isObj(v) && isStr(v.url)),
  partial: (m) => isSeq(m.seq) && isStr(m.text) && optional(m, "language", isStr),
  turn: (m) => isSeq(m.seq) && isStr(m.text) && has(m, "reply") && (m.reply === null || isStr(m.reply)) && optional(m, "speech_id", isStr) && optional(m, "request_id", isStr) && optional(m, "language", isStr),
  speech_start: (m) => isSeq(m.seq) && isStr(m.speech_id),
  speech_end: (m) => isSeq(m.seq) && isStr(m.speech_id),
  utterance_start: (m) => isSeq(m.seq) && isStr(m.turn_id) && isStr(m.utterance_id) && isUInt(m.start_pts_us) && isBool(m.text_final) && optional(m, "text", isStr) && optional(m, "language", isStr),
  utterance_text: (m) => isSeq(m.seq) && isStr(m.turn_id) && isStr(m.utterance_id) && isUInt(m.revision) && isStr(m.text) && isBool(m.final),
  utterance_end: (m) => isSeq(m.seq) && isStr(m.turn_id) && isStr(m.utterance_id) && isUInt(m.end_pts_us) && oneOf("complete", "interrupted", "replaced", "error")(m.reason),
  interruption: (m) => {
    if (!isSeq(m.seq) || !(m.cutoff_pts_us === null || isUInt(m.cutoff_pts_us))) return false;
    const hasIds = has(m, "utterance_ids");
    const hasReason = has(m, "reason");
    if (!hasIds && !hasReason) return true;
    return m.cutoff_pts_us !== null && hasIds && isStrArray(m.utterance_ids) && hasReason && m.reason === "barge_in";
  },
  instruction_set: (m) => isSeq(m.seq) && optional(m, "request_id", isStr),
  error: (m) => isSeq(m.seq) && isStr(m.code) && optional(m, "message", isStr) && optional(m, "request_id", isStr),
  session_end: (m) => isSeq(m.seq) && isStr(m.reason),
  go_away: (m) => isSeq(m.seq) && optional(m, "deadline_s", isNum),
  ping: (m) => isNum(m.t),
  pong: (m) => isNum(m.t)
};
function parse(text, checks) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "not_an_object" };
  }
  const m = raw;
  if (!isStr(m.type)) return { ok: false, error: "missing_type" };
  const check = checks[m.type];
  if (!check) return { ok: "unknown", raw: m };
  if (!check(m)) return { ok: false, error: `invalid_${m.type}` };
  return { ok: true, msg: m };
}
function parseServerMessage(text) {
  return parse(text, SERVER_CHECKS);
}

// src/protocol/state-machine.ts
var HANDSHAKE_OK = {
  server: /* @__PURE__ */ new Set(["hello", "ping", "pong", "bye"]),
  client: /* @__PURE__ */ new Set(["accept", "error", "session_end", "go_away", "ping", "pong"])
};
var HANDSHAKE_ONLY = {
  server: /* @__PURE__ */ new Set(["hello"]),
  client: /* @__PURE__ */ new Set(["accept"])
};
var KNOWN = {
  server: /* @__PURE__ */ new Set([
    "hello",
    "text",
    "set_langs",
    "set_response_language",
    "set_instruction",
    "playout_ack",
    "ping",
    "pong",
    "bye"
  ]),
  client: /* @__PURE__ */ new Set([
    "accept",
    "partial",
    "turn",
    "speech_start",
    "speech_end",
    "utterance_start",
    "utterance_text",
    "utterance_end",
    "interruption",
    "instruction_set",
    "error",
    "session_end",
    "go_away",
    "ping",
    "pong"
  ])
};
function onReceive(role, state, type) {
  if (!KNOWN[role].has(type)) return { next: state, verdict: "ignore" };
  switch (state) {
    case "handshaking": {
      if (!HANDSHAKE_OK[role].has(type)) return { next: state, verdict: "violation" };
      if (role === "server" && type === "hello") return { next: state, verdict: "deliver" };
      if (role === "client" && type === "accept") return { next: "active", verdict: "deliver" };
      if (type === "session_end" || type === "bye") return { next: "ending", verdict: "deliver" };
      return { next: state, verdict: "deliver" };
    }
    case "active": {
      if (HANDSHAKE_ONLY[role].has(type)) return { next: state, verdict: "violation" };
      if (type === "session_end" || type === "bye") return { next: "ending", verdict: "deliver" };
      return { next: state, verdict: "deliver" };
    }
    case "ending":
      return { next: state, verdict: "ignore" };
    case "closed":
      return { next: state, verdict: "ignore" };
  }
}
function onSend(role, state, type) {
  if (role === "server" && type === "accept" && state === "handshaking") return "active";
  if (role === "server" && type === "session_end") return "ending";
  if (role === "client" && type === "bye") return "ending";
  return state;
}
function frameVerdict(state) {
  return state === "active" ? "deliver" : state === "closed" ? "ignore" : "violation";
}

// src/protocol/transport.ts
var Listeners = class {
  constructor() {
    __publicField(this, "fns", /* @__PURE__ */ new Set());
  }
  add(fn) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v) {
    for (const fn of [...this.fns]) fn(v);
  }
};

// src/protocol/connection.ts
function makeConnection(transport, role, parse2, stampSeq) {
  let state = "handshaking";
  let nextSeq = 1;
  let lastReceivedServerSeq = 0;
  const messages = new Listeners();
  const frames = new Listeners();
  const violations = new Listeners();
  transport.onText((text) => {
    const parsed = parse2(text);
    if (parsed.ok === "unknown") return;
    if (parsed.ok === false) {
      violations.emit({ kind: "illegal_message", detail: parsed.error, state });
      return;
    }
    if (role === "client" && parsed.msg.type !== "ping" && parsed.msg.type !== "pong") {
      const seq = parsed.msg.seq;
      if (seq <= lastReceivedServerSeq) {
        violations.emit({
          kind: "sequence_violation",
          detail: `server seq ${seq} is not greater than ${lastReceivedServerSeq}`,
          state
        });
        return;
      }
      lastReceivedServerSeq = seq;
    }
    const { next, verdict } = onReceive(role, state, parsed.msg.type);
    state = next;
    if (verdict === "violation") {
      violations.emit({ kind: "illegal_message", detail: `unexpected ${parsed.msg.type}`, state });
      return;
    }
    if (verdict === "deliver") messages.emit(parsed.msg);
  });
  transport.onBinary((bytes) => {
    const verdict = frameVerdict(state);
    if (verdict === "ignore") return;
    if (verdict === "violation") {
      violations.emit({ kind: "illegal_frame", detail: `binary frame while ${state}`, state });
      return;
    }
    let frame;
    try {
      frame = decodeFrame(bytes);
    } catch (err) {
      violations.emit({ kind: "bad_frame", detail: String(err), state });
      return;
    }
    frames.emit(frame);
  });
  transport.onClose(() => {
    state = "closed";
  });
  const base = {
    get protocolState() {
      return state;
    },
    sendFrame(frame) {
      transport.sendBinary(encodeFrame(frame));
    },
    onFrame: (fn) => frames.add(fn),
    onClose: (fn) => transport.onClose(fn),
    onViolation: (fn) => violations.add(fn),
    close(code, reason) {
      state = "closed";
      transport.close(code, reason);
    }
  };
  return {
    base,
    send(msg) {
      const out = stampSeq && msg.type !== "ping" && msg.type !== "pong" ? { ...msg, seq: nextSeq++ } : msg;
      state = onSend(role, state, String(msg.type));
      transport.sendText(JSON.stringify(out));
    },
    messages
  };
}
function clientProtocolConnection(transport) {
  const { base, send, messages } = makeConnection(transport, "client", parseServerMessage, false);
  return {
    get protocolState() {
      return base.protocolState;
    },
    sendFrame: base.sendFrame,
    onFrame: base.onFrame,
    onClose: base.onClose,
    onViolation: base.onViolation,
    close: base.close,
    send: (msg) => send(msg),
    onMessage: (fn) => messages.add(fn)
  };
}

// src/protocol/limits.ts
var MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
var MAX_TEXT_CHARS = 2e3;
var MAX_INSTRUCTION_CHARS = 2e3;
var MAX_FRAME_PAYLOAD_BYTES = 64 * 1024;
var HANDSHAKE_TIMEOUT_MS = 5e3;

// src/protocol/negotiation.ts
var Feature = {
  UTTERANCE_TIMING_V1: "utterance_timing_v1",
  MEDIA_UNIT_FLAGS_V1: "media_unit_flags_v1"
};

// src/protocol/transports/websocket.ts
var READY_STATE = {
  0: "connecting",
  1: "open",
  2: "closing",
  3: "closed"
};
function webSocketTransport(ws) {
  try {
    ws.binaryType = "arraybuffer";
  } catch {
  }
  const open = new Listeners();
  const text = new Listeners();
  const binary = new Listeners();
  const closed = new Listeners();
  ws.addEventListener("open", () => open.emit());
  ws.addEventListener("message", (ev) => {
    const d = ev.data;
    if (typeof d === "string") text.emit(d);
    else if (d instanceof ArrayBuffer) binary.emit(new Uint8Array(d));
    else if (ArrayBuffer.isView(d)) {
      const v = d;
      binary.emit(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
  });
  ws.addEventListener("close", (ev) => {
    closed.emit({ code: ev.code ?? 1005, reason: ev.reason ?? "" });
  });
  ws.addEventListener("error", () => {
  });
  return {
    get state() {
      return READY_STATE[ws.readyState] ?? "closed";
    },
    sendText(data) {
      ws.send(data);
    },
    sendBinary(data) {
      const exact = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      ws.send(exact);
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    onOpen: (fn) => open.add(fn),
    onText: (fn) => text.add(fn),
    onBinary: (fn) => binary.add(fn),
    onClose: (fn) => closed.add(fn)
  };
}

// src/clock-map.ts
var ClockMap = class {
  constructor(cap = 64) {
    this.cap = cap;
    __publicField(this, "samples", []);
  }
  record(x, y) {
    this.samples.push({ x, y });
    if (this.samples.length > this.cap) this.samples.shift();
  }
  at(x) {
    const samples = this.samples;
    if (samples.length === 0) return null;
    const first = samples[0];
    if (samples.length === 1 || x <= first.x) return first.y;
    const last = samples[samples.length - 1];
    if (x >= last.x) return last.y;
    for (let i = 1; i < samples.length; i++) {
      const b = samples[i];
      if (x > b.x) continue;
      const a = samples[i - 1];
      const span = b.x - a.x;
      if (span <= 0) return a.y;
      const t = (x - a.x) / span;
      return a.y + t * (b.y - a.y);
    }
    return last.y;
  }
  clear() {
    this.samples.length = 0;
  }
};

// src/mic-pipeline.ts
var TARGET_RATE = 16e3;
var MIC_FRAME_SAMPLES = 1600;
var VIDEO_MEDIA_TIME_UNKNOWN = 4294967295;
function clamp16(x) {
  const v = Math.round(x * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}
function computeFrameTimestamp(frameStartContextTime, inputLatencySeconds, audioClockMap, getVideoMediaTimeMs, timeOrigin) {
  const performanceTimeMs = audioClockMap.at(frameStartContextTime - inputLatencySeconds);
  if (performanceTimeMs === null) return null;
  const rawVideoMediaTimeMs = getVideoMediaTimeMs?.(performanceTimeMs) ?? null;
  return {
    videoMediaTimeMs: rawVideoMediaTimeMs === null ? VIDEO_MEDIA_TIME_UNKNOWN : Math.round(rawVideoMediaTimeMs),
    captureEpochMs: timeOrigin + performanceTimeMs
  };
}
var MicPipeline = class {
  constructor() {
    __publicField(this, "ctx", null);
    __publicField(this, "stream", null);
    __publicField(this, "node", null);
    __publicField(this, "sink", null);
    __publicField(this, "opts", null);
    __publicField(this, "inRate", 48e3);
    __publicField(this, "resTail", new Float32Array(0));
    __publicField(this, "resPos", 0);
    __publicField(this, "frame", new Int16Array(MIC_FRAME_SAMPLES));
    __publicField(this, "frameLen", 0);
    __publicField(this, "closed", false);
    __publicField(this, "muted", false);
    __publicField(this, "pcmCallCount", 0);
    __publicField(this, "audioClockMap", new ClockMap());
    __publicField(this, "inputLatencySeconds", 0);
    __publicField(this, "frameStartContextTime", 0);
    __publicField(this, "micSeq", 0);
  }
  // Returns the live MediaStream so the caller can pass it to start(), avoiding
  // a second getUserMedia call (which causes a second permission prompt on Firefox).
  static async ensurePermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error("mediaDevices unavailable");
      err.name = "NotSupportedError";
      throw err;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false
    });
  }
  async start(opts) {
    this.opts = opts;
    const dev = opts.dev ?? false;
    if (opts.stream) {
      this.stream = opts.stream;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        video: false
      });
    }
    const track = this.stream.getAudioTracks()[0];
    const settings = track?.getSettings();
    const nativeRate = settings?.sampleRate;
    this.inputLatencySeconds = settings?.latency ?? 0;
    const ctx = new AudioContext(nativeRate ? { sampleRate: nativeRate } : {});
    this.ctx = ctx;
    if (dev) {
      console.log(
        "[mic] AudioContext state=",
        ctx.state,
        "sampleRate=",
        ctx.sampleRate,
        "trackRate=",
        nativeRate,
        "settings=",
        settings
      );
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
      }
      if (dev) console.log("[mic] AudioContext state after resume=", ctx.state);
    }
    this.inRate = ctx.sampleRate;
    await ctx.audioWorklet.addModule(opts.workletUrl);
    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "mic-fwd");
    this.node = node;
    node.port.onmessage = (e) => {
      const { data, contextTime } = e.data;
      this.onPcm(data, contextTime, dev);
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(node).connect(sink).connect(ctx.destination);
  }
  onPcm(chunk, contextTime, dev) {
    if (this.closed) return;
    if (dev) {
      this.pcmCallCount++;
      if (this.pcmCallCount <= 5 || this.pcmCallCount % 100 === 0) {
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) {
          const abs = Math.abs(chunk[i] ?? 0);
          if (abs > peak) peak = abs;
        }
        console.log(
          "[mic] onPcm #",
          this.pcmCallCount,
          "len=",
          chunk.length,
          "peak=",
          peak.toFixed(4)
        );
      }
    }
    const ratio = this.inRate / TARGET_RATE;
    const bufContextTime = contextTime - this.resTail.length / this.inRate;
    const buf = new Float32Array(this.resTail.length + chunk.length);
    buf.set(this.resTail, 0);
    buf.set(chunk, this.resTail.length);
    let pos = this.resPos;
    for (; ; ) {
      const i = Math.floor(pos);
      if (i + 1 >= buf.length) break;
      const f = pos - i;
      const sample = (buf[i] ?? 0) * (1 - f) + (buf[i + 1] ?? 0) * f;
      if (this.frameLen === 0) this.frameStartContextTime = bufContextTime + pos / this.inRate;
      this.frame[this.frameLen++] = clamp16(sample);
      if (this.frameLen === MIC_FRAME_SAMPLES) this.flushFrame();
      pos += ratio;
    }
    const keepFrom = Math.min(Math.floor(pos), buf.length);
    this.resTail = buf.slice(keepFrom);
    this.resPos = pos - keepFrom;
  }
  flushFrame() {
    const opts = this.opts;
    if (this.ctx && opts) {
      const ts = this.ctx.getOutputTimestamp();
      this.audioClockMap.record(
        ts.contextTime ?? this.ctx.currentTime,
        ts.performanceTime ?? performance.now()
      );
      const result = computeFrameTimestamp(
        this.frameStartContextTime,
        this.inputLatencySeconds,
        this.audioClockMap,
        opts.getVideoMediaTimeMs,
        performance.timeOrigin
      );
      if (result) {
        this.micSeq += 1;
        const pcm = this.muted ? new Int16Array(MIC_FRAME_SAMPLES) : this.frame.slice();
        opts.onFrame(pcm, { micSeq: this.micSeq, ...result });
      }
    }
    this.frameLen = 0;
  }
  setMuted(m) {
    this.muted = m;
  }
  stop() {
    this.closed = true;
    try {
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
    }
    this.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.stream = null;
    void this.ctx?.close().catch(() => {
    });
    this.ctx = null;
  }
};

// src/mse-player.ts
function getMediaSourceCtor() {
  if (typeof window === "undefined") return null;
  const w = window;
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}
var MsePlayer = class {
  constructor(video, dev = false) {
    this.video = video;
    this.dev = dev;
    __publicField(this, "ms", null);
    __publicField(this, "sb", null);
    __publicField(this, "mime", null);
    __publicField(this, "pending", []);
    __publicField(this, "activeAppend", null);
    __publicField(this, "discarding", false);
    __publicField(this, "sourceOpen", false);
    __publicField(this, "streaming", true);
    __publicField(this, "started", false);
    __publicField(this, "firstFrameFired", false);
    __publicField(this, "closed", false);
    __publicField(this, "handlers", {});
    __publicField(this, "startSeeked", false);
    __publicField(this, "lastSeekAt", 0);
    __publicField(this, "audioBlocked", false);
    __publicField(this, "resumeAttempts", 0);
    __publicField(this, "watchdogListeners", []);
    __publicField(this, "mediaTimeMap", new ClockMap());
    __publicField(this, "mediaUnitDurationUs", null);
    __publicField(this, "rvfcHandle", null);
    __publicField(this, "lastPlayedPtsUs", null);
    __publicField(this, "advanceHandlers", /* @__PURE__ */ new Set());
  }
  static supported() {
    return getMediaSourceCtor() !== null;
  }
  fireFirstFrame() {
    if (this.firstFrameFired) return;
    this.firstFrameFired = true;
    this.handlers.onFirstFrame?.();
  }
  /** Create the MediaSource and arm the element. Call once, then setMime() + append(). */
  attach(handlers = {}) {
    this.handlers = handlers;
    const Ctor = getMediaSourceCtor();
    if (!Ctor) {
      handlers.onError?.(new Error("MediaSource unsupported"));
      return;
    }
    const ms = new Ctor();
    this.ms = ms;
    this.video.disableRemotePlayback = true;
    ms.addEventListener("sourceopen", () => {
      this.sourceOpen = true;
      this.trySetup();
    });
    ms.addEventListener("startstreaming", () => {
      this.streaming = true;
      this.drain();
    });
    ms.addEventListener("endstreaming", () => {
      this.streaming = false;
    });
    if ("ManagedMediaSource" in window) {
      this.video.srcObject = ms;
    } else {
      this.video.src = URL.createObjectURL(ms);
    }
    const v = this.video;
    const onPause = () => {
      if (this.closed || !this.started || !v.paused) return;
      if (this.resumeAttempts >= 5) return;
      this.resumeAttempts += 1;
      void v.play().catch(() => {
        if (this.closed) return;
        v.muted = true;
        void v.play().catch(() => {
        });
        this.setAudioBlocked();
      });
    };
    v.addEventListener("pause", onPause);
    const onPlaying = () => {
      this.resumeAttempts = 0;
    };
    v.addEventListener("playing", onPlaying);
    this.watchdogListeners.push(["pause", onPause], ["playing", onPlaying]);
    const onAdvance = () => {
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.lastPlayedPtsUs = Math.max(0, Math.round(this.video.currentTime * 1e6));
      }
      this.emitAdvance();
    };
    for (const event of ["timeupdate", "seeking", "seeked", "playing", "loadeddata"]) {
      v.addEventListener(event, onAdvance);
      this.watchdogListeners.push([event, onAdvance]);
    }
    const fireFirst = () => this.fireFirstFrame();
    const fireFirstIfPlaying = () => {
      if (this.firstFrameFired) return;
      if (!this.video.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.fireFirstFrame();
      }
    };
    this.video.addEventListener("playing", fireFirst);
    this.video.addEventListener("timeupdate", fireFirstIfPlaying);
    this.video.addEventListener("loadeddata", fireFirstIfPlaying);
    this.video.addEventListener("canplay", fireFirstIfPlaying);
    this.scheduleFrameCallback();
  }
  /** Declare the stream's MSE mime (from the accept's video channel descriptor). */
  setMime(mime) {
    this.mime = mime;
    this.trySetup();
  }
  /** Append one fMP4 payload (init segment or media segment, in wire order). */
  append(bytes, ptsUs = 0, init = false) {
    if (this.closed) return;
    const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    copy.set(bytes);
    this.pending.push({ bytes: copy, ptsUs, init });
    this.drain();
  }
  /** Nominal complete-unit duration from the negotiated video channel descriptor. The rollout
   *  intentionally leaves duration out of the binary header, so this is what lets interruption
   *  reject a queued unit whose start precedes, but whose tail crosses, the cutoff. */
  setMediaUnitTiming(fps, segmentFrames) {
    if (Number.isFinite(fps) && fps > 0 && Number.isInteger(segmentFrames) && segmentFrames > 0) {
      this.mediaUnitDurationUs = Math.round(segmentFrames / fps * 1e6);
    }
  }
  /** Re-arms itself each callback (rVFC only fires once per registration) to keep sampling the
   *  mediaTime <-> performanceTime relationship for the life of playback. No-op where unsupported
   *  (e.g. older Firefox) — mediaTimeAt() then always returns null, same as before any frame has
   *  displayed. */
  scheduleFrameCallback() {
    if (typeof this.video.requestVideoFrameCallback !== "function") return;
    this.rvfcHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      if (this.closed) return;
      this.mediaTimeMap.record(metadata.expectedDisplayTime, metadata.mediaTime * 1e3);
      this.lastPlayedPtsUs = Math.max(0, Math.round(metadata.mediaTime * 1e6));
      this.emitAdvance();
      this.scheduleFrameCallback();
    });
  }
  /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
   *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
   *  change handling). Returns null before the first displayed frame. */
  mediaTimeAt(performanceTimeMs) {
    return this.mediaTimeMap.at(performanceTimeMs);
  }
  playedPtsUs() {
    if (this.lastPlayedPtsUs !== null) return this.lastPlayedPtsUs;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const current = this.video.currentTime;
    return Number.isFinite(current) ? Math.max(0, Math.round(current * 1e6)) : null;
  }
  bufferedMs() {
    const buffered = this.video.buffered;
    if (!buffered.length) return 0;
    try {
      return Math.max(
        0,
        Math.round((buffered.end(buffered.length - 1) - this.video.currentTime) * 1e3)
      );
    } catch {
      return 0;
    }
  }
  onAdvance(handler) {
    this.advanceHandlers.add(handler);
    return () => this.advanceHandlers.delete(handler);
  }
  /** Remove queued and MSE-buffered media at/after the server-timeline cutoff. */
  async discardFrom(cutoffPtsUs) {
    const retained = (entry) => {
      if (entry.init) return true;
      if (this.mediaUnitDurationUs === null) return false;
      return entry.ptsUs + this.mediaUnitDurationUs <= cutoffPtsUs;
    };
    this.pending.splice(0, this.pending.length, ...this.pending.filter(retained));
    const sb = this.sb;
    if (!sb) {
      this.emitAdvance();
      return;
    }
    this.discarding = true;
    const activeCrossesCutoff = this.activeAppend !== null && !this.activeAppend.init && (this.mediaUnitDurationUs === null || this.activeAppend.ptsUs + this.mediaUnitDurationUs > cutoffPtsUs);
    if (activeCrossesCutoff && sb.updating) {
      try {
        sb.abort();
      } catch {
      }
      this.activeAppend = null;
    }
    await this.waitForIdle(sb);
    const cutoffSec = cutoffPtsUs / 1e6;
    if (sb.buffered.length) {
      const end = sb.buffered.end(sb.buffered.length - 1);
      if (end > cutoffSec) {
        const start = Math.max(cutoffSec, sb.buffered.start(0));
        if (end > start) {
          try {
            sb.remove(start, end);
            await this.waitForIdle(sb);
          } catch {
          }
        }
      }
    }
    this.discarding = false;
    this.drain();
    this.emitAdvance();
  }
  setAudioBlocked() {
    if (this.audioBlocked) return;
    this.audioBlocked = true;
    this.handlers.onAudioBlocked?.();
  }
  /** Unmute from a user-gesture context (e.g. a tap-for-sound button). Also resumes playback
   *  if the element is paused. Returns whether audio is now unblocked. */
  unmuteAudio() {
    const v = this.video;
    v.muted = false;
    if (v.paused) void v.play().catch(() => {
    });
    this.audioBlocked = false;
    this.resumeAttempts = 0;
    return !v.muted;
  }
  trySetup() {
    if (this.sb || !this.sourceOpen || !this.mime || !this.ms) return;
    if (typeof MediaSource !== "undefined" && !MediaSource.isTypeSupported(this.mime)) {
      console.warn("[mse] unsupported codec:", this.mime);
      this.handlers.onError?.(new Error(`unsupported codec: ${this.mime}`));
      return;
    }
    try {
      const sb = this.ms.addSourceBuffer(this.mime);
      sb.mode = "segments";
      sb.addEventListener("updateend", () => {
        this.activeAppend = null;
        if (!this.discarding) this.drain();
      });
      this.sb = sb;
      this.drain();
    } catch (e) {
      this.handlers.onError?.(e);
    }
  }
  drain() {
    const sb = this.sb;
    if (!sb || sb.updating || !this.streaming || this.discarding) return;
    const next = this.pending.shift();
    if (next === void 0) {
      this.housekeep(false);
      return;
    }
    try {
      this.activeAppend = next;
      sb.appendBuffer(next.bytes);
      if (!this.started) {
        this.started = true;
        this.video.muted = true;
        this.video.play().then(() => {
          if (this.dev)
            console.log(
              "[mse] play() resolved paused=",
              this.video.paused,
              "readyState=",
              this.video.readyState
            );
          this.video.muted = false;
          if (this.video.paused) {
            if (this.dev) console.warn("[mse] unmute paused playback \u2014 resuming muted");
            this.video.muted = true;
            void this.video.play().catch(() => {
            });
            this.setAudioBlocked();
          }
        }).catch((err) => {
          console.warn(
            "[mse] play() rejected",
            err?.name,
            err?.message,
            "paused=",
            this.video.paused,
            "readyState=",
            this.video.readyState,
            "muted=",
            this.video.muted
          );
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        this.activeAppend = null;
        this.pending.unshift(next);
        this.housekeep(true);
      } else {
        this.handlers.onError?.(e);
      }
    }
  }
  housekeep(force) {
    const sb = this.sb;
    const v = this.video;
    if (!sb || sb.updating) return;
    const b = sb.buffered;
    if (!b.length) return;
    const start = b.start(0);
    const end = b.end(b.length - 1);
    if (this.firstFrameFired && !this.startSeeked && end - start > 0.5) {
      try {
        v.currentTime = Math.max(start, end - 0.5);
      } catch {
      }
      this.startSeeked = true;
    }
    if (!v.paused) {
      const ahead = end - v.currentTime;
      const now = performance.now() / 1e3;
      if (ahead > 2.5 && now - this.lastSeekAt > 3) {
        try {
          v.currentTime = end - 0.4;
        } catch {
        }
        this.lastSeekAt = now;
      } else {
        v.playbackRate = ahead > 1.2 ? 1.06 : 1;
      }
    }
    if (force || v.currentTime - start > 4) {
      const to = Math.max(start + 0.05, v.currentTime - 2);
      if (to > start) {
        try {
          sb.remove(start, to);
        } catch {
        }
      }
    }
  }
  stop() {
    this.closed = true;
    if (this.rvfcHandle !== null && typeof this.video.cancelVideoFrameCallback === "function") {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.mediaTimeMap.clear();
    try {
      if (this.ms && this.ms.readyState === "open") this.ms.endOfStream();
    } catch {
    }
    this.pending.length = 0;
    this.activeAppend = null;
    this.sb = null;
    this.ms = null;
    for (const [ev, fn] of this.watchdogListeners) {
      this.video.removeEventListener(ev, fn);
    }
    this.watchdogListeners = [];
    this.advanceHandlers.clear();
    try {
      this.video.removeAttribute("src");
      this.video.srcObject = null;
      this.video.load();
    } catch {
    }
  }
  emitAdvance() {
    for (const handler of this.advanceHandlers) handler();
  }
  waitForIdle(sb) {
    if (!sb.updating) return Promise.resolve();
    return new Promise((resolve3) => {
      const done = () => {
        sb.removeEventListener("updateend", done);
        sb.removeEventListener("abort", done);
        sb.removeEventListener("error", done);
        resolve3();
      };
      sb.addEventListener("updateend", done, { once: true });
      sb.addEventListener("abort", done, { once: true });
      sb.addEventListener("error", done, { once: true });
    });
  }
};

// src/state.ts
var ALLOWED = {
  idle: ["selecting", "verifying", "waiting", "error"],
  selecting: ["selecting", "verifying", "idle", "error"],
  verifying: ["waiting", "idle", "error", "ended"],
  waiting: ["ready", "idle", "ended", "error"],
  ready: ["connecting", "idle", "ended", "error"],
  connecting: ["live", "idle", "ended", "error"],
  live: ["idle", "ended", "error"],
  ended: ["selecting", "verifying", "idle"],
  error: ["selecting", "verifying", "idle"]
};
var StateMachine = class {
  constructor(dev = false) {
    this.dev = dev;
    __publicField(this, "current", "idle");
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
  }
  get state() {
    return this.current;
  }
  set(next) {
    const prev = this.current;
    if (prev === next) return;
    if (this.dev && !ALLOWED[prev].includes(next)) {
      console.warn(`[avatar] unexpected transition ${prev} \u2192 ${next}`);
    }
    this.current = next;
    for (const l of this.listeners) l(next, prev);
  }
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
};

// src/media-unit-assembler.ts
var MediaUnitAssembler = class {
  constructor() {
    __publicField(this, "partial", /* @__PURE__ */ new Map());
  }
  push(frame) {
    const starts = Boolean(frame.flags & FrameFlags.UNIT_START);
    const ends = Boolean(frame.flags & FrameFlags.UNIT_END);
    let unit = this.partial.get(frame.channelId);
    if (starts) {
      unit = {
        frameType: frame.frameType,
        channelId: frame.channelId,
        ptsUs: frame.ptsUs,
        chunks: [],
        bytes: 0
      };
      this.partial.set(frame.channelId, unit);
    } else if (!unit) {
      return null;
    }
    if (unit.frameType !== frame.frameType || unit.channelId !== frame.channelId || unit.ptsUs !== frame.ptsUs) {
      this.partial.delete(frame.channelId);
      return null;
    }
    const chunk = frame.payload.slice();
    unit.chunks.push(chunk);
    unit.bytes += chunk.byteLength;
    if (!ends) return null;
    this.partial.delete(frame.channelId);
    const payload = new Uint8Array(unit.bytes);
    let offset = 0;
    for (const part of unit.chunks) {
      payload.set(part, offset);
      offset += part.byteLength;
    }
    return {
      frameType: unit.frameType,
      channelId: unit.channelId,
      ptsUs: unit.ptsUs,
      payload
    };
  }
  discardFrom(cutoffPtsUs) {
    this.partial.clear();
  }
  clear() {
    this.partial.clear();
  }
};

// src/pcm-player.ts
var PcmPlayer = class {
  constructor(onBlocked) {
    this.onBlocked = onBlocked;
    __publicField(this, "ctx", null);
    __publicField(this, "nextStart", 0);
    __publicField(this, "scheduled", /* @__PURE__ */ new Set());
    __publicField(this, "lastEndedPtsUs", 0);
    __publicField(this, "blocked", false);
    __publicField(this, "advanceHandlers", /* @__PURE__ */ new Set());
    __publicField(this, "advanceTimer", null);
  }
  enqueue(frame) {
    if (frame.pcm.length === 0 || frame.sampleRate <= 0) return;
    const ctx = this.ensureContext();
    const audio = ctx.createBuffer(1, frame.pcm.length, frame.sampleRate);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < frame.pcm.length; i++) channel[i] = (frame.pcm[i] ?? 0) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.04, this.nextStart);
    const entry = {
      source,
      startCtxTime: startAt,
      durationSec: audio.duration,
      ptsUs: frame.ptsUs
    };
    source.addEventListener("ended", () => {
      if (this.scheduled.delete(entry)) {
        this.lastEndedPtsUs = Math.max(
          this.lastEndedPtsUs,
          entry.ptsUs + entry.durationSec * 1e6
        );
      }
      this.emitAdvance();
    });
    this.scheduled.add(entry);
    source.start(startAt);
    this.nextStart = startAt + audio.duration;
    this.emitAdvance();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        if (!this.blocked) {
          this.blocked = true;
          this.onBlocked?.();
        }
      });
    }
  }
  /** Stop queued frames and trim a source whose samples straddle the exact cutoff. */
  flushFrom(cutoffUs) {
    for (const entry of [...this.scheduled]) {
      const endPtsUs = entry.ptsUs + entry.durationSec * 1e6;
      if (endPtsUs <= cutoffUs) continue;
      if (entry.ptsUs >= cutoffUs) {
        try {
          entry.source.stop();
        } catch {
        }
        this.scheduled.delete(entry);
        continue;
      }
      const keptSec = Math.max(0, (cutoffUs - entry.ptsUs) / 1e6);
      entry.durationSec = keptSec;
      const stopAt = entry.startCtxTime + keptSec;
      try {
        entry.source.stop(Math.max(this.ctx?.currentTime ?? stopAt, stopAt));
      } catch {
      }
    }
    this.recomputeNextStart();
    this.emitAdvance();
  }
  async discardFrom(cutoffPtsUs) {
    this.flushFrom(cutoffPtsUs);
  }
  flush() {
    for (const entry of this.scheduled) {
      try {
        entry.source.stop();
      } catch {
      }
    }
    this.scheduled.clear();
    this.nextStart = this.ctx?.currentTime ?? 0;
    this.emitAdvance();
  }
  /** Session-clock position (µs) of what the speaker is emitting right now: interpolated inside
   *  the currently playing source, else the end of the last finished one. */
  playedPtsUs() {
    const now = this.ctx?.currentTime ?? 0;
    let played = this.lastEndedPtsUs;
    let hasPlayhead = this.lastEndedPtsUs > 0;
    for (const entry of this.scheduled) {
      if (entry.startCtxTime > now) continue;
      hasPlayhead = true;
      const into = Math.min(now - entry.startCtxTime, entry.durationSec);
      played = Math.max(played, entry.ptsUs + into * 1e6);
    }
    return hasPlayhead ? Math.round(played) : null;
  }
  /** Audio queued ahead of the playhead, in ms. */
  bufferedMs() {
    const now = this.ctx?.currentTime ?? 0;
    return Math.max(0, Math.round((this.nextStart - now) * 1e3));
  }
  unmute() {
    this.blocked = false;
    if (!this.ctx) return true;
    void this.ctx.resume().catch(() => {
    });
    return this.ctx.state !== "suspended";
  }
  stop() {
    this.flush();
    if (this.advanceTimer) clearInterval(this.advanceTimer);
    this.advanceTimer = null;
    this.advanceHandlers.clear();
    void this.ctx?.close().catch(() => {
    });
    this.ctx = null;
  }
  recomputeNextStart() {
    const now = this.ctx?.currentTime ?? 0;
    let end = now;
    for (const entry of this.scheduled) {
      end = Math.max(end, entry.startCtxTime + entry.durationSec);
    }
    this.nextStart = end;
  }
  ensureContext() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }
  onAdvance(handler) {
    this.advanceHandlers.add(handler);
    if (!this.advanceTimer) {
      this.advanceTimer = setInterval(() => this.emitAdvance(), 16);
    }
    return () => {
      this.advanceHandlers.delete(handler);
      if (this.advanceHandlers.size === 0 && this.advanceTimer) {
        clearInterval(this.advanceTimer);
        this.advanceTimer = null;
      }
    };
  }
  emitAdvance() {
    for (const handler of this.advanceHandlers) handler();
  }
};

// src/utterance-scheduler.ts
var UtteranceScheduler = class {
  constructor(clock, handlers) {
    this.clock = clock;
    this.handlers = handlers;
    __publicField(this, "entries", /* @__PURE__ */ new Map());
    __publicField(this, "cancelled", /* @__PURE__ */ new Set());
    __publicField(this, "activeId", null);
    __publicField(this, "unsubscribe");
    __publicField(this, "stopped", false);
    this.unsubscribe = clock.onAdvance(() => this.advance());
  }
  receiveStart(message) {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const previous = this.entries.get(message.utterance_id);
    if (previous?.status === "active") return;
    this.entries.set(message.utterance_id, {
      turnId: message.turn_id,
      utteranceId: message.utterance_id,
      startPtsUs: message.start_pts_us,
      text: message.text,
      textFinal: message.text_final,
      language: message.language,
      revision: previous?.revision ?? -1,
      endPtsUs: previous?.endPtsUs,
      reason: previous?.reason,
      status: "pending"
    });
  }
  receiveText(message) {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const entry = this.entries.get(message.utterance_id);
    if (!entry || entry.turnId !== message.turn_id || message.revision <= entry.revision) return;
    entry.revision = message.revision;
    entry.text = message.text;
    entry.textFinal = message.final;
    if (entry.status === "active") this.handlers.onText(this.snapshot(entry));
  }
  receiveEnd(message) {
    if (this.stopped || this.cancelled.has(message.utterance_id)) return;
    const entry = this.entries.get(message.utterance_id);
    if (!entry || entry.turnId !== message.turn_id) return;
    entry.endPtsUs = message.end_pts_us;
    entry.reason = message.reason;
  }
  /** Cancel unheard affected cues and close a visible utterance at the local cutoff playhead. */
  interrupt(cutoffPtsUs, utteranceIds) {
    if (this.stopped) return;
    const affected = new Set(utteranceIds);
    for (const utteranceId of affected) {
      this.cancelled.add(utteranceId);
      const entry = this.entries.get(utteranceId);
      if (!entry) continue;
      if (entry.status === "active") {
        entry.endPtsUs = cutoffPtsUs;
        entry.reason = "interrupted";
        continue;
      }
      this.entries.delete(utteranceId);
    }
    this.advance();
  }
  advance() {
    if (this.stopped) return;
    const played = this.clock.playedPtsUs();
    if (played === null) return;
    const active = this.activeId ? this.entries.get(this.activeId) : void 0;
    if (active?.endPtsUs !== void 0 && played >= active.endPtsUs) {
      this.handlers.onEnd(this.snapshot(active));
      this.entries.delete(active.utteranceId);
      this.activeId = null;
    }
    for (const [id, entry] of this.entries) {
      if (entry.status === "pending" && entry.endPtsUs !== void 0 && played >= entry.endPtsUs) {
        this.entries.delete(id);
      }
    }
    const candidates = [...this.entries.values()].filter(
      (entry) => entry.status === "pending" && played >= entry.startPtsUs && (entry.endPtsUs === void 0 || played < entry.endPtsUs)
    ).sort((a, b) => a.startPtsUs - b.startPtsUs);
    const next = candidates.at(-1);
    if (!next) return;
    const prior = this.activeId ? this.entries.get(this.activeId) : void 0;
    if (prior && prior.utteranceId !== next.utteranceId) {
      prior.reason ?? (prior.reason = "replaced");
      prior.endPtsUs ?? (prior.endPtsUs = next.startPtsUs);
      this.handlers.onEnd(this.snapshot(prior));
      this.entries.delete(prior.utteranceId);
    }
    next.status = "active";
    this.activeId = next.utteranceId;
    this.handlers.onStart(this.snapshot(next));
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    this.entries.clear();
    this.cancelled.clear();
    this.activeId = null;
  }
  snapshot(entry) {
    return {
      turnId: entry.turnId,
      utteranceId: entry.utteranceId,
      startPtsUs: entry.startPtsUs,
      ...entry.endPtsUs === void 0 ? {} : { endPtsUs: entry.endPtsUs },
      ...entry.text === void 0 ? {} : { text: entry.text },
      textFinal: entry.textFinal,
      ...entry.language === void 0 ? {} : { language: entry.language },
      revision: entry.revision,
      ...entry.reason === void 0 ? {} : { reason: entry.reason }
    };
  }
};

// src/v2/driver.ts
var CLOSE_CODE_ERRORS = {
  [CloseCode.UNAUTHORIZED]: {
    kind: "unauthorized",
    message: "session token rejected (4001 unauthorized)"
  },
  [CloseCode.PROTOCOL_MISMATCH]: {
    kind: "protocol-mismatch",
    message: "box does not speak protocol v2 (4002)"
  },
  [CloseCode.PERSONA_UNRESOLVABLE]: {
    kind: "persona-unavailable",
    message: "persona unresolvable on the box (4003)"
  },
  [CloseCode.CAPACITY]: { kind: "capacity", message: "box at capacity (4004)" },
  [CloseCode.POLICY]: { kind: "policy", message: "protocol policy violation (4008)" }
};
var END_REASONS = ["cap", "kicked", "expired", "dropped"];
var PLAYOUT_ACK_INTERVAL_MS = 300;
var KEEPALIVE_PING_MS = 15e3;
var TEXT_TIMEOUT_MS = 3e4;
var V2Driver = class {
  constructor(opts) {
    this.opts = opts;
    __publicField(this, "conn", null);
    __publicField(this, "mse", null);
    __publicField(this, "player", null);
    __publicField(this, "clock", null);
    __publicField(this, "scheduler", null);
    __publicField(this, "unitAssembler", new MediaUnitAssembler());
    __publicField(this, "pipeline", null);
    __publicField(this, "accepted", null);
    __publicField(this, "audioCh", null);
    __publicField(this, "micCh", null);
    __publicField(this, "endReason", null);
    __publicField(this, "finished", false);
    __publicField(this, "timedUtterances", false);
    __publicField(this, "framedMediaUnits", false);
    __publicField(this, "handshakeTimer", null);
    __publicField(this, "ackTimer", null);
    __publicField(this, "pingTimer", null);
    __publicField(this, "textSequence", 0);
    __publicField(this, "textWaiters", /* @__PURE__ */ new Map());
    __publicField(this, "langs");
    __publicField(this, "responseLanguage");
    this.langs = opts.langs;
    this.responseLanguage = opts.responseLanguage;
  }
  connect() {
    const { opts } = this;
    const create = opts.createSocket ?? ((url, protocols) => new WebSocket(url, protocols));
    let socket;
    try {
      socket = create(opts.sessionWsUrl, [SUBPROTOCOL]);
    } catch (err) {
      this.fail(err);
      return;
    }
    const transport = webSocketTransport(socket);
    const conn = clientProtocolConnection(transport);
    this.conn = conn;
    transport.onOpen(() => {
      if (this.finished) return;
      if (socket.protocol !== void 0 && socket.protocol !== SUBPROTOCOL) {
        this.fail(new Error(`server did not echo subprotocol ${SUBPROTOCOL}`), "protocol-mismatch");
        return;
      }
      conn.send({
        type: "hello",
        proto: 2,
        accept: {
          audio: ["pcm16"],
          ...MsePlayer.supported() ? { video: ["fmp4"] } : {}
        },
        ...opts.mic ? { mic: { codec: "pcm16", sample_rate: 16e3 } } : {},
        ...this.langs.length ? { langs: this.langs } : {},
        ...this.responseLanguage !== void 0 ? { response_language: this.responseLanguage } : {},
        features: [Feature.UTTERANCE_TIMING_V1, Feature.MEDIA_UNIT_FLAGS_V1],
        resume: null
      });
      this.handshakeTimer = setTimeout(() => {
        this.fail(new Error("handshake timeout: no accept from the box"), "handshake");
      }, HANDSHAKE_TIMEOUT_MS);
    });
    conn.onMessage((msg) => this.onServerMessage(msg));
    conn.onFrame((frame) => this.onMediaFrame(frame));
    conn.onViolation((v) => {
      if (opts.dev) console.warn("[v2] protocol violation", v.kind, v.detail);
    });
    conn.onClose((ev) => this.onSocketClose(ev.code));
  }
  onServerMessage(msg) {
    if (this.finished) return;
    switch (msg.type) {
      case "accept":
        this.onAccept(msg);
        break;
      case "partial":
        this.opts.handlers.onPartial(msg.text);
        break;
      case "turn": {
        const turn = {
          text: msg.text,
          reply: msg.reply ?? "",
          language: msg.language,
          speechId: msg.speech_id,
          ...this.timedUtterances ? { timedUtterances: true } : {}
        };
        const waiter = msg.request_id ? this.textWaiters.get(msg.request_id) : void 0;
        if (waiter && msg.request_id) {
          clearTimeout(waiter.timer);
          this.textWaiters.delete(msg.request_id);
          waiter.resolve(turn);
        } else {
          this.opts.handlers.onTurn(turn);
        }
        break;
      }
      case "speech_start":
        if (!this.timedUtterances) this.opts.handlers.onSpeechStart(msg.speech_id);
        break;
      case "speech_end":
        if (!this.timedUtterances) this.opts.handlers.onSpeechEnd(msg.speech_id);
        break;
      case "utterance_start":
        if (this.timedUtterances) this.scheduler?.receiveStart(msg);
        break;
      case "utterance_text":
        if (this.timedUtterances) this.scheduler?.receiveText(msg);
        break;
      case "utterance_end":
        if (this.timedUtterances) this.scheduler?.receiveEnd(msg);
        break;
      case "interruption":
        if (msg.cutoff_pts_us === null) {
          this.player?.flush();
          const cutoff = this.clock?.playedPtsUs() ?? 0;
          this.unitAssembler.discardFrom(cutoff);
          if (this.mse) {
            void this.mse.discardFrom(cutoff).then(() => this.opts.handlers.onMediaDiscarded(cutoff));
          } else {
            this.opts.handlers.onMediaDiscarded(cutoff);
          }
        } else {
          this.unitAssembler.discardFrom(msg.cutoff_pts_us);
          const cutoff = msg.cutoff_pts_us;
          const discarded = this.clock?.discardFrom(cutoff) ?? Promise.resolve();
          void discarded.then(() => this.opts.handlers.onMediaDiscarded(cutoff));
          if ("utterance_ids" in msg) {
            this.scheduler?.interrupt(msg.cutoff_pts_us, msg.utterance_ids);
          }
        }
        break;
      case "instruction_set":
        break;
      case "error": {
        const error = new Error(msg.message ?? msg.code);
        const waiter = msg.request_id ? this.textWaiters.get(msg.request_id) : void 0;
        if (waiter && msg.request_id) {
          clearTimeout(waiter.timer);
          this.textWaiters.delete(msg.request_id);
          waiter.reject(error);
        } else {
          this.opts.handlers.onError(toAvatarError(error, "server", { terminal: false }), false);
        }
        break;
      }
      case "session_end":
        this.endReason = END_REASONS.includes(msg.reason) ? msg.reason : "generic";
        break;
      case "ping":
        this.conn?.send({ type: "pong", t: msg.t });
        break;
      case "pong":
      case "go_away":
        break;
    }
  }
  onAccept(accept) {
    if (this.accepted) return;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    this.accepted = accept;
    const acceptedFeatures = accept.features ?? [];
    this.timedUtterances = acceptedFeatures.includes(Feature.UTTERANCE_TIMING_V1);
    this.framedMediaUnits = acceptedFeatures.includes(Feature.MEDIA_UNIT_FLAGS_V1);
    const { handlers } = this.opts;
    const channels = accept.channels;
    const videoCh = channels.find((c) => c.kind === "video");
    this.audioCh = channels.find((c) => c.kind === "audio" && c.dir === "down") ?? null;
    this.micCh = channels.find((c) => c.kind === "audio" && c.dir === "up") ?? null;
    if (this.audioCh) {
      this.player = new PcmPlayer(() => handlers.onAudioBlocked());
      this.clock = this.player;
    }
    this.pingTimer = setInterval(() => {
      this.conn?.send({ type: "ping", t: Date.now() });
    }, KEEPALIVE_PING_MS);
    if (videoCh) {
      const mse = new MsePlayer(this.opts.videoEl, this.opts.dev);
      this.mse = mse;
      mse.attach({
        onFirstFrame: () => handlers.onFirstFrame(),
        onError: (err) => handlers.onError(toAvatarError(err, "media", { terminal: false }), false),
        onAudioBlocked: () => handlers.onAudioBlocked()
      });
      mse.setMime(videoCh.mime);
      if (videoCh.fps !== void 0 && videoCh.seg_frames !== void 0) {
        mse.setMediaUnitTiming(videoCh.fps, videoCh.seg_frames);
      }
      this.clock = mse;
    } else {
      if (accept.poster?.url) this.opts.videoEl.poster = accept.poster.url;
      handlers.onFirstFrame();
    }
    if (this.timedUtterances && this.clock) {
      this.scheduler = new UtteranceScheduler(this.clock, {
        onStart: (utterance) => {
          handlers.onUtteranceStart(utterance);
          handlers.onSpeechStart(utterance.utteranceId);
        },
        onText: (utterance) => handlers.onUtteranceText(utterance),
        onEnd: (utterance) => {
          handlers.onUtteranceEnd(utterance);
          handlers.onSpeechEnd(utterance.utteranceId);
        }
      });
    }
    this.ackTimer = setInterval(() => {
      const clock = this.clock;
      const playedPtsUs = clock?.playedPtsUs() ?? null;
      if (!clock || playedPtsUs === null) return;
      this.conn?.send({
        type: "playout_ack",
        played_pts_us: playedPtsUs,
        buffered_ms: clock.bufferedMs()
      });
    }, PLAYOUT_ACK_INTERVAL_MS);
    if (this.opts.mic && this.micCh) this.startMic(this.micCh);
    handlers.onAccept({
      capSeconds: accept.cap_seconds,
      personaKey: accept.persona_key,
      posterUrl: accept.poster?.url ?? null,
      hasVideo: Boolean(videoCh)
    });
  }
  startMic(micCh) {
    const pipeline = new MicPipeline();
    this.pipeline = pipeline;
    pipeline.start({
      workletUrl: this.opts.workletUrl,
      stream: this.opts.permittedStream,
      dev: this.opts.dev,
      getVideoMediaTimeMs: this.mse ? (t) => this.mse?.mediaTimeAt(t) ?? null : void 0,
      onFrame: (pcm, info) => this.sendMicFrame(micCh.id, pcm, info)
    }).then(() => {
      if (!this.finished) this.opts.handlers.onMicReady();
    }).catch((err) => {
      this.fail(err, classifyMicError(err));
    });
  }
  sendMicFrame(channelId, pcm, info) {
    const conn = this.conn;
    if (this.finished || !conn || conn.protocolState !== "active") return;
    const ptsUs = info.videoMediaTimeMs === VIDEO_MEDIA_TIME_UNKNOWN ? 0 : info.videoMediaTimeMs * 1e3;
    conn.sendFrame({
      frameType: FrameType.MEDIA,
      channelId,
      flags: 0,
      seq: info.micSeq % (MAX_SEQ + 1),
      ptsUs,
      payload: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    });
    this.opts.handlers.onAudioFrameSent(info);
  }
  onMediaFrame(frame) {
    if (this.finished) return;
    if (frame.frameType !== FrameType.MEDIA_INIT && frame.frameType !== FrameType.MEDIA) return;
    const unit = this.framedMediaUnits ? this.unitAssembler.push(frame) : {
      frameType: frame.frameType,
      channelId: frame.channelId,
      ptsUs: frame.ptsUs,
      payload: frame.payload
    };
    if (!unit) return;
    this.onMediaUnit(unit);
  }
  onMediaUnit(unit) {
    if (this.audioCh && unit.channelId === this.audioCh.id) {
      if (unit.payload.byteLength === 0 || unit.payload.byteLength % 2 !== 0) return;
      const pcm = new Int16Array(
        unit.payload.buffer.slice(
          unit.payload.byteOffset,
          unit.payload.byteOffset + unit.payload.byteLength
        )
      );
      this.player?.enqueue({ pcm, sampleRate: this.audioCh.sample_rate, ptsUs: unit.ptsUs });
      return;
    }
    if (this.mse && this.accepted?.channels.some((c) => c.kind === "video" && c.id === unit.channelId)) {
      this.mse.append(unit.payload, unit.ptsUs, unit.frameType === FrameType.MEDIA_INIT);
    }
  }
  onSocketClose(code) {
    if (this.finished) {
      this.teardown();
      return;
    }
    this.finished = true;
    const { handlers } = this.opts;
    const accepted = this.accepted !== null;
    const endReason = this.endReason;
    this.teardown();
    if (endReason) {
      handlers.onEnded(endReason);
    } else if (accepted) {
      handlers.onEnded("edge_disconnect");
    } else {
      const known = CLOSE_CODE_ERRORS[code];
      handlers.onError(
        new AvatarError(
          known?.kind ?? "connect",
          known?.message ?? `session socket closed before accept (${code})`
        ),
        true
      );
    }
  }
  fail(err, kind = "connect") {
    if (this.finished) return;
    this.finished = true;
    this.teardown();
    try {
      this.conn?.close(CloseCode.NORMAL);
    } catch {
    }
    this.opts.handlers.onError(toAvatarError(err, kind), true);
  }
  async sendText(text) {
    const value = text.trim();
    if (!value) throw new Error("text is required");
    if (value.length > MAX_TEXT_CHARS) throw new Error("text is too long");
    const conn = this.conn;
    if (this.finished || !conn || conn.protocolState !== "active") {
      throw new Error("text transport is unavailable");
    }
    this.textSequence += 1;
    const id = `text-${this.textSequence}`;
    const result = new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.textWaiters.delete(id);
        reject(new Error("text response timed out"));
      }, TEXT_TIMEOUT_MS);
      this.textWaiters.set(id, { resolve: resolve3, reject, timer });
    });
    conn.send({ type: "text", id, text: value });
    return result;
  }
  /** Re-pin the ASR recognition language(s) mid-session; applied by the box on the next turn. */
  setLangs(langs) {
    this.langs = langs;
    if (this.conn?.protocolState === "active") this.conn.send({ type: "set_langs", langs });
  }
  /** Change the preferred REPLY language mid-session (BCP-47; '' clears). */
  setResponseLanguage(language) {
    this.responseLanguage = language;
    if (this.conn?.protocolState === "active") {
      this.conn.send({ type: "set_response_language", language });
    }
  }
  /** Replace the hidden runtime instruction appended to the avatar's system prompt. */
  setRuntimeInstruction(instruction) {
    const value = instruction.trim();
    if (value.length > MAX_INSTRUCTION_CHARS) throw new Error("runtime instruction is too long");
    if (this.conn?.protocolState === "active") {
      this.conn.send({ type: "set_instruction", instruction: value });
    }
  }
  setMuted(muted) {
    this.pipeline?.setMuted(muted);
  }
  unmuteAudio() {
    const mse = this.mse?.unmuteAudio() ?? true;
    const pcm = this.player?.unmute() ?? true;
    return mse && pcm;
  }
  /** Avatar voice queued ahead of the playhead, in ms — how much is still to be heard. `null`
   *  when this session has no playout clock to ask: a video session, whose audio is muxed into
   *  the fMP4 and never reaches a `PcmPlayer`, or a session that has not accepted yet. `null`
   *  means "unknown", never "nothing left", so a caller must not read it as zero. */
  bufferedVoiceMs() {
    return this.clock?.bufferedMs() ?? null;
  }
  playedPtsUs() {
    return this.clock?.playedPtsUs() ?? null;
  }
  /** Deliberate local end: say goodbye, close, release resources. Fires no handler — the
   *  caller (AvatarSession) already decided the outcome. */
  stop() {
    const wasFinished = this.finished;
    this.finished = true;
    if (!wasFinished && this.conn) {
      if (this.conn.protocolState === "active") {
        try {
          this.conn.send({ type: "bye" });
        } catch {
        }
      }
      try {
        this.conn.close(CloseCode.NORMAL);
      } catch {
      }
    }
    this.teardown();
  }
  teardown() {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    if (this.ackTimer) clearInterval(this.ackTimer);
    this.ackTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const waiter of this.textWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("session ended"));
    }
    this.textWaiters.clear();
    this.pipeline?.stop();
    this.pipeline = null;
    this.player?.stop();
    this.player = null;
    this.mse?.stop();
    this.mse = null;
    this.scheduler?.stop();
    this.scheduler = null;
    this.clock = null;
    this.unitAssembler.clear();
  }
};

// src/session.ts
var AvatarSession = class {
  constructor(opts) {
    this.opts = opts;
    __publicField(this, "sm");
    __publicField(this, "driver", null);
    __publicField(this, "done", false);
    __publicField(this, "_sessionCapSeconds");
    __publicField(this, "_personaKey");
    __publicField(this, "permittedStream");
    __publicField(this, "langs");
    __publicField(this, "_responseLanguage");
    __publicField(this, "_userMuted", false);
    __publicField(this, "_micSuppressed", false);
    __publicField(this, "listeners", /* @__PURE__ */ new Map());
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      this.emit("state", next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
    this._responseLanguage = opts.responseLanguage;
  }
  /**
   * Subscribe to a session event. Returns an unsubscribe function.
   *
   * The constructor's `callbacks` still work and fire first; this exists because a callback bag
   * fixed at construction cannot be joined later, which forced every host to hand-forward events
   * into helpers like `attachCaptions`. A throwing handler is caught and never breaks the session
   * or the other subscribers.
   *
   * ```ts
   * const off = session.on('turn', (t) => captions.turn(t));
   * // …later
   * off();
   * ```
   */
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    const entry = handler;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }
  /** Fire the matching constructor callback, then every subscriber. */
  emit(event, ...args) {
    const cb = this.opts.callbacks;
    try {
      switch (event) {
        case "state":
          cb?.onStateChange?.(...args);
          break;
        case "partial":
          cb?.onPartial?.(...args);
          break;
        case "turn":
          cb?.onTurn?.(...args);
          break;
        case "firstFrame":
          cb?.onFirstFrame?.();
          break;
        case "micReady":
          cb?.onMicReady?.();
          break;
        case "speechStart":
          cb?.onSpeechStart?.(...args);
          break;
        case "speechEnd":
          cb?.onSpeechEnd?.(...args);
          break;
        case "utteranceStart":
          cb?.onUtteranceStart?.(...args);
          break;
        case "utteranceText":
          cb?.onUtteranceText?.(...args);
          break;
        case "utteranceEnd":
          cb?.onUtteranceEnd?.(...args);
          break;
        case "mediaDiscarded":
          cb?.onMediaDiscarded?.(...args);
          break;
        case "audioFrameSent":
          cb?.onAudioFrameSent?.(...args);
          break;
        case "audioBlocked":
          cb?.onAudioBlocked?.();
          break;
        case "muteChange":
          break;
        case "close":
          cb?.onClose?.(...args);
          break;
        case "error":
          cb?.onError?.(...args);
          break;
      }
    } catch (err) {
      if (this.opts.dev) console.warn(`[avatar] callbacks.${event} threw`, err);
    }
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(...args);
      } catch (err) {
        if (this.opts.dev) console.warn(`[avatar] on('${event}') handler threw`, err);
      }
    }
  }
  get state() {
    return this.sm.state;
  }
  get sessionCapSeconds() {
    return this._sessionCapSeconds;
  }
  /** The avatar_versions.id the box bound, echoed in the accept (the persona-pinning ack). */
  get personaKey() {
    return this._personaKey;
  }
  // Returns the live stream so callers can pass it back via opts.permittedStream,
  // avoiding a second getUserMedia call (and second permission prompt on Firefox).
  static ensureMicPermission() {
    return MicPipeline.ensurePermission();
  }
  /** Whether this browser can play the fMP4 video channel. Poster-mode sessions (audio + still)
   *  work regardless — the hello simply doesn't offer video. */
  static mediaSupported() {
    return MsePlayer.supported();
  }
  /**
   * Everything that must be true before spending a fleet seat, in one call: microphone permission,
   * MSE support, and the browser gate — returning a classified result instead of a raw
   * DOMException.
   *
   * Hold the returned `stream` and pass it as `permittedStream` so the session does not call
   * getUserMedia twice (a second permission prompt on Firefox). `video: false` means poster mode
   * is the only option here; that is a degradation, not a failure, so `ok` stays true.
   *
   * ```ts
   * const pre = await AvatarSession.preflight();
   * if (!pre.ok) return showError(COPY.errors[pre.error.kind] ?? COPY.errors.generic);
   * new AvatarSession({ permittedStream: pre.stream ?? undefined, ... });
   * ```
   */
  static async preflight(options = {}) {
    const wantsMic = options.mic !== false;
    const video = MsePlayer.supported();
    if (!wantsMic) {
      return { ok: true, stream: null, video };
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        error: new AvatarError(
          "unsupported-browser",
          "this browser does not support microphone capture"
        )
      };
    }
    try {
      const stream = await MicPipeline.ensurePermission();
      return { ok: true, stream, video };
    } catch (err) {
      return { ok: false, error: toAvatarError(err, classifyMicError(err)) };
    }
  }
  start() {
    if (this.done || this.sm.state !== "idle") return Promise.resolve();
    this.sm.set("waiting");
    this.opts.connect.connect({
      onReady: (target) => {
        if (this.done) return;
        this._sessionCapSeconds = target.sessionCapSeconds;
        this.sm.set("ready");
        void this.openSession(target);
      },
      onEnded: (reason) => {
        this.internalEnd(reason);
      },
      onError: (err) => {
        this.internalFail(err);
      }
    });
    return Promise.resolve();
  }
  async openSession(target) {
    if (this.done) return;
    this.sm.set("connecting");
    try {
      await this.opts.prewarm?.();
    } catch {
    }
    if (this.done) return;
    const dev = this.opts.dev ?? false;
    const streamForMic = this.permittedStream;
    this.permittedStream = null;
    this.driver = new V2Driver({
      videoEl: this.opts.videoEl,
      sessionWsUrl: target.sessionWsUrl,
      mic: this.opts.mic !== false,
      langs: this.langs,
      responseLanguage: this._responseLanguage,
      workletUrl: this.opts.workletUrl ?? "/mic-worklet.js",
      permittedStream: streamForMic ?? void 0,
      dev,
      createSocket: this.opts.createSocket,
      handlers: {
        onAccept: (info) => {
          if (this.done) return;
          this._sessionCapSeconds = info.capSeconds;
          this._personaKey = info.personaKey;
        },
        onFirstFrame: () => {
          if (this.done) return;
          const s = this.sm.state;
          if (s === "connecting" || s === "ready") {
            this.sm.set("live");
            this.emit("firstFrame");
          }
        },
        onMicReady: () => {
          if (this.done) return;
          if (this.micMuted) this.driver?.setMuted(true);
          this.emit("micReady");
        },
        onPartial: (text) => {
          if (!this.done) this.emit("partial", text);
        },
        onTurn: (turn) => {
          if (!this.done) this.emit("turn", turn);
        },
        onSpeechStart: (id) => {
          if (!this.done) this.emit("speechStart", id);
        },
        onSpeechEnd: (id) => {
          if (!this.done) this.emit("speechEnd", id);
        },
        onUtteranceStart: (utterance) => {
          if (!this.done) this.emit("utteranceStart", utterance);
        },
        onUtteranceText: (utterance) => {
          if (!this.done) this.emit("utteranceText", utterance);
        },
        onUtteranceEnd: (utterance) => {
          if (!this.done) this.emit("utteranceEnd", utterance);
        },
        onMediaDiscarded: (cutoffPtsUs) => {
          if (!this.done) this.emit("mediaDiscarded", cutoffPtsUs);
        },
        onAudioFrameSent: (info) => {
          if (!this.done) this.emit("audioFrameSent", info);
        },
        onAudioBlocked: () => {
          if (!this.done) this.emit("audioBlocked");
        },
        onEnded: (reason) => {
          this.internalEnd(reason);
        },
        onError: (err, terminal) => {
          if (terminal) {
            this.internalFail(err);
          } else {
            if (dev) console.warn("[v2] session error", err);
            if (!this.done) this.emit("error", err);
          }
        }
      }
    });
    this.driver.connect();
  }
  leave() {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set("idle");
    this.emit("close", "generic");
  }
  /** The user's choice — what a mute button sets. Survives `suppressMic`. */
  setMuted(muted) {
    this._userMuted = muted;
    this.applyMic();
  }
  /**
   * Hold the microphone closed without changing the user's choice, and release it back to
   * whatever they had set. Use this around app-driven turns rather than calling `setMuted(true)`
   * then `setMuted(previous)` — that pattern loses the user's intent whenever the two interleave,
   * and it fights any UI bound to the mute state.
   */
  suppressMic(suppressed) {
    this._micSuppressed = suppressed;
    this.applyMic();
  }
  /** What the user chose, ignoring any active suppression. */
  get userMuted() {
    return this._userMuted;
  }
  /** Whether the application is currently holding the mic closed. */
  get micSuppressed() {
    return this._micSuppressed;
  }
  /** What the wire is actually doing: the user's choice OR an active suppression. */
  get micMuted() {
    return this._userMuted || this._micSuppressed;
  }
  applyMic() {
    this.driver?.setMuted(this.micMuted);
    this.emit("muteChange", {
      userMuted: this._userMuted,
      suppressed: this._micSuppressed,
      effective: this.micMuted
    });
  }
  /** Send a typed user turn through the session socket. Resolves with the box's reply. */
  sendText(text) {
    const driver = this.driver;
    if (!driver) return Promise.reject(new Error("text transport is unavailable"));
    return driver.sendText(text);
  }
  /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
   *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
  unmuteAudio() {
    return this.driver?.unmuteAudio() ?? true;
  }
  /** Avatar voice still queued to play, in ms, or `null` when this session has no playout clock
   *  to ask — a video session or one that has not accepted yet. `null` is "unknown", not "none".
   *
   *  Intended for `attachCaptions`'s `remainingVoiceMs`, which needs to know how much voice is
   *  left when an utterance ends so it can time the words it has not revealed yet. */
  bufferedVoiceMs() {
    return this.driver?.bufferedVoiceMs() ?? null;
  }
  /** Current local playout position on the server media timeline. Null before playback starts. */
  playedPtsUs() {
    return this.driver?.playedPtsUs() ?? null;
  }
  /** Call synchronously inside the click/tap handler that starts a call, BEFORE any await:
   *  a user-gestured play()/load() clears WebKit's per-element gesture restrictions so the
   *  SDK's scripted unmute isn't answered with a pause on iOS Safari (which otherwise turns
   *  the first call in a fresh browsing context into a muted ~2fps slideshow). */
  static primeVideoElement(video) {
    try {
      video.muted = true;
      void video.play().catch(() => {
      });
      video.load();
    } catch {
    }
  }
  /** Change the ASR recognition language(s) — applies live mid-session and persists for the
   *  session. [] = auto-detect across the box's configured set. */
  setLangs(langs) {
    this.langs = langs;
    this.driver?.setLangs(langs);
  }
  get asrLangs() {
    return this.langs;
  }
  /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
   *  own choice). Applies from the next turn and persists for the session. Distinct from
   *  setLangs (ASR recognition pin). */
  setResponseLanguage(lang) {
    this._responseLanguage = lang;
    this.driver?.setResponseLanguage(lang);
  }
  /** Replace hidden system-level guidance for subsequent turns. Unlike sendText(), this does not
   *  create a user message, request an immediate response, or surface in transcript callbacks. */
  setRuntimeInstruction(instruction) {
    this.driver?.setRuntimeInstruction(instruction);
  }
  get responseLanguage() {
    return this._responseLanguage;
  }
  destroy() {
    this.done = true;
    this.teardown();
  }
  internalEnd(reason) {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set("ended");
    this.emit("close", reason);
  }
  internalFail(err) {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set("error");
    this.emit("error", toAvatarError(err, "connect"));
  }
  teardown() {
    this.opts.connect.close();
    this.driver?.stop();
    this.driver = null;
    this.permittedStream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.permittedStream = null;
  }
};

// src/session-ui.ts
var PART_CLASS = {
  disclosure: "casola-session-ui__disclosure",
  controls: "casola-session-ui__controls",
  captions: "casola-session-ui__captions"
};
var attached4 = /* @__PURE__ */ new WeakMap();
function optionsFor(value) {
  if (value === false) return null;
  if (value === void 0 || value === true) return {};
  return value;
}
function attachSessionUI(container, initial = {}) {
  attached4.get(container)?.destroy();
  const document2 = container.ownerDocument;
  let destroyed = false;
  let unbind = null;
  let liveOverride = null;
  let name = initial.name;
  let recording = initial.recording ?? true;
  const mount = (part) => {
    const el = document2.createElement("div");
    el.className = PART_CLASS[part];
    container.appendChild(el);
    return el;
  };
  const disclosureOpts = optionsFor(initial.disclosure);
  const controlsOpts = optionsFor(initial.controls);
  const captionsOpts = optionsFor(initial.captions);
  const disclosure = disclosureOpts ? attachDisclosure(mount("disclosure"), {
    name,
    recording,
    visible: false,
    ...disclosureOpts
  }) : null;
  const controls = controlsOpts ? attachSessionControls(mount("controls"), {
    visible: false,
    ...controlsOpts,
    onHangup: controlsOpts.onHangup ?? initial.onHangup,
    onError: controlsOpts.onError ?? initial.onError
  }) : null;
  const captions = captionsOpts ? attachCaptions(mount("captions"), { visible: false, ...captionsOpts }) : null;
  container.classList.add("casola-session-ui");
  const isVisible = (state, session) => {
    if (liveOverride !== null) return liveOverride;
    return initial.visibleWhen ? initial.visibleWhen(state, session) : state === "live";
  };
  const controlsEnabled = (state, session) => initial.controlsEnabledWhen ? initial.controlsEnabledWhen(state, session) : isVisible(state, session);
  const applyState = (session) => {
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
      muteDisabled: session.micSuppressed || !controlsEnabled(state, session)
    });
  };
  const controller = {
    disclosure,
    controls,
    captions,
    bind(session) {
      unbind?.();
      if (destroyed) return () => {
      };
      controls?.update({ onMutedChange: (muted) => session.setMuted(muted) });
      const offs = [
        session.on("state", () => applyState(session)),
        session.on("firstFrame", () => applyState(session)),
        session.on("micReady", () => applyState(session)),
        session.on("muteChange", () => applyState(session)),
        session.on("partial", (text) => captions?.partial(text)),
        session.on("turn", (turn) => captions?.turn(turn)),
        session.on("speechStart", (id) => captions?.speechStart(id)),
        session.on("speechEnd", (id) => captions?.speechEnd(id))
      ];
      applyState(session);
      const off = () => {
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
      if (next.name !== void 0) name = next.name;
      if (next.recording !== void 0) recording = next.recording;
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
      if (attached4.get(container) === controller) attached4.delete(container);
      container.replaceChildren();
      container.classList.remove("casola-session-ui");
    }
  };
  attached4.set(container, controller);
  return controller;
}

// src/styles.ts
var SESSION_UI_CSS = `
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

/* \u2500\u2500 captions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

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

/* In-progress ASR: a fainter bubble, not a faded one \u2014 element opacity is reserved for the
   fade-out below, and stacking the two makes partial\u2192committed jump. */
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

/* \u2500\u2500 controls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

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

/* \u2500\u2500 disclosure \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

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

/* Red, and always beside the word REC \u2014 colour must never be the only carrier of the notice. */
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
function adoptSessionUIStyles(root) {
  const supportsConstructable = typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype && "adoptedStyleSheets" in root;
  if (supportsConstructable) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SESSION_UI_CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return () => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }
  const doc = root instanceof Document ? root : root.ownerDocument ?? document;
  const style = doc.createElement("style");
  style.textContent = SESSION_UI_CSS;
  (root instanceof Document ? root.head ?? root.body : root).appendChild(style);
  return () => style.remove();
}
export {
  AvatarError,
  AvatarSession,
  CloseCode,
  SESSION_UI_CSS,
  SUBPROTOCOL,
  UtteranceScheduler,
  adoptSessionUIStyles,
  attachCaptions,
  attachDisclosure,
  attachSessionControls,
  attachSessionUI,
  classifyMicError,
  connectViaToken,
  isMicError
};
//# sourceMappingURL=index.js.map
