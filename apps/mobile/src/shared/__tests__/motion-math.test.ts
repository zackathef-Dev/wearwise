import { ringFrame, staggerDelay, revealShift } from '../motion-math';

describe('ringFrame', () => {
  test('a ring is invisible at rest and at the end, so a loop wraps without a pop', () => {
    expect(ringFrame(0, 3, 0.5)).toEqual({ scale: 1, opacity: 0 });
    expect(ringFrame(1, 3, 0.5)).toEqual({ scale: 1, opacity: 0 });
    expect(ringFrame(-0.2, 3, 0.5).opacity).toBe(0);
    expect(ringFrame(1.4, 3, 0.5).opacity).toBe(0);
  });

  test('grows from 1 towards the spread and never exceeds the peak opacity', () => {
    const mid = ringFrame(0.5, 3, 0.5);
    expect(mid.scale).toBeCloseTo(2);
    let max = 0;
    for (let k = 0.01; k < 1; k += 0.01) max = Math.max(max, ringFrame(k, 3, 0.5).opacity);
    expect(max).toBeLessThanOrEqual(0.5);
    expect(max).toBeGreaterThan(0.4);
  });

  test('fades in quickly, then out slowly', () => {
    expect(ringFrame(0.05, 2, 1).opacity).toBeLessThan(ringFrame(0.125, 2, 1).opacity);
    expect(ringFrame(0.9, 2, 1).opacity).toBeLessThan(ringFrame(0.3, 2, 1).opacity);
  });
});

describe('staggerDelay', () => {
  test('steps each row and stops at the cap', () => {
    expect(staggerDelay(0, 55, 8)).toBe(0);
    expect(staggerDelay(3, 55, 8)).toBe(165);
    expect(staggerDelay(7, 55, 8)).toBe(385);
    expect(staggerDelay(8, 55, 8)).toBeNull();
    expect(staggerDelay(-1, 55, 8)).toBeNull();
  });
});

describe('revealShift', () => {
  test('hides everything at 0, nothing at 1, and clamps outside', () => {
    expect(revealShift(300, 0)).toBe(300);
    expect(revealShift(300, 0.5)).toBe(150);
    expect(revealShift(300, 1)).toBe(0);
    expect(revealShift(300, -1)).toBe(300);
    expect(revealShift(300, 2)).toBe(0);
  });
});
