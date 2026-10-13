import { describe, expect, it } from 'vitest';
import { tokensCss } from '../theme/tokens';

describe('theme CSS', () => {
  const css = tokensCss();
  it('follows the OS unless Light was chosen, and Dark always wins', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;');
    expect(css).toContain(':root[data-theme="dark"]{color-scheme:dark;');
    expect(css.startsWith(':root{color-scheme:light;')).toBe(true);
  });
});
