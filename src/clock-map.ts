/** A small clock calibration: records `{x, y}` sample pairs and answers "what y corresponds to
 *  a given x" by local linear interpolation between the two nearest samples — never a global fit,
 *  so a discontinuity in one interval (an MSE catch-up seek, a mic clock recalibration, ...) only
 *  distorts lookups that fall inside that one interval, not the whole history. Clamps at the
 *  sampled range's edges rather than extrapolating. Bounded to `cap` samples regardless of how
 *  long the caller keeps recording. */
export class ClockMap {
  private readonly samples: Array<{ x: number; y: number }> = [];

  constructor(private readonly cap = 64) {}

  record(x: number, y: number): void {
    this.samples.push({ x, y });
    if (this.samples.length > this.cap) this.samples.shift();
  }

  at(x: number): number | null {
    const samples = this.samples;
    if (samples.length === 0) return null;
    const first = samples[0];
    if (samples.length === 1 || x <= first.x) return first.y;
    const last = samples[samples.length - 1];
    if (x >= last.x) return last.y;

    for (let i = 1; i < samples.length; i++) {
      const b = samples[i];
      if (x > b.x) continue;
      const a = samples[i - 1];
      const span = b.x - a.x;
      if (span <= 0) return a.y;
      const t = (x - a.x) / span;
      return a.y + t * (b.y - a.y);
    }
    return last.y; // unreachable given the range checks above
  }

  clear(): void {
    this.samples.length = 0;
  }
}
