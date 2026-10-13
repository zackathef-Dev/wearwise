import { useSyncExternalStore } from 'react';
import { darkColors, lightColors, type Palette } from '@wearwise/design-tokens';
import { isDarkNow, subscribeTheme, themePreference, type ThemePreference } from './theme-preference';

/* Canvas can't read CSS variables, so charts take the palette object for the current
   theme (the account menu's choice, or the OS setting) and redraw when it changes. */

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeTheme, isDarkNow, () => false);
}

export function usePalette(): Palette {
  return useIsDark() ? darkColors : lightColors;
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, themePreference, () => 'system');
}
