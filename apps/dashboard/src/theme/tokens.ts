import { darkColors, layout, lightColors, type Palette } from '@wearwise/design-tokens';

/* The brand as CSS custom properties, generated from @wearwise/design-tokens at
 * startup, so the dashboard never carries a hand-typed hex value.
 *
 * Names follow the design system's CSS (design-system/tokens/*.css):
 *   wwDataEcg → --ww-data-ecg, surfaceCard → --surface-card, radiusCard → --radius-card
 *
 * Follows the computer's light/dark setting (prefers-color-scheme) unless the person
 * picked Light or Dark in the account menu, which sets data-theme on <html>
 * (theme-preference.ts). The values are the same tokens either way.
 */

/* camelCase → kebab, reversing the generator's kebab → camel: a dash before each
   capital, and before a number that follows a word (teal600 → teal-600,
   space4 → space-4) but not a single letter (H2 → h2, as in --type-h2-size). */
export const cssVarName = (key: string): string =>
  `--${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/([a-z]{2,})(\d)/g, '$1-$2')}`;

const UNITLESS = /(Weight|Lh)$|^fw/;

const declarations = (entries: [string, string | number][]): string =>
  entries.map(([k, v]) => `${cssVarName(k)}:${v};`).join('');

const layoutVars = (): string =>
  declarations(Object.entries(layout).map(([k, v]) => [k, typeof v === 'number' && !UNITLESS.test(k) ? `${v}px` : v]));

const paletteVars = (p: Palette): string => declarations(Object.entries(p));

export function tokensCss(): string {
  const dark = `color-scheme:dark;${paletteVars(darkColors)}`;
  return [
    `:root{color-scheme:light;${paletteVars(lightColors)}${layoutVars()}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
  ].join('\n');
}

export function installTokens(): void {
  const el = document.createElement('style');
  el.id = 'ww-tokens';
  el.textContent = tokensCss();
  document.head.prepend(el);
}
