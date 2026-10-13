import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { fontFamilies, layout, tracking } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';

/* The type scale, as components. Screens compose these instead of styling raw
 * <Text>, which is what keeps 15 screens on one scale instead of 15 private ones.
 * Sizes and tracking come from the generated tokens — the same numbers the web
 * mockup renders.
 */

type TypoRole =
  | 'display' | 'h1' | 'h2' | 'h3'
  | 'body' | 'bodySm' | 'caption' | 'label'
  | 'micro' | 'dataHero' | 'data2xl' | 'dataLg' | 'dataSm' | 'unit';

const asNum = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
const em = (v: unknown): number => (typeof v === 'string' && v.endsWith('em') ? parseFloat(v) : typeof v === 'number' ? v : 0);

const ROLES: Record<TypoRole, TextStyle & { colorToken: 'textHeading' | 'textBody' | 'textSecondary' | 'textMuted' }> = {
  display: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeDisplaySize, 48), letterSpacing: tracking(em(layout.typeDisplayLs), asNum(layout.typeDisplaySize, 48)), colorToken: 'textHeading' },
  h1: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeH1Size, 34), letterSpacing: tracking(em(layout.typeH1Ls), asNum(layout.typeH1Size, 34)), colorToken: 'textHeading' },
  h2: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeH2Size, 26), letterSpacing: tracking(em(layout.typeH2Ls), asNum(layout.typeH2Size, 26)), colorToken: 'textHeading' },
  h3: { fontFamily: fontFamilies.medium, fontSize: asNum(layout.typeH3Size, 20), colorToken: 'textHeading' },
  body: { fontFamily: fontFamilies.regular, fontSize: asNum(layout.typeBodySize, 16), lineHeight: asNum(layout.typeBodySize, 16) * 1.6, colorToken: 'textBody' },
  bodySm: { fontFamily: fontFamilies.regular, fontSize: asNum(layout.typeBodySmSize, 14), lineHeight: asNum(layout.typeBodySmSize, 14) * 1.55, colorToken: 'textBody' },
  caption: { fontFamily: fontFamilies.regular, fontSize: asNum(layout.typeCaptionSize, 12), colorToken: 'textSecondary' },
  label: { fontFamily: fontFamilies.medium, fontSize: asNum(layout.typeLabelSize, 13), colorToken: 'textBody' },
  micro: {
    fontFamily: fontFamilies.semiBold,
    fontSize: asNum(layout.typeMicroSize, 10),
    letterSpacing: tracking(em(layout.typeMicroLs ?? 0.14), asNum(layout.typeMicroSize, 10)),
    textTransform: 'uppercase',
    colorToken: 'textMuted',
  },
  dataHero: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeDataHeroSize, 62), letterSpacing: tracking(-0.035, asNum(layout.typeDataHeroSize, 62)), colorToken: 'textHeading' },
  data2xl: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeData2xlSize, 52), letterSpacing: tracking(-0.03, asNum(layout.typeData2xlSize, 52)), colorToken: 'textHeading' },
  dataLg: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeDataLgSize, 32), colorToken: 'textHeading' },
  dataSm: { fontFamily: fontFamilies.semiBold, fontSize: asNum(layout.typeDataSmSize, 22), colorToken: 'textHeading' },
  unit: { fontFamily: fontFamilies.medium, fontSize: asNum(layout.typeDataUnitSize, 14), colorToken: 'textSecondary' },
};

export interface TypoProps extends Omit<TextProps, 'role'> {
  /* Named `variant`, not `role`: RN's Text already has an accessibility `role`
     prop and shadowing it would silently break screen-reader semantics. */
  variant?: TypoRole;
  /* Override the variant's default colour with a palette token value. */
  color?: string;
}

export function Typo({ variant = 'body', color, style, children, ...rest }: TypoProps) {
  const { colors } = useTheme();
  const { colorToken, ...roleStyle } = ROLES[variant];
  return (
    <Text {...rest} style={[roleStyle, { color: color ?? colors[colorToken] }, style]}>
      {children}
    </Text>
  );
}
