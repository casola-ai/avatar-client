/**
 * Ambient declarations for the AudioWorklet global scope. These globals exist
 * only inside an AudioWorkletProcessor module (mic-worklet.ts) and are not part
 * of lib.dom, so we declare the minimal surface we use.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

declare const sampleRate: number;
declare const currentTime: number;
