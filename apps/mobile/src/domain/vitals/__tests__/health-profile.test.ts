import { ageFrom, bmi, bmiBand, validateProfile, num } from '../health-profile';

const today = new Date(2026, 9, 13); // 13 Oct 2026

describe('health profile', () => {
  test('age counts whole years, birthday-aware', () => {
    expect(ageFrom('1990-10-13', today)).toBe(36);
    expect(ageFrom('1990-10-14', today)).toBe(35);
    expect(ageFrom('2026-02-30', today)).toBeNull();     // not a date
    expect(ageFrom('13/10/1990', today)).toBeNull();     // wrong format
    expect(ageFrom(null, today)).toBeNull();
  });

  test('BMI and WHO bands', () => {
    expect(bmi({ heightCm: 180, weightKg: 81 })!.toFixed(1)).toBe('25.0');
    expect(bmi({ heightCm: null, weightKg: 70 })).toBeNull();
    expect(bmiBand(17)).toBe('underweight');
    expect(bmiBand(22)).toBe('healthy range');
    expect(bmiBand(27)).toBe('overweight');
    expect(bmiBand(31)).toBe('obese range');
  });

  test('validation: empty is fine, nonsense is not', () => {
    expect(validateProfile({ dateOfBirth: '', heightCm: '', weightKg: '' }, today)).toEqual({});
    expect(validateProfile({ dateOfBirth: '1990-04-23', heightCm: '172', weightKg: '68,5' }, today)).toEqual({});
    const e = validateProfile({ dateOfBirth: '2030-01-01', heightCm: '7', weightKg: 'abc' }, today);
    expect(Object.keys(e).sort()).toEqual(['dateOfBirth', 'heightCm', 'weightKg']);
    expect(num('68,5')).toBe(68.5);
  });
});
