import { passwordStrength } from '@wearwise/password';

const TONE = ['empty', 'weak', 'fair', 'good', 'strong'] as const;

/* Under a new-password box: a four-step meter, the label in words, the one most useful
   tip, and the checklist (required items say so). The rules live in @wearwise/password,
   shared with the phone app. `context`: the person's name and email. */
export function PasswordStrength({ id, password, context = [] }: { id: string; password: string; context?: string[] }) {
  const s = passwordStrength(password, context);
  return (
    <div className="pw-strength" id={id} aria-live="polite">
      <div className={`pw-meter ${TONE[s.score]}`} aria-hidden>
        {[1, 2, 3, 4].map((n) => <span key={n} className={n <= s.score ? 'on' : ''} />)}
      </div>
      {password && (
        <p className="small">
          <strong>Strength: {s.label}.</strong>{s.tip ? ` ${s.tip}` : ' Good choice.'}
        </p>
      )}
      <ul className="pw-checks">
        {s.checks.map((c) => (
          <li key={c.id} className={c.met ? 'met' : ''}>
            <span aria-hidden>{c.met ? '✓' : '○'}</span>
            {c.label}{c.required ? '' : <span className="muted"> (recommended)</span>}
            <span className="visually-hidden">{c.met ? ', done' : ', not yet'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
