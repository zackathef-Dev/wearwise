import { z } from 'zod';
import { MAX_PASSWORD, MIN_PASSWORD, passwordStrength } from '@wearwise/password';

/* Form validation for the auth screens. These are the CLIENT half only — the same
 * rules exist server-side (Supabase password policy, the consent-gating trigger),
 * per the rule that client validation is duplicated, never trusted.
 *
 * Messages are user-facing copy and follow the brand voice: plain, specific,
 * no exclamation marks, say what to do next.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('That doesn’t look like an email address.');

/* Length-first policy, matching what we will configure server-side. Composition
 * rules (symbols, cases) are deliberately not enforced: length beats composition
 * for real-world strength, and composition rules push people to Password1!. */
/* A NEW password (sign-up, reset). Strength beyond these is recommended, not forced:
   the form shows it as you type (shared/components/PasswordStrength). */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`)
  .max(MAX_PASSWORD, `Use at most ${MAX_PASSWORD} characters.`)
  .refine((p) => p.length < MIN_PASSWORD || passwordStrength(p).acceptable, {
    message: 'That is one of the first passwords attackers try. Choose something less predictable.',
  });

export const signInSchema = z.object({
  email: emailSchema,
  /* No strength rule on sign-in: the password is whatever it was when set, and
     rejecting it client-side would leak which rule epoch the account is from. */
  password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a name to show in the app.')
    .max(80, 'Use at most 80 characters.'),
  email: emailSchema,
  password: passwordSchema,
  adult: z.literal(true, {
    errorMap: () => ({ message: 'WearWise is for people 18 or older.' }),
  }),
  terms: z.literal(true, {
    errorMap: () => ({ message: 'Please read and agree to the Terms of Use and Privacy Policy.' }),
  }),
  consent: z.literal(true, {
    errorMap: () => ({
      message: 'WearWise can’t store your readings without your consent.',
    }),
  }),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export type SignInForm = z.infer<typeof signInSchema>;
export type RegisterForm = z.infer<typeof registerSchema>;
export type ResetRequestForm = z.infer<typeof resetRequestSchema>;
