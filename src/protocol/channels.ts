// GENERATED from packages/avatar-protocol/src/channels.ts — do not edit.
// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol
/**
 * Well-known channel ids. A session's live channels are whatever the server's `accept.channels`
 * declares — these constants name the conventional assignments. Frames on undeclared or unknown
 * channels MUST be ignored by receivers.
 */
export const Channel = {
  MIC_UPLINK: 1,
  AVATAR_AUDIO: 2,
  AVATAR_VIDEO: 3,
  DATA: 4,
} as const;

/** channel_id values ≥ this are experimental. */
export const CHANNEL_EXPERIMENTAL_MIN = 0xf0;

export type ChannelDir = 'up' | 'down';

/** Payload codecs an audio channel may carry. `pcm16` (PCM16-LE) is the baseline every peer
 *  supports; `opus` is negotiated for the mic uplink through `hello.mic.codecs` and carries exactly
 *  one Opus packet per media frame. */
export const AUDIO_CODECS = ['pcm16', 'opus'] as const;
export type AudioCodec = (typeof AUDIO_CODECS)[number];

export interface AudioChannelDescriptor {
  id: number;
  dir: ChannelDir;
  kind: 'audio';
  codec: AudioCodec;
  sample_rate: number;
  channels: 1;
}

/** Video codecs an fMP4 downlink may carry. `h264` is the baseline every MSE client decodes and
 *  what an absent/empty `hello.video.codecs` lands on; `hevc` (H.265) and `av1` are negotiated the
 *  way `opus` is for the mic uplink. The channel's `codec` stays `fmp4` — this is the CONTENT of
 *  the container, spelled out in the descriptor's `video_codec` and in its `mime`
 *  (`avc1…` / `hvc1…` / `av01…`). */
export const VIDEO_CODECS = ['h264', 'hevc', 'av1'] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

export interface VideoChannelDescriptor {
  id: number;
  dir: 'down';
  kind: 'video';
  codec: 'fmp4';
  /** MSE-ready mime, e.g. `video/mp4; codecs="avc1.4d401f,mp4a.40.2"` — subsumes v1's {mime}. */
  mime: string;
  fps?: number;
  seg_frames?: number;
  /** The negotiated content codec inside the container. Present only when the server negotiates
   *  codecs at all; absent means `h264`, which is what every pre-negotiation box emits. */
  video_codec?: VideoCodec;
}

export interface DataChannelDescriptor {
  id: number;
  dir: ChannelDir;
  kind: 'data';
  codec: 'binary';
}

export type ChannelDescriptor =
  | AudioChannelDescriptor
  | VideoChannelDescriptor
  | DataChannelDescriptor;
