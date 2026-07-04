/**
 * mic-worklet.ts — AudioWorkletProcessor `mic-fwd`.
 *
 * Runs on the audio render thread. It does the minimum: forward each raw mono
 * float frame (one render quantum, typically 128 samples at the context rate) to
 * the main thread, which resamples 48k→16k and batches into 1600-sample PCM16
 * frames for /mic_stream. Bundled to its own /mic-worklet.js and loaded via
 * `audioWorklet.addModule()`.
 */
declare class MicForwardProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][]): boolean;
}
