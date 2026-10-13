import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/* The SQLCipher key for the local database.
 *
 * Generated once per install (32 random bytes → 64 hex chars) and kept ONLY in
 * Keychain/Keystore. It never appears in a preference file, a log, a backup
 * blob, or the JS bundle. Losing it makes the database unreadable, which is the
 * intended property: a copied database file without the device's keystore is
 * ciphertext.
 *
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: the key must not travel in an iCloud/ADB
 * backup to another device — the data it protects is health data, and a restore
 * onto someone else's phone must not bring the key along.
 */
const KEY = 'wearwise.db.key.v1';

export async function getOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY, hex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return hex;
}

/* Only for account-deletion flows in a later milestone. Deliberately not wired
   to any UI yet: the one way to lose all local recordings should be a
   documented, confirmed action. */
export async function destroyDatabaseKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
