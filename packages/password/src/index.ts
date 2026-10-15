/* How strong a new password is, and what would make it stronger.
 *
 * Two things are required (the server enforces the first; the second stops the
 * passwords attackers try first): at least MIN_PASSWORD characters, and not a common
 * password. Everything else is a recommendation shown as the person types: length
 * matters most, then a mix of capital and lowercase letters, numbers and symbols.
 * Predictable patterns (abcd, 1234, qwerty, aaaa) and the person's own name or email
 * count against it.
 *
 * Pure, no dependencies: the phone app and the web dashboard both use it.
 */

/** Same minimum the server enforces (Auth → password_min_length). */
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

export type StrengthLabel = 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface StrengthCheck {
  id: 'length' | 'mixed-case' | 'number' | 'symbol' | 'not-common';
  label: string;
  met: boolean;
  /** Required to submit; the others are recommendations. */
  required: boolean;
}

export interface PasswordStrength {
  /** 0 too short, 1 weak, 2 fair, 3 good, 4 strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  checks: StrengthCheck[];
  /** May be submitted: long enough and not a common password. */
  acceptable: boolean;
  /** The one most useful next step, or null when it's already strong. */
  tip: string | null;
}

/* The passwords people pick first and attackers try first (leaked-password lists),
   compared after lower-casing and dropping trailing digits and symbols, so
   "Password123!" is caught too. */
const COMMON = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abc', 'abcdef', 'abcdefg', 'abcdefgh',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'login', 'master', 'monkey', 'dragon', 'football',
  'baseball', 'soccer', 'cricket', 'sunshine', 'princess', 'shadow', 'superman', 'batman', 'trustno', 'starwars',
  'whatever', 'freedom', 'secret', 'changeme', 'default', 'computer', 'internet', 'hello', 'hellohello', 'mustang',
  'michael', 'jennifer', 'charlie', 'jordan', 'hunter', 'ranger', 'harley', 'thomas', 'killer', 'pokemon',
  'australia', 'melbourne', 'sydney', 'brisbane', 'kangaroo', 'wearwise', 'wearable', 'health', 'doctor', 'nurse',
  'qwerty123', 'q1w2e3r4', 'q1w2e3r4t5', '1q2w3e4r', 'zaq12wsx', 'aaaaaa', 'abcd1234', 'password1', 'iloveyou1',
]);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** Does it contain a run of `len` characters that go up or down a common sequence? */
function hasSequence(pw: string, len = 4): boolean {
  const s = pw.toLowerCase();
  for (const seq of SEQUENCES) {
    for (const line of [seq, [...seq].reverse().join('')]) {
      for (let i = 0; i + len <= line.length; i++) if (s.includes(line.slice(i, i + len))) return true;
    }
  }
  return false;
}

const hasRepeat = (pw: string) => /(.)\1{2,}/.test(pw); // aaa, 111

function isCommon(pw: string): boolean {
  const core = pw.toLowerCase().replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '');
  return COMMON.has(core) || COMMON.has(pw.toLowerCase()) || /^\d+$/.test(pw) || new Set(pw.toLowerCase()).size <= 2;
}

/** Bits of the person's own details a password shouldn't be built on. */
function personal(pw: string, context: readonly string[]): boolean {
  const s = pw.toLowerCase();
  return context
    .flatMap((c) => c.toLowerCase().split(/[\s@._+-]+/))
    .some((part) => part.length >= 4 && s.includes(part));
}

const LABELS: StrengthLabel[] = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

/** `context`: the person's name and email, so a password built on them scores lower. */
export function passwordStrength(pw: string, context: readonly string[] = []): PasswordStrength {
  const lower = /[a-z]/.test(pw);
  const upper = /[A-Z]/.test(pw);
  const number = /\d/.test(pw);
  const symbol = /[^A-Za-z0-9]/.test(pw);
  const common = pw.length > 0 && isCommon(pw);
  const longEnough = pw.length >= MIN_PASSWORD;

  const checks: StrengthCheck[] = [
    { id: 'length', label: `At least ${MIN_PASSWORD} characters`, met: longEnough, required: true },
    { id: 'mixed-case', label: 'Capital and lowercase letters', met: lower && upper, required: false },
    { id: 'number', label: 'A number', met: number, required: false },
    { id: 'symbol', label: 'A symbol, like ! ? # or %', met: symbol, required: false },
    { id: 'not-common', label: 'Not a common password', met: pw.length > 0 && !common, required: true },
  ];

  let score: PasswordStrength['score'];
  if (!longEnough) score = 0;
  else if (common) score = 1;
  else {
    const variety = [lower, upper, number, symbol].filter(Boolean).length;
    let points = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : 1;
    if (variety >= 3) points += 1;
    if (variety === 4) points += 1;
    if (hasSequence(pw)) points -= 1;
    if (hasRepeat(pw)) points -= 1;
    if (personal(pw, context)) points -= 1;
    score = Math.max(1, Math.min(4, points)) as PasswordStrength['score'];
  }

  const tip = !pw ? null
    : !longEnough ? `Use at least ${MIN_PASSWORD} characters. Three or four random words work well.`
    : common ? 'This is one of the first passwords attackers try. Choose something less predictable.'
    : score === 4 ? null
    : personal(pw, context) ? 'Avoid your name or email in your password.'
    : hasSequence(pw) || hasRepeat(pw) ? 'Avoid runs like abcd, 1234 or aaa.'
    : !(lower && upper) ? 'Mix capital and lowercase letters.'
    : !number ? 'Add a number.'
    : !symbol ? 'Add a symbol, like ! ? # or %.'
    : 'Make it longer: 16 or more characters is strongest.';

  return { score, label: LABELS[score]!, checks, acceptable: longEnough && !common && pw.length <= MAX_PASSWORD, tip };
}
