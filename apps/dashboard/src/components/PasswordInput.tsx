import { useState, type InputHTMLAttributes } from 'react';

/* A password box with a Show/Hide toggle, like the phone app's. The toggle is a
   real button (keyboard and screen readers reach it) and never submits the form. */
export function PasswordInput({ id, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-field">
      <input id={id} className="input" type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" {...rest} />
      <button type="button" className="password-toggle" aria-controls={id} aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((s) => !s)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
