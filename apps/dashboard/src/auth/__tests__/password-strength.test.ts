import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD, passwordStrength } from '@wearwise/password';

/* The shared rules (packages/password), tested here because the dashboard runs vitest. */
describe('passwordStrength', () => {
  it('requires the minimum length', () => {
    const s = passwordStrength('Ab1!');
    expect(s.score).toBe(0);
    expect(s.label).toBe('Too short');
    expect(s.acceptable).toBe(false);
    expect(s.tip).toMatch(new RegExp(`${MIN_PASSWORD} characters`));
  });

  it('refuses common passwords, however they are decorated', () => {
    for (const pw of ['Password123!', 'qwerty123456', '1234567890', 'aaaaaaaaaaaa', 'Wearwise2026!']) {
      const s = passwordStrength(pw);
      expect(s.acceptable, pw).toBe(false);
      expect(s.label, pw).toBe('Weak');
    }
  });

  it('rates length and variety, and says what would help most', () => {
    expect(passwordStrength('greenmatchbox').label).toBe('Fair');                // 13, one kind
    expect(passwordStrength('greenmatchbox').tip).toBe('Mix capital and lowercase letters.');
    expect(passwordStrength('Greenmatchbox7').label).toBe('Good');               // 14, three kinds
    expect(passwordStrength('Greenmatchbox7').tip).toBe('Add a symbol, like ! ? # or %.');
    const strong = passwordStrength('Green-matchbox-7-tides');
    expect(strong.label).toBe('Strong');
    expect(strong.tip).toBeNull();
    expect(strong.checks.every((c) => c.met)).toBe(true);
  });

  it('marks down predictable runs and the person’s own details', () => {
    expect(passwordStrength('Tides1234!xyz').score).toBeLessThan(passwordStrength('Tides8264!xqz').score);
    const named = passwordStrength('Morgan-wearer-9', ['Alex Morgan', 'alex.morgan@example.org']);
    expect(named.tip).toBe('Avoid your name or email in your password.');
    expect(named.score).toBeLessThan(passwordStrength('Pebble-wearer-9').score);
  });

  it('lists what is required and what is recommended', () => {
    const s = passwordStrength('Greenmatchbox7');
    expect(s.checks.filter((c) => c.required).map((c) => c.id)).toEqual(['length', 'not-common']);
    expect(s.checks.find((c) => c.id === 'symbol')!.met).toBe(false);
    expect(s.acceptable).toBe(true);
  });
});
