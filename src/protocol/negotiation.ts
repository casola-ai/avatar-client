// GENERATED from packages/avatar-protocol/src/negotiation.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
import type { AudioChannelDescriptor, ChannelDescriptor, VideoChannelDescriptor } from './channels';
import { AUDIO_CODECS, type AudioCodec, Channel, VIDEO_CODECS, type VideoCodec } from './channels';
import { ErrorCode } from './codes';
import type { AcceptMessage, HelloMessage } from './messages';

export const Feature = {
  UTTERANCE_TIMING_V1: 'utterance_timing_v1',
  MEDIA_UNIT_FLAGS_V1: 'media_unit_flags_v1',
  /** The mic uplink may be thin (spec §4): a sender MAY send an EMPTY payload for a 100 ms
   *  window whose audio is silence, whichever codec ch1 negotiated, and an `opus` frame MAY carry
   *  one to five packets. The cadence is kept — the receiver expands both to silence. */
  MIC_DTX_V1: 'mic_dtx_v1',
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
  /** Downlink video the server can send, if any. Omitted/null with `poster` = poster mode.
   *  `codecs` is the server's OWN preference order (e.g. `['av1','hevc','h264']`, ordered by
   *  measured bits-per-quality) and `mimes` the mime string of each; a server that leaves `codecs`
   *  out does not negotiate and serves `mime` as-is, which is the pre-negotiation wire. */
  video?: {
    mime: string;
    fps?: number;
    segFrames?: number;
    codecs?: readonly string[];
    mimes?: Record<string, string>;
  } | null;
  poster?: { url: string } | null;
  /** Uplink mic format the server expects. Omitted = no mic channel. `codecs` is what this
   *  server can decode, in its own order of preference; omitted = `['pcm16']`. */
  mic?: { sampleRate: number; codecs?: readonly string[] } | null;
  features?: string[];
}

export type NegotiationResult =
  | { ok: true; accept: Omit<AcceptMessage, 'seq'> }
  | { ok: false; code: string; message: string };

function selectMicCodec(
  mic: NonNullable<HelloMessage['mic']>,
  offered: readonly string[] = ['pcm16']
): AudioCodec | null {
  const wanted = [...(mic.codecs ?? []), mic.codec];
  const pick = wanted.find(
    (codec) => (AUDIO_CODECS as readonly string[]).includes(codec) && offered.includes(codec)
  );
  return (pick as AudioCodec | undefined) ?? null;
}

/**
 * The downlink codec for this session: the first entry of the SERVER's preference list
 * (`offer.video.codecs`) that the client lists in `hello.video.codecs`. The client's list is a
 * capability, not a preference — it says what the browser decodes, and the server holds the numbers
 * that say which of those is cheapest to ship. An absent/empty client list, or a server offering
 * nothing beyond the baseline, lands on `h264`, which keeps every pre-negotiation client on exactly
 * today's stream. Unknown codec names on either side are ignored rather than refused.
 */
export function selectVideoCodec(
  hello: HelloMessage,
  offerVideo: NonNullable<SessionOffer['video']>
): VideoCodec {
  const offered = offerVideo.codecs;
  if (!offered?.length) return 'h264';
  const wanted = hello.video?.codecs;
  if (!Array.isArray(wanted) || wanted.length === 0) return 'h264';
  const pick = offered.find(
    (codec) => (VIDEO_CODECS as readonly string[]).includes(codec) && wanted.includes(codec)
  );
  return (pick as VideoCodec | undefined) ?? 'h264';
}

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
    // The mic codec is the first entry of the client's preference list that this server offers,
    // falling back to the baseline `codec` (always pcm16). Either side omitting `codecs` lands on
    // pcm16, which is what keeps a new client compatible with an old box and vice versa.
    const micCodec = selectMicCodec(hello.mic, offer.mic?.codecs);
    if (
      hello.mic.codec !== 'pcm16' ||
      !Number.isSafeInteger(hello.mic.sample_rate) ||
      hello.mic.sample_rate <= 0 ||
      !offer.mic ||
      hello.mic.sample_rate !== offer.mic.sampleRate ||
      micCodec === null
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
      codec: micCodec,
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
    // Spelled out only when this server negotiates codecs at all; one that offers just the
    // baseline emits the descriptor byte-for-byte as before (the golden vectors).
    const negotiable = Boolean(offer.video.codecs?.length);
    const videoCodec = selectVideoCodec(hello, offer.video);
    const video: VideoChannelDescriptor = {
      id: Channel.AVATAR_VIDEO,
      dir: 'down',
      kind: 'video',
      codec: 'fmp4',
      mime: offer.video.mimes?.[videoCodec] ?? offer.video.mime,
      ...(offer.video.fps !== undefined ? { fps: offer.video.fps } : {}),
      ...(offer.video.segFrames !== undefined ? { seg_frames: offer.video.segFrames } : {}),
      ...(negotiable ? { video_codec: videoCodec } : {}),
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
