/* What to tell someone whose phone the patch would not pair with, step by step.
 *
 * The patch drops a pairing attempt when it is not accepting new devices: it already
 * remembers two others (firmware ≥ 0.9.6; one before) and its BOOT button wasn't
 * pressed in the last minute, or it locked itself after three wrong PINs. A phone that
 * was paired before and has since been pushed out still holds the old pairing, and
 * iOS/Android keep trying it — that has to be removed in Bluetooth settings first. The
 * phone can't tell these apart, so the steps cover all of them, in the order that works.
 */
export function refusedPairingHelp(platform: 'ios' | 'android' | string, device?: string | null): string {
  const name = device || 'the patch';
  const forget = platform === 'ios'
    ? `If ${name} is listed in Settings → Bluetooth, tap ⓘ next to it and choose Forget This Device.`
    : `If ${name} is listed in Settings → Connections → Bluetooth, tap ⚙ next to it and choose Unpair.`;
  return [
    'The patch didn’t accept this device.',
    'It remembers the last two phones or tablets it was paired with; a new one needs its BOOT button.',
    `1. ${forget}`,
    '2. Press the BOOT button on the patch once.',
    '3. Within a minute, tap Try again and enter the patch’s 6-digit PIN.',
  ].join('\n');
}
