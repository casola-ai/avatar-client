/**
 * The uplink's silence gate (`mic_dtx_v1`, spec §4, casola-ai/avatar#628): which 100 ms windows
 * go out EMPTY. The box grants the feature in the accept; from then on a window this gate calls
 * silent is sent as a media frame with no payload — 16 bytes of header instead of ~300 B of
 * encoded silence (~25 kbit/s down to ~1.3 for a muted or unbacked microphone) — and the box
 * expands it to a block of zeros before anything reads it. The 100 ms cadence is kept, empty or
 * not: the frames still arriving are the box's evidence that someone is there, which is what
 * makes this safe where native Opus DTX (which suppresses whole packets, and in Chromium loses
 * their timestamps too) is not.
 *
 * Pure and synchronous; the driver owns one per session.
 */
/**
 * A window whose RMS (linear full-scale, on the 16 kHz samples that would have been sent) is at
 * or under this is silence. Chosen against the box's endpointer, not the ear: its offset bar is
 * 0.004 RMS per 50 ms hop, its onset bar 0.006, and it updates its noise floor only from hops
 * under 0.003. A hop inside a window can carry at most √2 × the window's RMS, so at 0.0015 no hop
 * of a gated window could have crossed any of those bars — the box's decisions on zeros are the
 * decisions it would have made on the audio. A room with audible ambience (AGC is on, so most
 * rooms) simply gates less; the guaranteed win is the muted or unbacked channel, which is zeros.
 */
export declare const MIC_DTX_RMS = 0.0015;
/** Silent windows still sent in full after the last non-silent one: 300 ms, so an utterance's
 *  tail reaches the box's ASR as recorded (its own offset needs 150 ms of unvoiced hops). */
export declare const MIC_DTX_HANGOVER_WINDOWS = 3;
export declare class MicSilenceGate {
    private quiet;
    /** Whether this window goes out empty. Call once per window, in order. */
    empty(pcm: Int16Array): boolean;
}
