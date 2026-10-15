import { SensorType } from '@wearwise/sensor-protocol';

/* Deterministic simulated physiology.
 *
 * Every generator is a pure function of (seed, sample index), so the same seed
 * produces the same stream on every run, on every platform, and in every test.
 * That is what makes screenshot diffs and packet-loss tests meaningful.
 *
 * These are SHAPES, not physiology models: they look right on a chart and sit in
 * plausible ranges. The app labels them as simulated everywhere they appear.
 */

/* mulberry32 — small, fast, good enough for noise; seeded, so reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Gaussian bump helper for the ECG morphology. */
const bump = (t: number, centre: number, width: number, amp: number) =>
  amp * Math.exp(-((t - centre) ** 2) / (2 * width * width));

export interface SignalGenerator {
  sensorType: SensorType;
  sampleRateHz: number;
  /* Value at absolute sample index i (mV / % / °C). Pure. */
  at(i: number): number;
}

/* ECG: one beat = P, Q, R, S, T bumps laid along a phase in [0,1). Heart rate
   drifts slowly (respiratory sinus arrhythmia-ish) around a base, plus a little
   baseline wander and noise. Output in millivolts, R peak ≈ 1.1 mV. */
export function ecgGenerator(seed: number, sampleRateHz = 70, baseBpm = 72): SignalGenerator {
  const rand = prng(seed);
  const noise = Array.from({ length: 4096 }, () => (rand() - 0.5) * 0.02);
  return {
    sensorType: SensorType.Ecg,
    sampleRateHz,
    at(i) {
      const t = i / sampleRateHz;
      const bpm = baseBpm + 4 * Math.sin(t / 5.3) + 2 * Math.sin(t / 17);
      const beatLen = 60 / bpm;
      const phase = (t % beatLen) / beatLen;
      const wave =
        bump(phase, 0.16, 0.025, 0.12) +   // P
        bump(phase, 0.36, 0.010, -0.15) +  // Q
        bump(phase, 0.40, 0.012, 1.10) +   // R
        bump(phase, 0.44, 0.012, -0.25) +  // S
        bump(phase, 0.68, 0.045, 0.30);    // T
      const wander = 0.04 * Math.sin(t / 3.1);
      return wave + wander + noise[i % noise.length]!;
    },
  };
}

/* SpO₂: a slow wander around 97.5 with a rare brief dip, in percent. */
export function spo2Generator(seed: number, sampleRateHz = 25): SignalGenerator {
  const rand = prng(seed ^ 0x5b02);
  const noise = Array.from({ length: 1024 }, () => (rand() - 0.5) * 0.15);
  return {
    sensorType: SensorType.SpO2,
    sampleRateHz,
    at(i) {
      const t = i / sampleRateHz;
      const dip = t % 240 > 200 && t % 240 < 212 ? -2.5 * Math.sin(((t % 240) - 200) / 12 * Math.PI) : 0;
      return 97.5 + 0.6 * Math.sin(t / 41) + dip + noise[i % noise.length]!;
    },
  };
}

/* Skin temperature: very slow drift around 36.7 °C, tiny noise. */
export function temperatureGenerator(seed: number, sampleRateHz = 1): SignalGenerator {
  const rand = prng(seed ^ 0x7e3f);
  const noise = Array.from({ length: 256 }, () => (rand() - 0.5) * 0.02);
  return {
    sensorType: SensorType.Temperature,
    sampleRateHz,
    at(i) {
      const t = i / sampleRateHz;
      return 36.7 + 0.25 * Math.sin(t / 900) + 0.05 * Math.sin(t / 61) + noise[i % noise.length]!;
    },
  };
}

/* Heart rate: a slow beat-count in bpm, drifting around a resting ~68 with
   respiratory sinus arrhythmia and the odd sigh. A low-rate DERIVED signal — one
   value per second — not the ECG waveform it would be computed from on a device. */
export function bpmGenerator(seed: number, sampleRateHz = 1, baseBpm = 68): SignalGenerator {
  const rand = prng(seed ^ 0x0b60);
  const noise = Array.from({ length: 256 }, () => (rand() - 0.5) * 1.2);
  return {
    sensorType: SensorType.HeartRate,
    sampleRateHz,
    at(i) {
      const t = i / sampleRateHz;
      return baseBpm + 5 * Math.sin(t / 12) + 2.5 * Math.sin(t / 3.3) + noise[i % noise.length]!;
    },
  };
}

/* Accelerometer MAGNITUDE (g) for fall detection. Sits at ~1 g with gentle sway, and
   injects a textbook fall — free-fall dip, impact spike, then a few seconds lying still —
   about 12 s after it starts and then every 3 minutes, so the FallDetector fires and the
   alarm can be exercised end to end against the simulation. (It was every 25 s, shorter
   than the alarm's own 30 s countdown, so an alarm covered the screen almost all the
   time — handover dry run, 2026-10-14.) Pure in the sample index (fall timing is exact);
   noise is index-hashed, not from a running PRNG, so at(i) stays a pure function. */
export function accelGenerator(seed: number, sampleRateHz = 50): SignalGenerator {
  const hash = (i: number) => { const x = Math.sin((i + seed) * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const period = Math.round(180 * sampleRateHz);  // then one fall every 3 minutes
  const first = Math.round(12 * sampleRateHz);     // first fall ~12 s in
  const ff = Math.round(0.3 * sampleRateHz);       // free-fall length
  const imp = 3;                                    // impact spike length
  const still = Math.round(3 * sampleRateHz);       // lying-still length
  return {
    sensorType: SensorType.Accelerometer,
    sampleRateHz,
    at(i: number): number {
      const rel = i - first;
      if (rel >= 0) {
        const p = rel % period;
        if (p < ff) return 0.25 + 0.12 * hash(i);                 // free-fall ~0 g
        if (p < ff + imp) return 4.6 + 2.2 * hash(i);             // impact spike
        if (p < ff + imp + still) return 1.0 + 0.02 * (hash(i) - 0.5); // lying still ~1 g
      }
      return 1.0 + 0.06 * Math.sin(i * 0.35) + 0.03 * (hash(i) - 0.5); // gentle everyday sway
    },
  };
}

/* PPG: a pulsatile optical waveform (AC-coupled counts) at a resting ~66 bpm — a fast
   systolic upstroke, a dicrotic notch, then diastolic decay. Mirrors the shape a MAX30102
   produces once the DC baseline is removed, so the app can render a real device's PPG. */
export function ppgGenerator(seed: number, sampleRateHz = 50, baseBpm = 66): SignalGenerator {
  const rand = prng(seed ^ 0x9c37);
  const noise = Array.from({ length: 1024 }, () => (rand() - 0.5) * 12);
  return {
    sensorType: SensorType.Ppg,
    sampleRateHz,
    at(i) {
      const t = i / sampleRateHz;
      const bpm = baseBpm + 3 * Math.sin(t / 9);
      const phase = (t % (60 / bpm)) / (60 / bpm);
      const wave =
        bump(phase, 0.18, 0.05, 520) +   // systolic peak
        bump(phase, 0.42, 0.06, 180) +   // dicrotic notch/wave
        bump(phase, 0.70, 0.10, 60);     // diastolic tail
      return wave - 240 + noise[i % noise.length]!;  // mean-removed -> AC counts
    },
  };
}

/* Matches the real patch (firmware 0.7.x capabilities), so a simulated session
   exercises the same data rates, packet sizes and trace windows as hardware. */
export const DEFAULT_RATES: Record<SensorType, number> = {
  [SensorType.Ecg]: 250,
  [SensorType.SpO2]: 1,
  [SensorType.Temperature]: 2,
  [SensorType.HeartRate]: 1,
  [SensorType.Accelerometer]: 50,
  [SensorType.Ppg]: 100,
};

export const defaultRate = (t: SensorType): number => DEFAULT_RATES[t] ?? 1;

export function generatorFor(sensorType: SensorType, seed: number, sampleRateHz = defaultRate(sensorType)): SignalGenerator {
  switch (sensorType) {
    case SensorType.Ecg: return ecgGenerator(seed, sampleRateHz);
    case SensorType.SpO2: return spo2Generator(seed, sampleRateHz);
    case SensorType.Temperature: return temperatureGenerator(seed, sampleRateHz);
    case SensorType.HeartRate: return bpmGenerator(seed, sampleRateHz);
    case SensorType.Accelerometer: return accelGenerator(seed, sampleRateHz);
    case SensorType.Ppg: return ppgGenerator(seed, sampleRateHz);
    default: throw new RangeError(`no generator for sensor type ${sensorType as number}`);
  }
}
