/* Share codes as the participant sees them: ABCDE-FGHJK.
 *
 * The server (create_share_code / redeem_share_code in
 * supabase/migrations/20261014000005_data_sharing.sql) normalises case and strips
 * dashes and spaces itself, so this file is only about helping a person type a
 * code correctly. It matters because every wrong code counts towards the server's
 * rate limit (10 failures an hour): a code that cannot possibly be valid is
 * caught here and never sent.
 */

/** Same alphabet the server generates from: no I, L, O, 0 or 1. */
export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 10;

export const normaliseShareCode = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** As-you-type formatting: "abcdefg" → "ABCDE-FG". */
export function formatShareCodeInput(input: string): string {
  const n = normaliseShareCode(input).slice(0, SHARE_CODE_LENGTH);
  return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
}

export type ShareCodeCheck =
  | { ok: true; code: string }
  | { ok: false; reason: 'empty' | 'length' | 'characters'; invalid: string[] };

export function checkShareCode(input: string): ShareCodeCheck {
  const n = normaliseShareCode(input);
  if (!n) return { ok: false, reason: 'empty', invalid: [] };
  const invalid = [...new Set([...n].filter((c) => !SHARE_CODE_ALPHABET.includes(c)))];
  if (invalid.length) return { ok: false, reason: 'characters', invalid };
  if (n.length !== SHARE_CODE_LENGTH) return { ok: false, reason: 'length', invalid: [] };
  return { ok: true, code: `${n.slice(0, 5)}-${n.slice(5)}` };
}
