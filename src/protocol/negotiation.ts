// GENERATED from packages/avatar-protocol/src/negotiation.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { AudioChannelDescriptor, ChannelDescriptor, VideoChannelDescriptor } from './channels';
import { Channel } from './channels';
import { ErrorCode } from './codes';
import type { AcceptMessage, HelloMessage } from './messages';

/**
 * hello → accept negotiation, server side. Pure: the caller supplies what the session can offer
 * (from the JWT + its own capabilities) and gets back either the accept body (minus `seq`, which
 * the connection stamps at send) or a refusal with a stable error code.
 */

export interface SessionOffer {
  /** The bound avatar_versions.id, echoed to the client as the pinning ack. */
  personaKey: string;
  capSeconds: number;
  /** Downlink audio the server will send, if any. */
  audio?: { sampleRate: number } | null;
  /** Downlink video the server can send, if any. Omitted/null with `poster` = poster mode. */
  video?: { mime: string; fps?: number; segFrames?: number } | null;
  poster?: { url: string } | null;
  /** Uplink mic format the server expects. Omitted = no mic channel. */
  mic?: { sampleRate: number } | null;
  features?: string[];
}

export type NegotiationResult =
  | { ok: true; accept: Omit<AcceptMessage, 'seq'> }
  | { ok: false; code: string; message: string };

export function negotiateAccept(hello: HelloMessage, offer: SessionOffer): NegotiationResult {
  const acceptsAudio = hello.accept.audio?.includes('pcm16') ?? false;
  const acceptsVideo = hello.accept.video?.includes('fmp4') ?? false;

  if (offer.audio && !acceptsAudio) {
    return {
      ok: false,
      code: ErrorCode.UNSUPPORTED_CODEC,
      message: 'server audio is pcm16; client does not accept it',
    };
  }

  const channels: ChannelDescriptor[] = [];
  if (offer.mic) {
    const mic: AudioChannelDescriptor = {
      id: Channel.MIC_UPLINK,
      dir: 'up',
      kind: 'audio',
      codec: 'pcm16',
      sample_rate: offer.mic.sampleRate,
      channels: 1,
    };
    channels.push(mic);
  }
  if (offer.audio) {
    const audio: AudioChannelDescriptor = {
      id: Channel.AVATAR_AUDIO,
      dir: 'down',
      kind: 'audio',
      codec: 'pcm16',
      sample_rate: offer.audio.sampleRate,
      channels: 1,
    };
    channels.push(audio);
  }
  const videoOffered = offer.video && acceptsVideo;
  if (videoOffered && offer.video) {
    const video: VideoChannelDescriptor = {
      id: Channel.AVATAR_VIDEO,
      dir: 'down',
      kind: 'video',
      codec: 'fmp4',
      mime: offer.video.mime,
      ...(offer.video.fps !== undefined ? { fps: offer.video.fps } : {}),
      ...(offer.video.segFrames !== undefined ? { seg_frames: offer.video.segFrames } : {}),
    };
    channels.push(video);
  }

  // No way to show anything: no video the client can play and no poster to fall back to.
  if (!videoOffered && !offer.poster) {
    return {
      ok: false,
      code: ErrorCode.UNSUPPORTED_CODEC,
      message: 'no displayable output: client accepts no offered video and server has no poster',
    };
  }

  return {
    ok: true,
    accept: {
      type: 'accept',
      proto: 2,
      persona_key: offer.personaKey,
      cap_seconds: offer.capSeconds,
      channels,
      ...(!videoOffered && offer.poster ? { poster: { url: offer.poster.url } } : {}),
      features: offer.features ?? [],
      resume: null,
    },
  };
}
