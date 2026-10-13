import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AlertsProvider } from './alerts/AlertsProvider';
import { AuthProvider, useAuth, useViewer } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { Button, ErrorState, LoadingState } from './components/ui';
import { supabase } from './data/client';
import { SignInPage } from './pages/SignInPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { ParticipantPage } from './pages/ParticipantPage';
import { SessionPage } from './pages/SessionPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotConfiguredPage } from './pages/NotConfiguredPage';
import { AlertsPage } from './pages/AlertsPage';
import { SharingPage } from './pages/SharingPage';
import { AccountChecksPage } from './pages/AccountChecksPage';
import { LegalDocPage, LegalIndexPage } from './pages/LegalPages';

/* Patch setup carries the USB flasher (esptool-js and its flasher stubs): loaded
   only when someone opens it. */
const PatchSetupPage = lazy(() => import('./pages/PatchSetupPage').then((m) => ({ default: m.PatchSetupPage })));

/* Routes. Everything except /sign-in and /reset-password sits behind the sign-in
   gate. Every account has My data, Alerts and Sharing; researchers and clinicians
   ("staff") also have Participants (what is shared with them) and Patch setup. */

function RequireViewer() {
  const { state, retry, signOut } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <div className="signin"><LoadingState label="Checking your account…" /></div>;
  if (state.status === 'signed-out') return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  if (state.status === 'error') {
    return (
      <div className="signin">
        <div className="card signin-card">
          <ErrorState title="Your account couldn’t be checked" message={state.message} onRetry={retry} />
          <Button variant="ghost" icon="log-out" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }
  /* 18+ and the current terms, before anything else (AccountChecksPage). */
  if (state.needs.adult || state.needs.terms) {
    return <AccountChecksPage needs={state.needs} staff={state.staff} updated={state.needs.terms && !state.needs.adult} />;
  }
  return (
    <AlertsProvider>
      <Outlet />
    </AlertsProvider>
  );
}

function Home() {
  return <Navigate to={useViewer().staff ? '/participants' : '/me'} replace />;
}

/** Staff-only pages: anyone else is sent to their own data. */
function RequireStaff() {
  return useViewer().staff ? <Outlet /> : <Navigate to="/me" replace />;
}

const lazyPage = (node: ReactNode, label: string) => <Suspense fallback={<LoadingState label={label} />}>{node}</Suspense>;

export function App() {
  if (!supabase) return <NotConfiguredPage />;
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/legal" element={<LegalIndexPage />} />
          <Route path="/legal/:slug" element={<LegalDocPage />} />
          <Route element={<RequireViewer />}>
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="me" element={<ParticipantPage self />} />
              <Route path="me/sessions/:sessionId" element={<SessionPage self />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="sharing" element={<SharingPage />} />
              <Route element={<RequireStaff />}>
                <Route path="participants" element={<ParticipantsPage />} />
                <Route path="participants/:participantId" element={<ParticipantPage />} />
                <Route path="participants/:participantId/sessions/:sessionId" element={<SessionPage />} />
                <Route path="patches" element={lazyPage(<PatchSetupPage />, 'Loading patch setup…')} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
