/** The Bluetooth name the patch advertises: the last two bytes of its base MAC
 *  (firmware: core/device_identity.c), e.g. 8c:94:df:6e:62:80 → "WearWise-6280". */
export function deviceNameFromMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12) throw new Error(`Unexpected MAC address “${mac}”`);
  return `WearWise-${hex.slice(8)}`;
}
