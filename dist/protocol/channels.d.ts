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
export interface AudioChannelDescriptor {
    id: number;
    dir: ChannelDir;
    kind: 'audio';
    codec: 'pcm16';
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
