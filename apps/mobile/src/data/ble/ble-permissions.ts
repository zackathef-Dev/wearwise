import { PermissionsAndroid, Platform } from 'react-native';

/* Android BLE permissions. The model split at API 31 (Android 12):
 *   ≤30  location (fine) gates scanning — BLE could infer location, so Google
 *        gated it behind ACCESS_FINE_LOCATION.
 *   ≥31  dedicated BLUETOOTH_SCAN + BLUETOOTH_CONNECT; scan can carry
 *        neverForLocation so we do NOT ask for location at all.
 * iOS asks at first use via the Info.plist string (app.config.ts); nothing to do
 * here. This returns a structured result so the UI can explain a denial and link
 * to settings (hardware matrix 4.1) rather than dead-ending. */

export type BlePermissionResult =
  | { granted: true }
  | { granted: false; reason: 'denied' | 'blocked'; missing: string[] };

export async function ensureBlePermissions(): Promise<BlePermissionResult> {
  if (Platform.OS !== 'android') return { granted: true };

  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);

  const needed =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(needed);

  const missing = needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (missing.length === 0) return { granted: true };

  const blocked = missing.some((p) => result[p] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
  return { granted: false, reason: blocked ? 'blocked' : 'denied', missing };
}
