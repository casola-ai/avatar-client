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

// src/mic-capture.ts
var TARGET_RATE = 16e3;
var FRAME_SAMPLES = 1600;
var PREROLL_FRAMES = 20;
function clamp16(x) {
  const v = Math.round(x * 32767);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}
var MicCapture = class {
  constructor() {
    __publicField(this, "ctx", null);
    __publicField(this, "stream", null);
    __publicField(this, "node", null);
    __publicField(this, "sink", null);
    __publicField(this, "ws", null);
    __publicField(this, "handlers", {});
    __publicField(this, "inRate", 48e3);
    __publicField(this, "resTail", new Float32Array(0));
    __publicField(this, "resPos", 0);
    __publicField(this, "frame", new Int16Array(FRAME_SAMPLES));
    __publicField(this, "frameLen", 0);
    __publicField(this, "closed", false);
    __publicField(this, "muted", false);
    __publicField(this, "pcmCallCount", 0);
    // ASR language pin (box language NAMES, e.g. ['English'] or ['Chinese','English']).
    // [] = the box default (auto-detect across its configured set). Mutable mid-session.
    __publicField(this, "langs", []);
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
  async start(wsUrl, lang, handlers = {}, workletUrl = "/mic-worklet.js", stream, dev = false, langs = []) {
    this.handlers = handlers;
    this.langs = langs;
    if (stream) {
      this.stream = stream;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        video: false
      });
    }
    const track = this.stream.getAudioTracks()[0];
    const nativeRate = track?.getSettings().sampleRate;
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
        track?.getSettings()
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
    node.port.onmessage = (e) => this.onPcm(e.data, dev);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(node).connect(sink).connect(ctx.destination);
    this.openWs(wsUrl, lang, dev);
  }
  openWs(wsUrl, lang, dev) {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ op: "hello", lang, langs: this.langs, engine: "default" }));
      const silence = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < PREROLL_FRAMES; i++) ws.send(silence.slice());
    });
    ws.addEventListener("message", (ev) => this.onServerMessage(ev));
    ws.addEventListener("error", () => {
      this.handlers.onError?.(new Error("mic socket error"));
    });
    ws.addEventListener("close", (ev) => {
      if (ev.code !== 1e3) console.warn("[mic] WebSocket closed", ev.code, ev.reason);
      if (dev) console.log("[mic] WebSocket close code=", ev.code, "reason=", ev.reason);
    });
  }
  onServerMessage(ev) {
    if (typeof ev.data !== "string") return;
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === "partial" && typeof m.text === "string") {
      this.handlers.onPartial?.(m.text);
    } else if (m.type === "turn" && typeof m.text === "string") {
      this.handlers.onTurn?.({
        text: m.text,
        reply: m.reply ?? "",
        language: m.language,
        speechId: m.speech_id
      });
    } else if (m.type === "error") {
      this.handlers.onError?.(new Error(m.error ?? "mic stream error"));
    }
  }
  onPcm(chunk, dev) {
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
    const buf = new Float32Array(this.resTail.length + chunk.length);
    buf.set(this.resTail, 0);
    buf.set(chunk, this.resTail.length);
    let pos = this.resPos;
    for (; ; ) {
      const i = Math.floor(pos);
      if (i + 1 >= buf.length) break;
      const f = pos - i;
      const sample = (buf[i] ?? 0) * (1 - f) + (buf[i + 1] ?? 0) * f;
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
  /** Re-pin the ASR recognition language(s) mid-session. Sends a {op:'set_langs'} text frame the
   *  edge applies on the next turn; also stored so a socket reconnect carries the latest pick. */
  setLangs(langs) {
    this.langs = langs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set_langs", langs }));
    }
  }
  flushFrame(dev) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = this.muted ? new Int16Array(FRAME_SAMPLES) : this.frame.slice();
      if (dev) {
        let allZero = true;
        for (let i = 0; i < payload.length; i++) {
          if (payload[i] !== 0) {
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
      this.ws.send(payload);
    }
    this.frameLen = 0;
  }
  stop() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
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
  }
  static supported() {
    return getMediaSourceCtor() !== null;
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
    const fireFirst = () => {
      if (this.firstFrameFired) return;
      this.firstFrameFired = true;
      this.handlers.onFirstFrame?.();
    };
    const fireFirstIfPlaying = () => {
      if (this.firstFrameFired) return;
      if (!this.video.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.firstFrameFired = true;
        this.handlers.onFirstFrame?.();
      }
    };
    this.video.addEventListener("playing", fireFirst);
    this.video.addEventListener("timeupdate", fireFirstIfPlaying);
    this.video.addEventListener("loadeddata", fireFirstIfPlaying);
    this.video.addEventListener("canplay", fireFirstIfPlaying);
    this.openWs(wsUrl);
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
        if (m.mime) {
          this.mime = m.mime;
          this.trySetup();
        }
      } catch {
      }
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
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
    try {
      if (this.ms && this.ms.readyState === "open") this.ms.endOfStream();
    } catch {
    }
    this.pending.length = 0;
    this.sb = null;
    this.ms = null;
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
    this.sm = new StateMachine(opts.dev ?? false);
    this.sm.onChange((next, prev) => {
      opts.callbacks?.onStateChange?.(next, prev);
    });
    this.permittedStream = opts.permittedStream ?? null;
    this.langs = opts.langs ?? [];
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
      onFirstFrame: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === "connecting" || s === "ready") {
          this.sm.set("live");
          this.opts.callbacks?.onFirstFrame?.();
        }
      },
      onClose: () => {
        if (this.done) return;
        const s = this.sm.state;
        if (s === "live" || s === "connecting") this.internalEnd("edge_disconnect");
      },
      onError: (err) => {
        if (dev) console.warn("[mse] error", err);
      }
    });
    const streamForMic = this.permittedStream;
    this.permittedStream = null;
    this.mic = new MicCapture();
    try {
      await this.mic.start(
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
            if (dev) console.warn("[mic] error", err);
          }
        },
        this.opts.workletUrl ?? "/mic-worklet.js",
        streamForMic ?? void 0,
        dev,
        this.langs
      );
    } catch (err) {
      this.internalFail(err);
    }
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
  /** Change the ASR recognition language(s) — applies live mid-session and persists for the
   *  session (and any socket reconnect). [] = auto-detect across the box's configured set. */
  setLangs(langs) {
    this.langs = langs;
    this.mic?.setLangs(langs);
  }
  get asrLangs() {
    return this.langs;
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
  connectViaToken
};
//# sourceMappingURL=index.js.map
