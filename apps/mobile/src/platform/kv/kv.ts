/* A tiny synchronous key-value store for lightweight UI preferences (theme, last
 * tab). NOT for anything sensitive — recordings and tokens live in the encrypted
 * SQLite store and the Keychain/Keystore respectively. MMKV is unencrypted here on
 * purpose: a theme choice is not a secret, and keeping it out of the secure store
 * avoids a Keychain round-trip on every render.
 *
 * Wrapped so a missing native module (a JS-only test runner) degrades to an in-memory
 * map instead of throwing at import time; hence the require inside the try.
 */

interface Kv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const INSTALL_MARK = 'install.seen';

/* True on the first launch after the app is installed (or reinstalled). MMKV lives in
   the app's own container and is deleted with the app, unlike the iOS Keychain. An app
   updated from a build without this mark already has preferences, so it isn't counted. */
let firstLaunch = false;

function makeKv(): Kv {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy: see the header
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const mmkv = createMMKV({ id: 'wearwise-prefs' });
    if (!mmkv.contains(INSTALL_MARK)) {
      firstLaunch = mmkv.getAllKeys().length === 0;
      mmkv.set(INSTALL_MARK, '1');
    }
    return {
      getString: (k) => mmkv.getString(k),
      set: (k, v) => mmkv.set(k, v),
      delete: (k) => { mmkv.remove(k); },
    };
  } catch {
    const mem = new Map<string, string>();
    return {
      getString: (k) => mem.get(k),
      set: (k, v) => { mem.set(k, v); },
      delete: (k) => { mem.delete(k); },
    };
  }
}

export const prefs: Kv = makeKv();

/** First launch of this install: anything in the Keychain was left by an earlier one. */
export const isFirstLaunchOfInstall = (): boolean => firstLaunch;
