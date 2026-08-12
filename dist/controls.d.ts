/**
 * controls.ts — optional SDK-rendered mute and hang-up buttons.
 *
 * The SDK owns native button semantics, accessible state, pending-state protection and safe text
 * rendering. The HOST owns what the buttons actually do, through `onMutedChange` / `onHangup`:
 * ending a product session can also release a seat, request feedback, generate a report, or
 * finish another domain-specific flow, and none of that can live in a rendering helper.
 *
 * A control with no callback renders disabled rather than lying about what it will do.
 */
export interface SessionControlLabels {
    /** Accessible and visible label while the microphone is active. */
    mute: string;
    /** Accessible and visible label while the microphone is muted. */
    unmute: string;
    /** Accessible and visible label for ending the session. */
    hangup: string;
    /** Accessible and visible label while an asynchronous hang-up is pending. */
    ending: string;
}
/** Options for SDK-rendered mute and hang-up controls. */
export interface SessionControlsOptions {
    /** Whether the controls are visible. Defaults to true. */
    visible?: boolean;
    /** Whether to render the mute control. Defaults to true. */
    mute?: boolean;
    /** Whether to render the hang-up control. Defaults to true. */
    hangup?: boolean;
    /** Current user-selected microphone state. Defaults to false. */
    muted?: boolean;
    /** Disable the mute control without hiding it. */
    muteDisabled?: boolean;
    /** Disable the hang-up control without hiding it. */
    hangupDisabled?: boolean;
    /** Show the pending hang-up state and disable both controls. */
    ending?: boolean;
    /** Accessible label for the generated control group. */
    label?: string;
    /** Optional product-specific button wording. */
    labels?: Partial<SessionControlLabels>;
    /** Apply the requested user mute state to the active session. */
    onMutedChange?(muted: boolean): void;
    /** Run the host application's complete end-of-session flow. */
    onHangup?(): void | Promise<void>;
    /** Receives callback errors after the control returns to an interactive state. */
    onError?(error: unknown): void;
}
/** Handle returned by {@link attachSessionControls}. */
export interface SessionControlsController {
    /** Update any subset of the control state or callbacks. */
    update(options: Partial<SessionControlsOptions>): void;
    /** Clear the generated controls and release the target for another attachment. */
    destroy(): void;
}
/**
 * Populate an application-owned element with optional mute and hang-up buttons.
 *
 * The SDK owns native button semantics, accessible state, pending-state protection, safe text
 * rendering, and the update lifecycle. The host owns the actual mute and end-of-session behavior
 * through callbacks, because ending a product session can also release seats, request feedback,
 * generate a report, or finish another domain-specific flow.
 */
export declare function attachSessionControls(target: HTMLElement, initial?: SessionControlsOptions): SessionControlsController;
