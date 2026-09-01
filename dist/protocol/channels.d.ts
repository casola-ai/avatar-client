/**
 * Well-known channel ids. A session's live channels are whatever the server's `accept.channels`
 * declares — these constants name the conventional assignments. Frames on undeclared or unknown
 * channels MUST be ignored by receivers.
 */
export declare const Channel: {
    readonly MIC_UPLINK: 1;
    readonly AVATAR_AUDIO: 2;
    readonly AVATAR_VIDEO: 3;
    readonly DATA: 4;
};
/** channel_id values ≥ this are experimental. */
export declare const CHANNEL_EXPERIMENTAL_MIN = 240;
export type ChannelDir = 'up' | 'down';
/** Payload codecs an audio channel may carry. `pcm16` (PCM16-LE) is the baseline every peer
 *  supports; `opus` is negotiated for the mic uplink through `hello.mic.codecs` and carries exactly
 *  one Opus packet per media frame. */
export declare const AUDIO_CODECS: readonly ["pcm16", "opus"];
export type AudioCodec = (typeof AUDIO_CODECS)[number];
export interface AudioChannelDescriptor {
    id: number;
    dir: ChannelDir;
    kind: 'audio';
    codec: AudioCodec;
    sample_rate: number;
    channels: 1;
}
export interface VideoChannelDescriptor {
    id: number;
    dir: 'down';
    kind: 'video';
    codec: 'fmp4';
    /** MSE-ready mime, e.g. `video/mp4; codecs="avc1.4d401f,mp4a.40.2"` — subsumes v1's {mime}. */
    mime: string;
    fps?: number;
    seg_frames?: number;
}
export interface DataChannelDescriptor {
    id: number;
    dir: ChannelDir;
    kind: 'data';
    codec: 'binary';
}
export type ChannelDescriptor = AudioChannelDescriptor | VideoChannelDescriptor | DataChannelDescriptor;
