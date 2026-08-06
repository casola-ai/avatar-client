/** Server -> browser PCM framing used by the Workers fallback backend.
 *
 * The microphone WebSocket is already full duplex. GPU boxes continue sending only JSON on the
 * downlink; a fallback backend may additionally send these binary frames after the client opts in
 * with `accept_audio: ['pcm16']` in its hello message.
 */
export declare const PCM_DOWNLINK_MAGIC = 51793;
export declare const PCM_DOWNLINK_VERSION = 1;
export declare const PCM_DOWNLINK_HEADER_BYTES = 12;
export interface PcmDownlinkFrame {
    sequence: number;
    sampleRate: number;
    pcm: Int16Array;
}
export declare function encodePcmDownlinkFrame(pcm: Int16Array, sequence: number, sampleRate?: number): Uint8Array;
export declare function decodePcmDownlinkFrame(data: ArrayBuffer | ArrayBufferView): PcmDownlinkFrame | null;
