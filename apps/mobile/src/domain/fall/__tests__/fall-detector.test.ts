import { FallDetector, type FallEvent } from '../fall-detector';

const RATE = 50;
const flat = (g: number, n: number) => Array.from({ length: n }, () => g);
function feed(det: FallDetector, samples: number[]): FallEvent[] {
  const out: FallEvent[] = [];
  for (const s of samples) { const e = det.push(s); if (e) out.push(e); }
  return out;
}

describe('FallDetector', () => {
  it('detects a fall: free-fall dip, impact spike, then stillness', () => {
    const det = new FallDetector(RATE);
    const trace = [
      ...flat(1.0, 50),    // standing / normal ~1 g
      ...flat(0.3, 15),    // free-fall (0.3 s)
      ...flat(4.2, 3),     // impact spike
      ...flat(1.0, 100),   // lying still (2 s)
    ];
    const events = feed(det, trace);
    expect(events).toHaveLength(1);
    expect(events[0]!.impactPeakG).toBeGreaterThanOrEqual(2.5);
    expect(events[0]!.freefallMinG).toBeLessThan(0.6);
  });

  it('ignores normal activity (never enters free-fall)', () => {
    const det = new FallDetector(RATE);
    const trace = Array.from({ length: 600 }, (_, i) => 1.0 + 0.2 * Math.sin(i / 3)); // 0.8..1.2 g
    expect(feed(det, trace)).toHaveLength(0);
  });

  it('rejects a hard sit (impact but no preceding free-fall)', () => {
    const det = new FallDetector(RATE);
    const trace = [...flat(1.0, 50), ...flat(3.2, 3), ...flat(1.0, 120)];
    expect(feed(det, trace)).toHaveLength(0);
  });

  it('rejects a stumble-and-recover (free-fall + impact but keeps moving)', () => {
    const det = new FallDetector(RATE);
    const moving = Array.from({ length: 120 }, (_, i) => 1.0 + 0.9 * Math.sin(i)); // 0.1..1.9 g, not still
    const trace = [...flat(1.0, 50), ...flat(0.3, 15), ...flat(4.0, 3), ...moving];
    expect(feed(det, trace)).toHaveLength(0);
  });

  it('rejects free-fall with no impact within the window', () => {
    const det = new FallDetector(RATE);
    const trace = [...flat(1.0, 50), ...flat(0.4, 10), ...flat(1.0, 120)]; // dip then back to normal, no spike
    expect(feed(det, trace)).toHaveLength(0);
  });

  it('recovers to detect a second fall after the first', () => {
    const det = new FallDetector(RATE);
    const fall = [...flat(0.3, 15), ...flat(4.0, 3), ...flat(1.0, 100)];
    const events = feed(det, [...flat(1.0, 40), ...fall, ...flat(1.0, 40), ...fall]);
    expect(events).toHaveLength(2);
  });
});
