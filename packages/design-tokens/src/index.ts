/* @wearwise/design-tokens — the brand, as data.
 *
 * Everything here is generated from design-system/tokens/*.css, the same files the
 * web mockup and the design system project read. The mobile app must take colour,
 * spacing, radius, type and motion values from this package and nowhere else —
 * a literal hex in a screen is the first step of the two surfaces drifting apart.
 */
export { lightColors, darkColors } from './generated/colors';
export type { ColorToken, Palette } from './generated/colors';
export { layout } from './generated/layout';
export { motion } from './generated/motion';

/* The Poppins faces the app registers at startup. Weights match the brand guide;
   the woff2/ttf files live in the app's assets, not in this package. */
export const fontFamilies = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/* em-tracked letterspacing from the type scale, converted for RN (which wants px).
   Usage: letterSpacing: tracking(-0.02, 34) for -0.02em at 34px. */
export const tracking = (em: number, fontSizePx: number): number => em * fontSizePx;
