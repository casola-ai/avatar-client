"use strict";
(() => {
  // src/worklet/mic-worklet.ts
  var MicForwardProcessor = class extends AudioWorkletProcessor {
    process(inputs) {
      const channel = inputs[0]?.[0];
      if (channel?.length) {
        const copy = channel.slice();
        this.port.postMessage(copy, [copy.buffer]);
      }
      return true;
    }
  };
  registerProcessor("mic-fwd", MicForwardProcessor);
})();
//# sourceMappingURL=mic-worklet.js.map
