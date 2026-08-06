/**
 * mic-worklet.ts — AudioWorkletProcessor `mic-fwd`.
 *
 * Runs on the audio render thread. It does the minimum: forward each raw mono
 * float frame (one render quantum, typically 128 samples at the context rate) to
 * the main thread, which resamples 48k→16k and batches into 1600-sample PCM16
 * frames for /mic_stream. Bundled to its own /mic-worklet.js and loaded via
 * `audioWorklet.addModule()`.
 *
 * Posts `contextTime` (the AudioContext time of this quantum's first sample) alongside the raw
 * samples — the render thread is the only place this is known precisely; the main thread can't
 * recover it later since audio delivery there is jittery relative to the audio clock (see
 * specs/av-sync-timestamps-notes.md section 2).
 */
declare class MicForwardProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][]): boolean;
}
