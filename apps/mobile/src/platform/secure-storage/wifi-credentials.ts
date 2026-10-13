import * as SecureStore from 'expo-secure-store';

/* Wi-Fi credentials for each sensor, kept ONLY in Keychain/Keystore.
 *
 * Firmware ≥ 0.9.1 holds the Wi-Fi password in RAM only, so a flash dump of the
 * patch never contains it. The phone is the one place it is remembered: after
 * every Bluetooth connect the app re-sends it over the authenticated BLE link.
 *
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: the automatic Bluetooth reconnect may run
 * while the screen is locked (patch rebooted mid-session), so the value must be
 * readable then; it must never travel in a backup to another phone.
 */
export interface WifiCredentials { ssid: string; password: string }

/* Each saved network belongs to the account that entered it: a second account on the
   same phone must not have someone else's Wi-Fi password sent to its patch. Entries
   saved before accounts were recorded are claimed by the first account that uses them. */
interface Stored extends WifiCredentials { owner?: string }

const keyFor = (deviceId: string) => `wearwise.wifi.${deviceId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function saveWifiCredentials(deviceId: string, creds: WifiCredentials, owner: string): Promise<void> {
  const value: Stored = { ssid: creds.ssid, password: creds.password, owner };
  await SecureStore.setItemAsync(keyFor(deviceId), JSON.stringify(value), OPTIONS);
}

export async function loadWifiCredentials(deviceId: string, owner: string): Promise<WifiCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(deviceId), OPTIONS);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.ssid !== 'string' || !v.ssid || typeof v.password !== 'string') return null;
    const creds = { ssid: v.ssid, password: v.password };
    if (v.owner === undefined) await saveWifiCredentials(deviceId, creds, owner).catch(() => {});
    else if (v.owner !== owner) return null;
    return creds;
  } catch {
    return null;
  }
}

export async function forgetWifiCredentials(deviceId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(deviceId), OPTIONS).catch(() => {});
}
