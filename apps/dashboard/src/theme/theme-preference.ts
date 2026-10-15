/* Light, dark, or the computer's setting: the person's choice in the account menu,
 * remembered in this browser only (it is a display preference, nothing to sync).
 * Light or Dark sets data-theme on <html>, which the token CSS (tokens.ts) follows;
 * System removes it and the OS setting applies.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'ww.theme';
const OS_DARK = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

export function themePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies the saved choice to the page; call once before the first render. */
export function applyThemePreference(pref: ThemePreference = themePreference()): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* private mode: this page only */ }
  applyThemePreference(pref);
  for (const l of listeners) l();
}

/** Is the page dark right now: the choice, or the OS setting under System. */
export function isDarkNow(): boolean {
  const pref = document.documentElement.dataset.theme;
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return window.matchMedia(OS_DARK).matches;
}

/** For useSyncExternalStore: the choice changing, or the OS setting. */
export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  const mq = window.matchMedia(OS_DARK);
  mq.addEventListener('change', cb);
  return () => { listeners.delete(cb); mq.removeEventListener('change', cb); };
}
