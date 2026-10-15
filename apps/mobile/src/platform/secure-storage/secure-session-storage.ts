import * as SecureStore from 'expo-secure-store';
import { isFirstLaunchOfInstall } from '@/platform/kv/kv';

/* Session material storage, backed by iOS Keychain / Android Keystore.
 *
 * This adapter is handed to supabase-js as its `storage`, so access and refresh
 * tokens never touch AsyncStorage or any plaintext preference file — the build
 * instruction's hard rule. Nothing else in the app may import expo-secure-store
 * directly; every secure read/write goes through here so there is exactly one
 * place to audit.
 *
 * SecureStore rejects keys with characters outside [A-Za-z0-9._-]; supabase-js
 * keys ("sb-<ref>-auth-token") are already legal, but the guard makes a bad key a
 * loud failure instead of a silent no-op.
 */

const legal = /^[A-Za-z0-9._-]+$/;

const assertKey = (key: string): void => {
  if (!legal.test(key)) throw new Error(`secure-storage: illegal key "${key}"`);
};

/* iOS keeps Keychain items after the app is deleted, so a reinstall would open signed in
   to whoever used it last. On the first launch of an install, a session found here
   belongs to an earlier install: remove it once, the first time it is asked for. Keys
   written during this launch (a fresh sign-in) are kept. */
const settled = new Set<string>();

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    assertKey(key);
    if (isFirstLaunchOfInstall() && !settled.has(key)) {
      settled.add(key);
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      return null;
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    assertKey(key);
    settled.add(key);
    /* AFTER_FIRST_UNLOCK: the session must be readable when the app resumes in the
       background (sync, later milestones) but never before the device has been
       unlocked once since boot. */
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string): Promise<void> {
    assertKey(key);
    settled.add(key);
    await SecureStore.deleteItemAsync(key);
  },
};
