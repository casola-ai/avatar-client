/** Server -> browser PCM framing used by the Workers fallback backend.
 *
 * The microphone WebSocket is already full duplex. GPU boxes continue sending only JSON on the
 * downlink; a fallback backend may additionally send these binary frames after the client opts in
 * with `accept_audio: ['pcm16']` in its hello message.
 */
export const PCM_DOWNLINK_MAGIC = 0xca51;
export const PCM_DOWNLINK_VERSION = 1;
export const PCM_DOWNLINK_HEADER_BYTES = 12;

export interface PcmDownlinkFrame {
  sequence: number;
  sampleRate: number;
  pcm: Int16Array;
}

export function encodePcmDownlinkFrame(
  pcm: Int16Array,
  sequence: number,
  sampleRate = 24000
): Uint8Array {
  const out = new Uint8Array(PCM_DOWNLINK_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, PCM_DOWNLINK_MAGIC, true);
  view.setUint8(2, PCM_DOWNLINK_VERSION);
  view.setUint8(3, 0);
  view.setUint32(4, sequence, true);
  view.setUint32(8, sampleRate, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), PCM_DOWNLINK_HEADER_BYTES);
  return out;
}

export function decodePcmDownlinkFrame(
  data: ArrayBuffer | ArrayBufferView
): PcmDownlinkFrame | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (
    bytes.byteLength < PCM_DOWNLINK_HEADER_BYTES ||
    (bytes.byteLength - PCM_DOWNLINK_HEADER_BYTES) % 2 !== 0
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint16(0, true) !== PCM_DOWNLINK_MAGIC ||
    view.getUint8(2) !== PCM_DOWNLINK_VERSION ||
    view.getUint8(3) !== 0
  ) {
    return null;
  }
  const payload = bytes.slice(PCM_DOWNLINK_HEADER_BYTES);
  return {
    sequence: view.getUint32(4, true),
    sampleRate: view.getUint32(8, true),
    pcm: new Int16Array(payload.buffer, payload.byteOffset, payload.byteLength / 2),
  };
}
