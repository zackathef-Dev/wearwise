import { redirectSystemPath } from '@/app/+native-intent';

describe('redirectSystemPath', () => {
  it('passes ordinary app links through', () => {
    const link = 'wearwise://auth/confirm?code=8c1f0e5e-5d3b-4f7e-9a51-1f2c3d4e5f60';
    expect(redirectSystemPath({ path: link, initial: true })).toBe(link);
    expect(redirectSystemPath({ path: 'wearwise://session/abc%20def', initial: false })).toBe('wearwise://session/abc%20def');
  });

  it('opens the app normally for a malformed escape or an overlong link', () => {
    expect(redirectSystemPath({ path: 'wearwise://x/%E0%A4%A', initial: true })).toBe('/');
    expect(redirectSystemPath({ path: `wearwise://x/${'a'.repeat(3000)}`, initial: true })).toBe('/');
  });
});
