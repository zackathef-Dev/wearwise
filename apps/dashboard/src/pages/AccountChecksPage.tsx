import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth, type AccountNeeds } from '../auth/AuthProvider';
import { Logo } from '../components/AppShell';
import { Alert, Button } from '../components/ui';

/* BEFORE YOU CONTINUE — what a signed-in account must answer before anything else:
   that the person is 18 or older (accounts made before that rule) and/or the current
   terms (new, or changed since last accepted). Staff also agree to the researcher terms.
   "I'm under 18" explains and signs out. Document links open in a new tab, so the
   answers here aren't lost. */
export function AccountChecksPage({ needs, staff, updated }: { needs: AccountNeeds; staff: boolean; updated: boolean }) {
  const { confirmAccount, signOut } = useAuth();
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [under18, setUnder18] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = (!needs.adult || adult) && (!needs.terms || terms);

  const submit = async () => {
    setBusy(true);
    setProblem(await confirmAccount(needs));
    setBusy(false);
  };

  const doc = (slug: string, label: string) => <Link to={`/legal/${slug}`} target="_blank" rel="noopener">{label}</Link>;

  return (
    <div className="signin">
      <div className="card signin-card">
        <Logo className="logo" />
        {under18 ? (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>WearWise is for adults</h1>
              <p className="muted">
                WearWise is a research study for people 18 or older, so this account can’t be used. If you’d like your
                account and readings deleted, ask the study team and they will remove them.
              </p>
            </div>
            <Button variant="primary" icon="log-out" onClick={() => void signOut()}>Sign out</Button>
            <Button variant="ghost" onClick={() => setUnder18(false)}>Back</Button>
          </>
        ) : (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Before you continue</h1>
              <p className="muted">
                {needs.terms && updated
                  ? 'We’ve updated our terms and privacy information. Please read them and agree to keep using WearWise.'
                  : 'Please confirm the following to keep using your account. You only need to do this once.'}
              </p>
            </div>
            {needs.adult && (
              <label className="check-row">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                <span><strong>I’m 18 or older</strong><span className="small muted">WearWise is a research study for adults.</span></span>
              </label>
            )}
            {needs.terms && (
              <label className="check-row">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>
                  <strong>I agree to the {doc('terms', 'Terms of Use')} and {doc('privacy', 'Privacy Policy')}</strong>
                  <span className="small muted">
                    And I’ve read the {doc('collection-notice', 'Collection Notice')} and the {doc('research', 'research information')}
                    {staff && <>, and agree to the {doc('researcher-terms', 'Researcher & clinician terms')}</>}.
                  </span>
                </span>
              </label>
            )}
            {problem && <Alert kind="error">{problem}</Alert>}
            <Button variant="primary" busy={busy} disabled={!ready} onClick={() => void submit()}>Continue</Button>
            {needs.adult && <Button variant="secondary" disabled={busy} onClick={() => setUnder18(true)}>I’m under 18</Button>}
            <Button variant="ghost" icon="log-out" disabled={busy} onClick={() => void signOut()}>Sign out</Button>
          </>
        )}
      </div>
    </div>
  );
}
