import React from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, type Palette } from '@wearwise/design-tokens';
import { prefs } from '@/platform/kv/kv';

const THEME_KEY = 'theme.choice'; // 'light' | 'dark' | '' (follow system)

/* Light / dark for the whole app — the same model the web mockup proved out:
 *
 *   'dark' | 'light'  an explicit choice, remembered
 *   null              no choice yet — follow the OS, and keep following it
 *
 * Once someone picks, the OS stops overriding them. Persistence lands with MMKV in
 * a later slice; the interface is final now so screens never change.
 *
 * The participant app ships dark-first (the night canvas): with no stored choice
 * and no OS signal, dark wins. A wearable app is read in bed and on wards — a
 * white screen at 3am is a flashbulb.
 */

type ThemeName = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeName;
  colors: Palette;
  dark: boolean;
  followsSystem: boolean;
  setDark: (on: boolean) => void;
  useSystem: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null, live
  /* Restore the remembered choice synchronously on first render so there is no
     flash of the wrong theme. '' means "follow the system". */
  const [choice, setChoice] = React.useState<ThemeName | null>(() => {
    const saved = prefs.getString(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  });

  const theme: ThemeName = choice ?? (system === 'light' ? 'light' : 'dark');

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      colors: theme === 'dark' ? darkColors : lightColors,
      dark: theme === 'dark',
      followsSystem: choice == null,
      setDark: (on) => { const c: ThemeName = on ? 'dark' : 'light'; setChoice(c); prefs.set(THEME_KEY, c); },
      useSystem: () => { setChoice(null); prefs.set(THEME_KEY, ''); },
    }),
    [theme, choice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
