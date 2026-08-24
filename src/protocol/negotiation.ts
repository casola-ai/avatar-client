// GENERATED from packages/avatar-protocol/src/negotiation.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { AudioChannelDescriptor, ChannelDescriptor, VideoChannelDescriptor } from './channels';
import { Channel } from './channels';
import { ErrorCode } from './codes';
import type { AcceptMessage, HelloMessage } from './messages';

export const Feature = {
  UTTERANCE_TIMING_V1: 'utterance_timing_v1',
  MEDIA_UNIT_FLAGS_V1: 'media_unit_flags_v1',
} as const;

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

export interface NegotiateOptions {
  /**
   * `false` is a TEXT-ONLY (brain-only) session: the server answers with control messages alone
   * — a `turn` carrying a `brain` payload — and never opens a downlink. Defaults to `true`, which
   * is byte-for-byte today's behaviour.
   */
  render?: boolean;
}

/**
 * With `render: false` the displayable-output requirement below is skipped — it exists to refuse a
 * session that can neither show nor say anything, which is precisely what a text-only session is
 * *for* — and no video, PCM or poster is offered even when the offer has them and the client
 * accepts them. The channel map is then `[mic]` when the client asked for a microphone, else `[]`.
 *
 * The mic contract is unchanged either way: a malformed or mismatched mic request is still refused
 * with `unsupported_codec`, because ASR still runs.
 */
export function negotiateAccept(
  hello: HelloMessage,
  offer: SessionOffer,
  options: NegotiateOptions = {}
): NegotiationResult {
  const render = options.render ?? true;
  const acceptsAudio = hello.accept.audio?.includes('pcm16') ?? false;
  const acceptsVideo = hello.accept.video?.includes('fmp4') ?? false;

  if (render && offer.audio && !acceptsAudio && !(offer.video && acceptsVideo)) {
    return {
      ok: false,
      code: ErrorCode.UNSUPPORTED_CODEC,
      message: 'server audio is pcm16; client does not accept it',
    };
  }

  const channels: ChannelDescriptor[] = [];
  if (hello.mic) {
    if (
      hello.mic.codec !== 'pcm16' ||
      !Number.isSafeInteger(hello.mic.sample_rate) ||
      hello.mic.sample_rate <= 0 ||
      !offer.mic ||
      hello.mic.sample_rate !== offer.mic.sampleRate
    ) {
      return {
        ok: false,
        code: ErrorCode.UNSUPPORTED_CODEC,
        message: 'unsupported microphone format',
      };
    }
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
  // Everything from here to the accept body is downlink, which a text-only session does not have.
  if (render && offer.audio) {
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
  const videoOffered = render && offer.video && acceptsVideo;
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
  if (render && !videoOffered && !offer.poster) {
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
      ...(render && !videoOffered && offer.poster ? { poster: { url: offer.poster.url } } : {}),
      features: [...new Set(offer.features ?? [])].filter((feature) =>
        (hello.features ?? []).includes(feature)
      ),
      resume: null,
    },
  };
}
