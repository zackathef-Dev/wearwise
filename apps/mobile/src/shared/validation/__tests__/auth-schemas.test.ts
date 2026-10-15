import { signInSchema, registerSchema, resetRequestSchema } from '../auth-schemas';

describe('auth form validation', () => {
  test('sign-in accepts a normal email + any non-empty password', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  test('sign-in does NOT enforce password strength (legacy passwords must pass)', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });

  test('sign-in trims and rejects a malformed email', () => {
    const bad = signInSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(bad.success).toBe(false);
    const trimmed = signInSchema.safeParse({ email: '  a@b.co  ', password: 'x' });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.email).toBe('a@b.co');
  });

  const validRegistration = {
    displayName: 'Alex Reyes',
    email: 'alex@wearwise.io',
    password: 'ten-chars-plus',
    adult: true as const,
    terms: true as const,
    consent: true as const,
  };

  test('registration accepts the valid case', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  test('registration enforces the 10-character minimum', () => {
    const r = registerSchema.safeParse({ ...validRegistration, password: 'nineChars' });
    expect(r.success).toBe(false);
  });

  test('registration requires the 18+ declaration to be literally true', () => {
    for (const adult of [false, undefined, 'yes', 1]) {
      const r = registerSchema.safeParse({ ...validRegistration, adult });
      expect(r.success).toBe(false);
    }
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  test('registration requires consent to be literally true', () => {
    for (const consent of [false, undefined, 'yes', 1]) {
      const r = registerSchema.safeParse({ ...validRegistration, consent });
      expect(r.success).toBe(false);
    }
  });

  test('registration bounds the display name', () => {
    expect(registerSchema.safeParse({ ...validRegistration, displayName: '' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, displayName: 'x'.repeat(81) }).success).toBe(false);
  });

  test('reset request needs only a plausible email', () => {
    expect(resetRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(resetRequestSchema.safeParse({ email: '' }).success).toBe(false);
  });
});
