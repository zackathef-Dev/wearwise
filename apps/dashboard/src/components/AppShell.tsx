import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAlerts } from '../alerts/AlertsProvider';
import { useAuth, useViewer } from '../auth/AuthProvider';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { LegalFooter } from '../pages/LegalPages';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { useIsDark, useThemePreference } from '../theme/useColorScheme';
import { setThemePreference } from '../theme/theme-preference';
import logo from '../assets/brand/logo.svg';
import logoReversed from '../assets/brand/logo-reversed.svg';
import wordmark from '../assets/brand/wordmark.svg';
import wordmarkReversed from '../assets/brand/wordmark-reversed.svg';

const ROLE_LABEL: Record<string, string> = { participant: 'Participant', researcher: 'Researcher', clinician: 'Clinician' };

export function Logo({ className }: { className?: string }) {
  return <img src={useIsDark() ? logoReversed : logo} alt="WearWise" className={className} />;
}

/* The header's brand: the WearWise wordmark alone, as at the top of the app's Home.
   (Sign-in and the other standalone pages keep the full logo with its symbol.) */
function Wordmark() {
  return <img src={useIsDark() ? wordmarkReversed : wordmark} alt="WearWise" className="wordmark" />;
}

/* Up to two initials from the display name, else the email's first letter. */
const initials = (name: string, email: string): string => {
  const words = name.trim().split(/[\s.]+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]!) : [email[0] ?? '?'];
  return letters.join('').toUpperCase();
};

export function AppShell() {
  const { signOut } = useAuth();
  const { email, profile, staff } = useViewer();
  const { unread } = useAlerts();
  const [changingPassword, setChangingPassword] = useState(false);
  const theme = useThemePreference();
  const home = staff ? '/participants' : '/me';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to={home} className="brand" aria-label="WearWise home">
            <Wordmark />
          </NavLink>
          <nav className="topnav" aria-label="Main">
            {staff ? (
              <>
                <NavLink to="/participants">Participants</NavLink>
                <NavLink to="/patches">Patch setup</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/me">My data</NavLink>
                <NavLink to="/sharing">Sharing</NavLink>
              </>
            )}
          </nav>
          <div className="viewer">
            <Link to="/alerts" className="btn btn-ghost btn-icon bell" aria-label={unread ? `Alerts, ${unread} new` : 'Alerts'} title="Alerts">
              <Icon name="bell" size={18} />
              {unread > 0 && <span className="bell-count" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <Menu
              label="Account" triggerClassName="account-button" width={260}
              trigger={<>
                <span className="avatar" aria-hidden>{initials(profile.displayName, email)}</span>
                <span className="account-name hide-sm">{profile.displayName || email}</span>
                <Icon name="chevron-down" size={14} />
              </>}
              header={<>
                <strong>{profile.displayName || email}</strong>
                {profile.displayName && <span className="small muted">{email}</span>}
                <span className="small muted">{ROLE_LABEL[profile.role] ?? profile.role}</span>
              </>}
              items={[
                { label: 'System', icon: 'monitor', section: 'Theme', checked: theme === 'system', onSelect: () => setThemePreference('system') },
                { label: 'Light', icon: 'sun', checked: theme === 'light', onSelect: () => setThemePreference('light') },
                { label: 'Dark', icon: 'moon', checked: theme === 'dark', onSelect: () => setThemePreference('dark') },
                { label: 'Change password', icon: 'key-round', separated: true, onSelect: () => setChangingPassword(true) },
                { label: 'Sign out', icon: 'log-out', separated: true, onSelect: () => void signOut() },
              ]}
            />
          </div>
        </div>
      </header>
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
      <main className="page" id="main">
        <Outlet />
      </main>
      <footer className="footer">
        WearWise shows measurements only. It is not a medical device and does not diagnose or recommend treatment.
        {staff
          ? ' You can see only what each participant chose to share, and only while they keep sharing it.'
          : ' Only you, and the people you choose to share with, can see your data.'}
        <LegalFooter />
      </footer>
    </div>
  );
}
