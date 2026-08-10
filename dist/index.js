var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/connect/token.ts
function connectViaToken(o) {
  const msePath = o.edgePaths?.mse ?? "/mse";
  const micPath = o.edgePaths?.micStream ?? "/mic_stream";
  function toWss(base, path) {
    const u = new URL(path, base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    if (o.sessionToken) u.searchParams.set("token", o.sessionToken);
    return u.toString();
  }
  return {
    connect(h) {
      h.onReady({
        mseWsUrl: toWss(o.connectUrl, msePath),
        micWsUrl: toWss(o.connectUrl, micPath),
        sessionCapSeconds: o.sessionCapSeconds
      });
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
var attached = /* @__PURE__ */ new WeakMap();
function resolve(initial) {
  return {
    visible: initial.visible ?? true,
    mute: initial.mute ?? true,
    hangup: initial.hangup ?? true,
    muted: initial.muted ?? false,
    muteDisabled: initial.muteDisabled ?? false,
    hangupDisabled: initial.hangupDisabled ?? false,
    ending: initial.ending ?? false,
    label: initial.label?.trim() || "Call controls",
    labels: { ...DEFAULT_LABELS, ...initial.labels },
    onMutedChange: initial.onMutedChange,
    onHangup: initial.onHangup,
    onError: initial.onError
  };
}
function buttonLabel(document, className, text) {
  const label = document.createElement("span");
  label.className = className;
  label.textContent = text;
  return label;
}
function attachSessionControls(target, initial = {}) {
  attached.get(target)?.destroy();
  let options = resolve(initial);
  let destroyed = false;
  const render = () => {
    if (destroyed) return;
    const document = target.ownerDocument;
    const children = [];
    if (options.mute) {
      const label = options.muted ? options.labels.unmute : options.labels.mute;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "casola-session-controls__mute";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(options.muted));
      button.disabled = options.ending || options.muteDisabled || !options.onMutedChange;
      button.appendChild(buttonLabel(document, "casola-session-controls__mute-label", label));
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
      const button = document.createElement("button");
      button.type = "button";
      button.className = "casola-session-controls__hangup";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-busy", String(options.ending));
      button.disabled = options.ending || options.hangupDisabled || !options.onHangup;
      button.appendChild(buttonLabel(document, "casola-session-controls__hangup-label", label));
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
        label: next.label?.trim() || (next.label === void 0 ? options.label : "Call controls"),
        labels: next.labels ? { ...options.labels, ...next.labels } : options.labels
      };
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attached.get(target) === controller) attached.delete(target);
      target.replaceChildren();
      target.classList.remove("casola-session-controls");
      target.removeAttribute("role");
      target.removeAttribute("aria-label");
      target.removeAttribute("data-muted");
      target.removeAttribute("data-ending");
      target.hidden = true;
    }
  };
  attached.set(target, controller);
  render();
  return controller;
}

// src/disclosure.ts
var attached2 = /* @__PURE__ */ new WeakMap();
function clean(value) {
  return value?.trim() ?? "";
}
function detailsFrom(value) {
  return (typeof value === "string" ? [value] : value ?? []).map((part) => part.trim()).filter(Boolean);
}
function textSpan(document, className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}
function attachDisclosure(target, initial = {}) {
  attached2.get(target)?.destroy();
  let options = {
    name: initial.name,
    recording: initial.recording ?? true,
    details: initial.details,
    visible: initial.visible ?? true
  };
  let destroyed = false;
  const render = () => {
    if (destroyed) return;
    const document = target.ownerDocument;
    const visualSegments = [];
    const accessibleSegments = [];
    if (options.recording) {
      const recording = document.createElement("span");
      recording.className = "casola-disclosure__recording-group";
      const dot = document.createElement("span");
      dot.className = "casola-disclosure__recording-dot";
      dot.setAttribute("aria-hidden", "true");
      recording.replaceChildren(dot, textSpan(document, "casola-disclosure__recording", "REC"));
      visualSegments.push(recording);
      accessibleSegments.push("Recording");
    }
    visualSegments.push(textSpan(document, "casola-disclosure__ai", "AI"));
    accessibleSegments.push("AI");
    const name = clean(options.name);
    if (name) {
      visualSegments.push(textSpan(document, "casola-disclosure__name", name));
      accessibleSegments.push(name);
    }
    for (const detail of detailsFrom(options.details)) {
      visualSegments.push(textSpan(document, "casola-disclosure__detail", detail));
      accessibleSegments.push(detail);
    }
    const children = [];
    for (const [index, segment] of visualSegments.entries()) {
      if (index > 0) {
        const separator = textSpan(document, "casola-disclosure__separator", "\xB7");
        separator.setAttribute("aria-hidden", "true");
        children.push(separator);
      }
      children.push(segment);
    }
    target.replaceChildren(...children);
    target.classList.add("casola-disclosure");
    target.removeAttribute("aria-hidden");
    target.setAttribute("aria-label", accessibleSegments.join(" \xB7 "));
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
      if (attached2.get(target) === controller) attached2.delete(target);
      target.replaceChildren();
      target.classList.remove("casola-disclosure");
      target.removeAttribute("aria-label");
      target.removeAttribute("data-recording");
      target.hidden = true;
    }
  };
  attached2.set(target, controller);
  render();
  return controller;
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

// src/mic-frame-header.ts
var MIC_FRAME_HEADER_VERSION = 1;
var MIC_FRAME_HEADER_BYTES = 20;
var MIC_FRAME_MAGIC = 51792;
var VIDEO_MEDIA_TIME_UNKNOWN = 4294967295;
function encodeMicFrameHeader(header) {
  const bytes = new Uint8Array(MIC_FRAME_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, MIC_FRAME_MAGIC, true);
  view.setUint8(2, header.version);
  view.setUint8(3, 0);
  view.setUint32(4, header.micSeq, true);
  view.setUint32(8, header.videoMediaTimeMs, true);
  view.setFloat64(12, header.captureEpochMs, true);
  return bytes;
}

// src/pcm-downlink.ts
var PCM_DOWNLINK_MAGIC = 51793;
var PCM_DOWNLINK_VERSION = 1;
var PCM_DOWNLINK_HEADER_BYTES = 12;
function decodePcmDownlinkFrame(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < PCM_DOWNLINK_HEADER_BYTES || (bytes.byteLength - PCM_DOWNLINK_HEADER_BYTES) % 2 !== 0) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== PCM_DOWNLINK_MAGIC || view.getUint8(2) !== PCM_DOWNLINK_VERSION || view.getUint8(3) !== 0) {
    return null;
  }
  const payload = bytes.slice(PCM_DOWNLINK_HEADER_BYTES);
  return {
    sequence: view.getUint32(4, true),
    sampleRate: view.getUint32(8, true),
    pcm: new Int16Array(payload.buffer, payload.byteOffset, payload.byteLength / 2)
  };
}

// src/pcm-player.ts
var PcmPlayer = class {
  constructor(onBlocked) {
    this.onBlocked = onBlocked;
    __publicField(this, "ctx", null);
    __publicField(this, "nextStart", 0);
    __publicField(this, "sources", /* @__PURE__ */ new Set());
    __publicField(this, "blocked", false);
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
    source.addEventListener("ended", () => this.sources.delete(source));
    this.sources.add(source);
    const startAt = Math.max(ctx.currentTime + 0.04, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + audio.duration;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        if (!this.blocked) {
          this.blocked = true;
          this.onBlocked?.();
        }
      });
    }
  }
  flush() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
      }
    }
    this.sources.clear();
    this.nextStart = this.ctx?.currentTime ?? 0;
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
    void this.ctx?.close().catch(() => {
    });
    this.ctx = null;
  }
  ensureContext() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }
};

// src/mic-capture.ts
var TARGET_RATE = 16e3;
var FRAME_SAMPLES = 1600;
var PREROLL_FRAMES = 20;
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
var MicCapture = class {
  constructor() {
    __publicField(this, "ctx", null);
    __publicField(this, "stream", null);
    __publicField(this, "node", null);
    __publicField(this, "sink", null);
    __publicField(this, "ws", null);
    __publicField(this, "player", null);
    __publicField(this, "wsReady", null);
    __publicField(this, "resolveWsReady", null);
    __publicField(this, "rejectWsReady", null);
    __publicField(this, "textSequence", 0);
    __publicField(this, "textWaiters", /* @__PURE__ */ new Map());
    __publicField(this, "handlers", {});
    __publicField(this, "inRate", 48e3);
    __publicField(this, "resTail", new Float32Array(0));
    __publicField(this, "resPos", 0);
    __publicField(this, "frame", new Int16Array(FRAME_SAMPLES));
    __publicField(this, "frameLen", 0);
    __publicField(this, "closed", false);
    __publicField(this, "muted", false);
    __publicField(this, "pcmCallCount", 0);
    // Section-2 calibration state — see computeFrameTimestamp().
    __publicField(this, "audioClockMap", new ClockMap());
    __publicField(this, "inputLatencySeconds", 0);
    __publicField(this, "frameStartContextTime", 0);
    // Named micSeq (not seq/frameSeq) — the server-side tracer already uses frame_seq for an
    // unrelated concept (the video-timeline index); this is just a monotonic per-connection
    // counter over outgoing /mic_stream frames.
    __publicField(this, "micSeq", 0);
    __publicField(this, "getVideoMediaTimeMs");
    // ASR language pin (box language NAMES, e.g. ['English'] or ['Chinese','English']).
    // [] = the box default (auto-detect across its configured set). Mutable mid-session.
    __publicField(this, "langs", []);
    // Preferred REPLY language (BCP-47). undefined = never sent (the box keeps its session
    // default, e.g. the JWT claim); '' = explicit clear. Mutable mid-session.
    __publicField(this, "responseLanguage");
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
  async start(wsUrl, lang, handlers = {}, workletUrl = "/mic-worklet.js", stream, dev = false, langs = [], responseLanguage, getVideoMediaTimeMs) {
    this.handlers = handlers;
    this.langs = langs;
    this.responseLanguage = responseLanguage;
    this.getVideoMediaTimeMs = getVideoMediaTimeMs;
    if (stream) {
      this.stream = stream;
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
    await ctx.audioWorklet.addModule(workletUrl);
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
    this.openWs(wsUrl, lang, dev, true);
  }
  /** Open only the fallback's in-band control/audio socket. This is created after `/mse`
   * advertises poster-pcm, so receive-only GPU sessions retain their legacy no-mic behavior. */
  startReceiveOnly(wsUrl, lang, handlers = {}, dev = false, langs = [], responseLanguage) {
    this.handlers = handlers;
    this.langs = langs;
    this.responseLanguage = responseLanguage;
    this.openWs(wsUrl, lang, dev, false);
  }
  openWs(wsUrl, lang, dev, sendPreroll) {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.wsReady = new Promise((resolve2, reject) => {
      this.resolveWsReady = resolve2;
      this.rejectWsReady = reject;
    });
    void this.wsReady.catch(() => {
    });
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          op: "hello",
          lang,
          langs: this.langs,
          engine: "default",
          ...this.responseLanguage !== void 0 ? { response_language: this.responseLanguage } : {},
          accept_audio: ["pcm16"]
        })
      );
      this.resolveWsReady?.();
      this.resolveWsReady = null;
      this.rejectWsReady = null;
      if (!sendPreroll) return;
      const silence = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < PREROLL_FRAMES; i++) {
        this.micSeq += 1;
        this.sendFrame(silence, {
          version: MIC_FRAME_HEADER_VERSION,
          micSeq: this.micSeq,
          videoMediaTimeMs: VIDEO_MEDIA_TIME_UNKNOWN,
          captureEpochMs: performance.timeOrigin + performance.now()
        });
      }
      this.handlers.onReady?.();
    });
    ws.addEventListener("message", (ev) => this.onServerMessage(ev));
    ws.addEventListener("error", () => {
      const error = new Error("mic socket error");
      this.rejectWsReady?.(error);
      this.rejectTextWaiters(error);
      this.handlers.onError?.(error);
    });
    ws.addEventListener("close", (ev) => {
      const error = new Error(`mic socket closed (${ev.code})`);
      this.rejectWsReady?.(error);
      this.rejectTextWaiters(error);
      if (ev.code !== 1e3) console.warn("[mic] WebSocket closed", ev.code, ev.reason);
      if (dev) console.log("[mic] WebSocket close code=", ev.code, "reason=", ev.reason);
    });
  }
  onServerMessage(ev) {
    if (typeof ev.data !== "string") {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const frame = decodePcmDownlinkFrame(ev.data);
      if (!frame) return;
      this.player ?? (this.player = new PcmPlayer(this.handlers.onAudioBlocked));
      this.player.enqueue(frame);
      return;
    }
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === "partial" && typeof m.text === "string") {
      this.handlers.onPartial?.(m.text);
    } else if (m.type === "turn" && typeof m.text === "string") {
      const turn = {
        text: m.text,
        reply: m.reply ?? "",
        language: m.language,
        speechId: m.speech_id
      };
      const waiter = m.request_id ? this.textWaiters.get(m.request_id) : void 0;
      if (waiter && m.request_id) {
        clearTimeout(waiter.timer);
        this.textWaiters.delete(m.request_id);
        waiter.resolve(turn);
      } else {
        this.handlers.onTurn?.(turn);
      }
    } else if (m.type === "audio_reset") {
      this.player?.flush();
    } else if (m.type === "error") {
      const error = new Error(m.error ?? "mic stream error");
      const waiter = m.request_id ? this.textWaiters.get(m.request_id) : void 0;
      if (waiter && m.request_id) {
        clearTimeout(waiter.timer);
        this.textWaiters.delete(m.request_id);
        waiter.reject(error);
      } else {
        this.handlers.onError?.(error);
      }
    }
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
      if (this.frameLen === FRAME_SAMPLES) this.flushFrame(dev);
      pos += ratio;
    }
    const keepFrom = Math.min(Math.floor(pos), buf.length);
    this.resTail = buf.slice(keepFrom);
    this.resPos = pos - keepFrom;
  }
  setMuted(m) {
    this.muted = m;
  }
  unmuteAudio() {
    return this.player?.unmute() ?? true;
  }
  async sendText(text) {
    const value = text.trim();
    if (!value) throw new Error("text is required");
    if (value.length > 2e3) throw new Error("text is too long");
    if (!this.wsReady) throw new Error("text transport is unavailable");
    await this.wsReady;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("text transport is unavailable");
    }
    this.textSequence += 1;
    const id = `text-${this.textSequence}`;
    const result = new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.textWaiters.delete(id);
        reject(new Error("text response timed out"));
      }, 3e4);
      this.textWaiters.set(id, { resolve: resolve2, reject, timer });
    });
    this.ws.send(JSON.stringify({ op: "text", id, text: value }));
    return result;
  }
  /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
   *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
  setLangs(langs) {
    this.langs = langs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set_langs", langs }));
    }
  }
  /** Change the preferred REPLY language mid-session (BCP-47; '' clears). Sends a
   *  {op:'set_response_language'} text frame the edge applies on the next turn; also stored so
   *  a socket reconnect's hello carries the latest pick. */
  setResponseLanguage(lang) {
    this.responseLanguage = lang;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set_response_language", language: lang }));
    }
  }
  /** Replace the hidden runtime instruction appended to the avatar's system prompt. The edge
   *  applies it from the next genuine user turn without speaking or emitting a transcript turn.
   *  An empty string clears the instruction. */
  setRuntimeInstruction(instruction) {
    const value = instruction.trim();
    if (value.length > 2e3) throw new Error("runtime instruction is too long");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set_instruction", instruction: value }));
    }
  }
  flushFrame(dev) {
    let header = null;
    if (this.ctx) {
      const ts = this.ctx.getOutputTimestamp();
      this.audioClockMap.record(
        ts.contextTime ?? this.ctx.currentTime,
        ts.performanceTime ?? performance.now()
      );
      const result = computeFrameTimestamp(
        this.frameStartContextTime,
        this.inputLatencySeconds,
        this.audioClockMap,
        this.getVideoMediaTimeMs,
        performance.timeOrigin
      );
      if (result) {
        this.micSeq += 1;
        header = { version: MIC_FRAME_HEADER_VERSION, micSeq: this.micSeq, ...result };
        this.handlers.onFrameTimestamp?.(header);
      }
    }
    if (header && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const pcm = this.muted ? new Int16Array(FRAME_SAMPLES) : this.frame.slice();
      if (dev) {
        let allZero = true;
        for (let i = 0; i < pcm.length; i++) {
          if (pcm[i] !== 0) {
            allZero = false;
            break;
          }
        }
        if (allZero && !this.muted && this.pcmCallCount <= 10) {
          console.warn(
            "[mic] flushFrame: sending all-zero frame (possible silence / rate mismatch)"
          );
        }
      }
      this.sendFrame(pcm, header);
    }
    this.frameLen = 0;
  }
  /** Prepends the wire header (section 4) to a 1600-sample PCM frame and sends it as one binary
   *  WS message. Used by both flushFrame() and the preroll send in openWs(). */
  sendFrame(pcm, header) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const wireFrame = new Uint8Array(MIC_FRAME_HEADER_BYTES + pcmBytes.byteLength);
    wireFrame.set(encodeMicFrameHeader(header), 0);
    wireFrame.set(pcmBytes, MIC_FRAME_HEADER_BYTES);
    this.ws.send(wireFrame);
  }
  stop() {
    this.closed = true;
    this.rejectTextWaiters(new Error("mic transport stopped"));
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
    this.player?.stop();
    this.player = null;
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
  rejectTextWaiters(error) {
    for (const waiter of this.textWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.textWaiters.clear();
  }
};

// src/mse-player.ts
function getMediaSourceCtor() {
  const w = window;
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}
var MsePlayer = class {
  constructor(video, dev = false) {
    this.video = video;
    this.dev = dev;
    __publicField(this, "ms", null);
    __publicField(this, "sb", null);
    __publicField(this, "ws", null);
    __publicField(this, "pcmPlayer", null);
    __publicField(this, "mime", null);
    __publicField(this, "pending", []);
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
    __publicField(this, "rvfcHandle", null);
  }
  static supported() {
    return getMediaSourceCtor() !== null;
  }
  fireFirstFrame() {
    if (this.firstFrameFired) return;
    this.firstFrameFired = true;
    this.handlers.onFirstFrame?.();
  }
  connect(wsUrl, handlers = {}) {
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
    this.openWs(wsUrl);
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
      this.scheduleFrameCallback();
    });
  }
  /** Interpolated avatar-video media-timeline position (ms) at a given performance.now()-domain
   *  instant, from the rVFC-sampled calibration above (see ClockMap for the seek/playbackRate-
   *  change handling). Returns null before the first displayed frame. */
  mediaTimeAt(performanceTimeMs) {
    return this.mediaTimeMap.at(performanceTimeMs);
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
    const pcm = this.pcmPlayer?.unmute() ?? true;
    return !v.muted && pcm;
  }
  openWs(wsUrl) {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("message", (ev) => this.onMessage(ev));
    ws.addEventListener("close", () => {
      if (!this.closed) this.handlers.onClose?.();
    });
    ws.addEventListener("error", () => this.handlers.onError?.(new Error("mse socket error")));
  }
  onMessage(ev) {
    if (typeof ev.data === "string") {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "session_ended") {
          this.handlers.onEnded?.(m.reason ?? "generic");
          return;
        }
        if (m.mode === "poster-pcm") {
          if (m.poster_url) this.video.poster = m.poster_url;
          this.handlers.onMode?.(m.mode);
          this.fireFirstFrame();
          return;
        }
        if (m.type === "audio_reset") {
          this.pcmPlayer?.flush();
          return;
        }
        if (m.mime) {
          this.mime = m.mime;
          this.trySetup();
        }
      } catch {
      }
      return;
    }
    const pcm = decodePcmDownlinkFrame(ev.data);
    if (pcm) {
      this.pcmPlayer ?? (this.pcmPlayer = new PcmPlayer(() => this.setAudioBlocked()));
      this.pcmPlayer.enqueue(pcm);
      return;
    }
    this.pending.push(new Uint8Array(ev.data));
    this.drain();
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
      sb.addEventListener("updateend", () => this.drain());
      this.sb = sb;
      this.drain();
    } catch (e) {
      this.handlers.onError?.(e);
    }
  }
  drain() {
    const sb = this.sb;
    if (!sb || sb.updating || !this.streaming) return;
    const next = this.pending.shift();
    if (next === void 0) {
      this.housekeep(false);
      return;
    }
    try {
      sb.appendBuffer(next);
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
      this.ws?.close();
    } catch {
    }
    this.ws = null;
    this.pcmPlayer?.stop();
    this.pcmPlayer = null;
    try {
      if (this.ms && this.ms.readyState === "open") this.ms.endOfStream();
    } catch {
    }
    this.pending.length = 0;
    this.sb = null;
    this.ms = null;
    for (const [ev, fn] of this.watchdogListeners) {
      this.video.removeEventListener(ev, fn);
    }
    this.watchdogListeners = [];
    try {
      this.video.removeAttribute("src");
      this.video.srcObject = null;
      this.video.load();
    } catch {
    }
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

// src/session.ts
var AvatarSession = class {
  constructor(opts) {
    this.opts = opts;
    __publicField(this, "sm");
    __publicField(this, "mse", null);
    __publicField(this, "mic", null);
    __publicField(this, "done", false);
    __publicField(this, "_sessionCapSeconds");
    __publicField(this, "permittedStream");
    __publicField(this, "langs");
    __publicField(this, "_responseLanguage");
    __publicField(this, "fallbackInBandText", false);
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      opts.callbacks?.onStateChange?.(next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
    this._responseLanguage = opts.responseLanguage;
  }
  get state() {
    return this.sm.state;
  }
  get sessionCapSeconds() {
    return this._sessionCapSeconds;
  }
  // Returns the live stream so callers can pass it back via opts.permittedStream,
  // avoiding a second getUserMedia call (and second permission prompt on Firefox).
  static ensureMicPermission() {
    return MicCapture.ensurePermission();
  }
  static mediaSupported() {
    return MsePlayer.supported();
  }
  start() {
    if (this.done || this.sm.state !== "idle") return Promise.resolve();
    this.sm.set("waiting");
    this.opts.connect.connect({
      onStatus: (s) => {
        this.opts.callbacks?.onQueueStatus?.(s);
      },
      onReady: (target) => {
        if (this.done) return;
        this._sessionCapSeconds = target.sessionCapSeconds;
        this.sm.set("ready");
        void this.openMedia(target);
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
  async openMedia(target) {
    if (this.done) return;
    this.sm.set("connecting");
    try {
      await this.opts.prewarm?.();
    } catch {
    }
    if (this.done) return;
    const dev = this.opts.dev ?? false;
    this.mse = new MsePlayer(this.opts.videoEl, dev);
    this.mse.connect(target.mseWsUrl, {
      onMode: (mode) => {
        if (mode !== "poster-pcm") return;
        this.fallbackInBandText = true;
        if (this.opts.mic === false && !this.mic) {
          this.openReceiveOnlyTransport(target, dev);
        }
      },
      onFirstFrame: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === "connecting" || s === "ready") {
          this.sm.set("live");
          this.opts.callbacks?.onFirstFrame?.();
        }
      },
      onAudioBlocked: () => {
        if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
      },
      onClose: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === "live" || s === "connecting") this.internalEnd("edge_disconnect");
      },
      onEnded: (reason) => {
        this.internalEnd(reason);
      },
      onError: (err) => {
        if (dev) console.warn("[mse] error", err);
      }
    });
    if (this.opts.mic !== false) {
      const streamForMic = this.permittedStream;
      this.permittedStream = null;
      this.mic = new MicCapture();
      try {
        await this.mic.start(
          target.micWsUrl,
          this.opts.lang ?? "en",
          {
            onReady: () => {
              if (!this.done) this.opts.callbacks?.onMicReady?.();
            },
            onPartial: (text) => {
              if (!this.done) this.opts.callbacks?.onPartial?.(text);
            },
            onTurn: (turn) => {
              if (!this.done) this.opts.callbacks?.onTurn?.(turn);
            },
            onFrameTimestamp: (info) => {
              if (!this.done) this.opts.callbacks?.onAudioFrameSent?.(info);
            },
            onError: (err) => {
              if (dev) console.warn("[mic] error", err);
              if (!this.done) this.opts.callbacks?.onError?.(err);
            },
            onAudioBlocked: () => {
              if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
            }
          },
          this.opts.workletUrl ?? "/mic-worklet.js",
          streamForMic ?? void 0,
          dev,
          this.langs,
          this._responseLanguage,
          (t) => this.mse?.mediaTimeAt(t) ?? null
        );
      } catch (err) {
        this.internalFail(err);
      }
    }
  }
  openReceiveOnlyTransport(target, dev) {
    if (this.done || this.mic) return;
    this.mic = new MicCapture();
    this.mic.startReceiveOnly(
      target.micWsUrl,
      this.opts.lang ?? "en",
      {
        onPartial: (text) => {
          if (!this.done) this.opts.callbacks?.onPartial?.(text);
        },
        onTurn: (turn) => {
          if (!this.done) this.opts.callbacks?.onTurn?.(turn);
        },
        onError: (err) => {
          if (dev) console.warn("[mic] receive-only error", err);
          if (!this.done) this.opts.callbacks?.onError?.(err);
        },
        onAudioBlocked: () => {
          if (!this.done) this.opts.callbacks?.onAudioBlocked?.();
        }
      },
      dev,
      this.langs,
      this._responseLanguage
    );
  }
  leave() {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set("idle");
    this.opts.callbacks?.onClose?.("generic");
  }
  setMuted(muted) {
    this.mic?.setMuted(muted);
  }
  /** Send a typed user turn through the active session. Workers fallback sessions use their
   *  in-band WebSocket; GPU sessions use the optional application-supplied textTransport. */
  async sendText(text) {
    const value = text.trim();
    if (!value) throw new Error("text is required");
    if (this.fallbackInBandText) {
      if (!this.mic) throw new Error("fallback text transport is not ready");
      return this.mic.sendText(value);
    }
    if (!this.opts.textTransport) throw new Error("text transport is unavailable");
    const reply = await this.opts.textTransport(value);
    return { text: value, reply };
  }
  /** Unmute avatar audio from a user-gesture context (tap-for-sound button). Returns whether
   *  audio is now unblocked. Pair with callbacks.onAudioBlocked. */
  unmuteAudio() {
    const mse = this.mse?.unmuteAudio() ?? true;
    const pcm = this.mic?.unmuteAudio() ?? true;
    return mse && pcm;
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
   *  session (and any socket reconnect). [] = auto-detect across the box's configured set. */
  setLangs(langs) {
    this.langs = langs;
    this.mic?.setLangs(langs);
  }
  get asrLangs() {
    return this.langs;
  }
  /** Change the avatar's preferred REPLY language mid-session (BCP-47; '' = back to the LLM's
   *  own choice). Applies from the next turn and persists for the session (and any socket
   *  reconnect). Distinct from setLangs (ASR recognition pin). */
  setResponseLanguage(lang) {
    this._responseLanguage = lang;
    this.mic?.setResponseLanguage(lang);
  }
  /** Replace hidden system-level guidance for subsequent turns. Unlike sendText(), this does not
   *  create a user message, request an immediate response, or surface in transcript callbacks. */
  setRuntimeInstruction(instruction) {
    this.mic?.setRuntimeInstruction(instruction);
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
    this.opts.callbacks?.onClose?.(reason);
  }
  internalFail(err) {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.sm.set("error");
    this.opts.callbacks?.onError?.(err);
  }
  teardown() {
    this.opts.connect.close();
    this.mse?.stop();
    this.mse = null;
    this.mic?.stop();
    this.mic = null;
    this.permittedStream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.permittedStream = null;
  }
};
export {
  AvatarSession,
  attachDisclosure,
  attachSessionControls,
  connectViaToken
};
//# sourceMappingURL=index.js.map
