import { describe, expect, it } from 'vitest';
import { checkNewPassword, parseRecoveryLink, resetRequestMessage, updatePasswordMessage, safeReturnPath } from '../password';

describe('checkNewPassword', () => {
  it('requires a password of at least 10 characters', () => {
    expect(checkNewPassword('', '')).toMatch(/enter/i);
    expect(checkNewPassword('short9char', 'short9char')).toBeNull();
    expect(checkNewPassword('nine-char', 'nine-char')).toMatch(/at least 10/);
  });
  it('rejects edge spaces and mismatches', () => {
    expect(checkNewPassword(' correct-horse ', ' correct-horse ')).toMatch(/space/);
    expect(checkNewPassword('correct-horse', 'correct-horsE')).toMatch(/don’t match/);
  });
});

describe('parseRecoveryLink', () => {
  it('reads the implicit-flow session from the fragment, with the account it is for', () => {
    const payload = btoa(JSON.stringify({ sub: 'user-1' })).replace(/=+$/, '');
    expect(parseRecoveryLink(`#access_token=h.${payload}.s&refresh_token=r1&type=recovery`, '')).toEqual({
      kind: 'tokens', accessToken: `h.${payload}.s`, refreshToken: 'r1', subject: 'user-1',
    });
  });
  it('refuses a session in the URL that isn’t from a password reset', () => {
    expect(parseRecoveryLink('#access_token=a.b.c&refresh_token=r1', '').kind).toBe('error');
    expect(parseRecoveryLink('#access_token=a.b.c&refresh_token=r1&type=signup', '').kind).toBe('error');
  });
  it('only returns to paths inside the app after sign-in', () => {
    expect(safeReturnPath('/participants/1')).toBe('/participants/1');
    for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example', '/sign-in', 42, undefined]) {
      expect(safeReturnPath(bad)).toBe('/');
    }
  });
  it('reads a PKCE code from the query', () => {
    expect(parseRecoveryLink('', '?code=abc123')).toEqual({ kind: 'code', code: 'abc123' });
  });
  it('explains an expired link', () => {
    const r = parseRecoveryLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid', '');
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toMatch(/expired/);
  });
  it('reports nothing when opened directly', () => {
    expect(parseRecoveryLink('', '')).toEqual({ kind: 'none' });
  });
});

describe('messages', () => {
  it('never reveals whether an address has an account', () => {
    expect(resetRequestMessage({ status: 400, code: 'user_not_found' })).not.toMatch(/no account|not found/i);
  });
  it('names the mail limits that block a reset', () => {
    expect(resetRequestMessage({ status: 429 })).toMatch(/too many/i);
    expect(resetRequestMessage({ code: 'email_address_not_authorized' })).toMatch(/can’t send/);
  });
  it('maps update failures', () => {
    expect(updatePasswordMessage({ code: 'same_password' })).toMatch(/current password/);
    expect(updatePasswordMessage({ status: 401 })).toMatch(/new reset link/);
    expect(updatePasswordMessage({ status: 0 })).toMatch(/reach the server/);
  });
});
