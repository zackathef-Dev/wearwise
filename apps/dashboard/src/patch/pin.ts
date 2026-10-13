/* The patch's Bluetooth pairing PIN: six digits the participant types into the
   phone's pairing prompt. Printed on the patch's label; see factory-record.ts. */

export const isValidPin = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 999_999;

/** "042 917": grouped for reading aloud, leading zeros kept. */
export function formatPin(pin: number): string {
  const s = String(pin).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

/** The PINs someone would try first: one digit repeated, or a straight run (123456, 987654). */
export function isGuessablePin(pin: number): boolean {
  const d = [...String(pin).padStart(6, '0')].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  return [0, 1, -1].some((step) => steps.every((s) => s === step));
}

const cryptoU32 = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** A uniformly random PIN from the browser's secure random source, never a guessable
 *  one and never `avoid` (the PIN being replaced). */
export function generatePin(avoid?: number, randomU32: () => number = cryptoU32): number {
  /* Rejecting the top sliver of the 32-bit range keeps `% 1e6` free of modulo bias. */
  const limit = Math.floor(2 ** 32 / 1e6) * 1e6;
  for (;;) {
    const r = randomU32();
    if (r >= limit) continue;
    const pin = r % 1e6;
    if (pin !== avoid && !isGuessablePin(pin)) return pin;
  }
}
