/* Fall detection from an accelerometer MAGNITUDE stream (|a| in g).
 *
 * A fall has a recognisable signature that a single threshold cannot capture but a
 * short state machine can, which is what keeps everyday knocks and sitting-down from
 * firing the alarm:
 *
 *   1. FREE-FALL  — as the body drops, apparent weight collapses: |a| dips well below
 *                   1 g (toward 0 g).
 *   2. IMPACT     — hitting the ground is a sharp spike: |a| jumps well above 1 g,
 *                   within a second of the free-fall.
 *   3. STILLNESS  — a real fall usually leaves the person motionless: |a| settles back
 *                   to ~1 g and holds steady for a couple of seconds. Someone who
 *                   stumbles and recovers keeps moving, so this stage rejects them.
 *
 * Only when all three occur in order is a fall reported. Pure and deterministic — it
 * is fed one magnitude sample at a time and its unit tests drive it with synthetic
 * traces, so the same input always yields the same verdict.
 */

export interface FallEvent {
  /* Sample index at which the fall was confirmed (stillness satisfied). */
  atSample: number;
  /* Lowest magnitude seen during free-fall (g) — how complete the drop was. */
  freefallMinG: number;
  /* Peak magnitude at impact (g) — how hard the landing was. */
  impactPeakG: number;
}

export interface FallConfig {
  freefallG: number;          // below this = free-fall
  impactG: number;            // above this = impact
  freefallToImpactMs: number; // impact must follow the free-fall within this window
  settleMs: number;           // ignore this long after impact (ring-down) before judging stillness
  stillMs: number;            // this much continuous stillness confirms the fall
  stillLoG: number;           // stillness band, lower bound
  stillHiG: number;           // stillness band, upper bound
}

export const DEFAULT_FALL_CONFIG: FallConfig = {
  freefallG: 0.6,
  impactG: 2.5,
  freefallToImpactMs: 1000,
  settleMs: 250,
  stillMs: 1200,
  stillLoG: 0.75,
  stillHiG: 1.30,
};

type Phase = 'idle' | 'freefall' | 'confirm';

export class FallDetector {
  private cfg: FallConfig;
  private msPerSample: number;
  private i = 0;
  private phase: Phase = 'idle';
  private freefallStart = 0;
  private freefallMin = 1;
  private impactAt = 0;
  private impactPeak = 0;
  private stillCount = 0;

  constructor(sampleRateHz: number, config: Partial<FallConfig> = {}) {
    this.cfg = { ...DEFAULT_FALL_CONFIG, ...config };
    this.msPerSample = 1000 / (sampleRateHz > 0 ? sampleRateHz : 1);
  }

  private samples(ms: number): number { return ms / this.msPerSample; }

  reset(): void {
    this.phase = 'idle';
    this.freefallMin = 1;
    this.impactPeak = 0;
    this.stillCount = 0;
  }

  /* Feed one magnitude sample (g). Returns a FallEvent when a fall completes, else null. */
  push(mag: number): FallEvent | null {
    const i = this.i++;
    const c = this.cfg;

    switch (this.phase) {
      case 'idle':
        if (mag < c.freefallG) { this.phase = 'freefall'; this.freefallStart = i; this.freefallMin = mag; }
        return null;

      case 'freefall':
        if (mag < this.freefallMin) this.freefallMin = mag;
        if (mag > c.impactG) { this.phase = 'confirm'; this.impactAt = i; this.impactPeak = mag; this.stillCount = 0; return null; }
        /* No impact within the window → the dip wasn't a fall (a quick arm drop, etc.). */
        if (i - this.freefallStart > this.samples(c.freefallToImpactMs)) this.reset();
        return null;

      case 'confirm':
        if (mag > this.impactPeak) this.impactPeak = mag;
        /* Let the impact ring down before judging stillness. */
        if (i - this.impactAt < this.samples(c.settleMs)) return null;
        if (mag >= c.stillLoG && mag <= c.stillHiG) {
          this.stillCount++;
          if (this.stillCount >= this.samples(c.stillMs)) {
            const ev: FallEvent = { atSample: i, freefallMinG: this.freefallMin, impactPeakG: this.impactPeak };
            this.reset();
            return ev;
          }
        } else {
          /* Movement after the impact → the person is not lying still (recovered, or a
             non-fall impact). Not a fall. */
          this.reset();
        }
        return null;
    }
  }
}
