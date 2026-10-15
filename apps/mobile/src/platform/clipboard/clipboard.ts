import { TurboModuleRegistry, type TurboModule } from 'react-native';

/* Copy text without adding a native dependency (which would need a rebuild).
 *
 * React Native 0.86 still compiles its own Clipboard native module into both
 * platforms; only the JS wrapper is deprecated, and touching it logs a warning
 * pointing at @react-native-clipboard/clipboard. We reach the same module through
 * the public registry instead. If a future React Native drops it, `get` returns
 * null and callers hide Copy — the system Share sheet has its own Copy action.
 * Swap for expo-clipboard at the next native rebuild.
 */

interface ClipboardSpec extends TurboModule {
  getString(): Promise<string>;
  setString(content: string): void;
}

function native(): ClipboardSpec | null {
  try { return TurboModuleRegistry.get<ClipboardSpec>('Clipboard'); } catch { return null; }
}

export const canCopy = (): boolean => native() != null;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/* True if the text reached the clipboard. With `clearAfterMs`, it is wiped again after
   that long if it is still what we copied (other apps can read the clipboard). */
export function copyText(text: string, { clearAfterMs }: { clearAfterMs?: number } = {}): boolean {
  const m = native();
  if (!m) return false;
  try { m.setString(text); } catch { return false; }
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = clearAfterMs ? setTimeout(() => {
    clearTimer = null;
    void m.getString().then((now) => { if (now === text) m.setString(''); }).catch(() => undefined);
  }, clearAfterMs) : null;
  return true;
}
