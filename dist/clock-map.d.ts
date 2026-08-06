/** A small clock calibration: records `{x, y}` sample pairs and answers "what y corresponds to
 *  a given x" by local linear interpolation between the two nearest samples — never a global fit,
 *  so a discontinuity in one interval (an MSE catch-up seek, a mic clock recalibration, ...) only
 *  distorts lookups that fall inside that one interval, not the whole history. Clamps at the
 *  sampled range's edges rather than extrapolating. Bounded to `cap` samples regardless of how
 *  long the caller keeps recording. */
export declare class ClockMap {
    private readonly cap;
    private readonly samples;
    constructor(cap?: number);
    record(x: number, y: number): void;
    at(x: number): number | null;
    clear(): void;
}
