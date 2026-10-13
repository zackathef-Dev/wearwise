import { Logo } from '../components/AppShell';

/* Shown instead of crashing when the build has no Supabase settings. */
export function NotConfiguredPage() {
  return (
    <div className="signin">
      <div className="card signin-card">
        <Logo className="logo" />
        <h1>Not configured</h1>
        <p className="muted">
          This build of the dashboard has no backend settings. Copy <code>apps/dashboard/.env.example</code> to{' '}
          <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (the same
          project as the phone app), and restart the dev server or rebuild.
        </p>
      </div>
    </div>
  );
}
