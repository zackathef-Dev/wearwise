import { describe, expect, test } from 'vitest';
import { clampWindow, MIN_SPAN, panWindow, zoomWindow } from '../window';
import { timeAxis, valueAxis } from '../scale';
import { cssVarName } from '../../theme/tokens';

const domain = { start: 0, end: 100 };

describe('time window', () => {
  test('stays inside the session and never narrower than the minimum', () => {
    expect(clampWindow({ start: -10, end: 20 }, domain)).toEqual({ start: 0, end: 30 });
    expect(clampWindow({ start: 90, end: 120 }, domain)).toEqual({ start: 70, end: 100 });
    expect(clampWindow({ start: 50, end: 50 }, domain)).toEqual({ start: 50, end: 50 + MIN_SPAN });
    expect(clampWindow({ start: -5, end: 500 }, domain)).toEqual(domain);
  });

  test('zoom keeps the anchor in place; pan moves by a fraction of the span', () => {
    expect(zoomWindow({ start: 0, end: 100 }, 0.5, domain, 50)).toEqual({ start: 25, end: 75 });
    expect(zoomWindow({ start: 20, end: 60 }, 0.5, domain, 20)).toEqual({ start: 20, end: 40 });
    expect(zoomWindow({ start: 40, end: 60 }, 100, domain)).toEqual(domain);
    expect(panWindow({ start: 20, end: 40 }, 0.5, domain)).toEqual({ start: 30, end: 50 });
    expect(panWindow({ start: 10, end: 30 }, -1, domain)).toEqual({ start: 0, end: 20 });
  });
});

describe('axes', () => {
  test('value axis expands to clean steps and handles a flat signal', () => {
    expect(valueAxis(0.13, 0.87, 0.001)).toMatchObject({ lo: 0, hi: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], decimals: 1 });
    const flat = valueAxis(36.5, 36.5, 0.01);
    expect(flat.lo).toBeLessThan(36.5);
    expect(flat.hi).toBeGreaterThan(36.5);
  });

  test('time axis picks clock-friendly steps', () => {
    expect(timeAxis(0, 600, 10).ticks).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
    expect(timeAxis(12.3, 12.8, 5)).toEqual({ ticks: [12.3, 12.4, 12.5, 12.6, 12.7, 12.8], decimals: 1 });
  });
});

describe('design tokens as CSS variables', () => {
  test('match the design system’s CSS names', () => {
    expect(cssVarName('wwDataEcg')).toBe('--ww-data-ecg');
    expect(cssVarName('wwTeal600')).toBe('--ww-teal-600');
    expect(cssVarName('typeH2Size')).toBe('--type-h2-size');
    expect(cssVarName('typeData2xlSize')).toBe('--type-data-2xl-size');
    expect(cssVarName('space4')).toBe('--space-4');
    expect(cssVarName('textOnDarkSecondary')).toBe('--text-on-dark-secondary');
  });
});
