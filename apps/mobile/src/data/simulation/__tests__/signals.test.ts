import { accelGenerator } from '../signals';

/* Seconds at which the simulated movement signal dips into free fall (< 0.5 g). */
function freeFallStarts(seconds: number, rate = 50): number[] {
  const g = accelGenerator(7, rate);
  const starts: number[] = [];
  let inside = false;
  for (let i = 0; i < seconds * rate; i++) {
    const low = g.at(i) < 0.5;
    if (low && !inside) starts.push(Math.round(i / rate));
    inside = low;
  }
  return starts;
}

test('the simulated patch falls about 12 s after starting, then every 3 minutes', () => {
  // Less often than the alarm's 30 s countdown, so the app stays usable on the simulator.
  expect(freeFallStarts(400)).toEqual([12, 192, 372]);
});
