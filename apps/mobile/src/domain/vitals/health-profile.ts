import type { HealthProfile } from '@/domain/entities/session';

/* Derived facts and input validation for the participant's health profile. */

/* Whole years on `today` for a YYYY-MM-DD birth date, or null if it is not one. */
export function ageFrom(dateOfBirth: string | null, today = new Date()): number | null {
  const d = parseDate(dateOfBirth);
  if (!d) return null;
  let age = today.getFullYear() - d.y;
  if (today.getMonth() + 1 < d.m || (today.getMonth() + 1 === d.m && today.getDate() < d.d)) age--;
  return age;
}

export function parseDate(s: string | null): { y: number; m: number; d: number } | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()) : null;
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function bmi(p: Pick<HealthProfile, 'heightCm' | 'weightKg'>): number | null {
  if (!p.heightCm || !p.weightKg) return null;
  const m = p.heightCm / 100;
  return p.weightKg / (m * m);
}

/* WHO adult BMI bands. */
export function bmiBand(v: number): string {
  return v < 18.5 ? 'underweight' : v < 25 ? 'healthy range' : v < 30 ? 'overweight' : 'obese range';
}

export interface ProfileDraft { dateOfBirth: string; heightCm: string; weightKg: string }
export type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;

/* Empty fields are fine (everything is optional); filled ones must make sense. */
export function validateProfile(d: ProfileDraft, today = new Date()): ProfileErrors {
  const e: ProfileErrors = {};
  if (d.dateOfBirth.trim()) {
    const age = ageFrom(d.dateOfBirth, today);
    if (age == null) e.dateOfBirth = 'Use the format YYYY-MM-DD, e.g. 1990-04-23.';
    else if (age < 0) e.dateOfBirth = 'That date is in the future.';
    else if (age > 120) e.dateOfBirth = 'Check the year.';
  }
  const h = num(d.heightCm);
  if (d.heightCm.trim() && (h == null || h < 40 || h > 250)) e.heightCm = 'Enter your height in centimetres (40–250).';
  const w = num(d.weightKg);
  if (d.weightKg.trim() && (w == null || w < 2 || w > 400)) e.weightKg = 'Enter your weight in kilograms (2–400).';
  return e;
}

/* Accepts "72", "72.5" and "72,5". */
export function num(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
