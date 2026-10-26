import { initials, ROLE_LABELS } from '@neuromep/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useAuth, useUser } from '../auth/AuthContext';
import './layout.css';

/** Working pages 1-4 in navigation order (design doc Section 9, D-20). */
export const PAGES = [
  { key: 'setup', label: 'Import Floor Plan', title: 'Project Set-up & Import Floor Plan' },
  { key: 'modelling', label: 'Floor & Building Modelling', title: 'Floor & Building Modelling' },
  { key: 'architecture', label: 'Architecture', title: 'Architecture' },
  { key: 'simulation-report', label: 'Simulation and Report', title: 'Simulation & Report' },
] as const;

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('neuromep.theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('neuromep.theme', theme);
    } catch {
      /* preference only */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

/** Left navigation + top bar with user, role and Sign Out. `projectId` enables the page links. */
export function AppShell(props: { projectId?: string; children: ReactNode; actions?: ReactNode }) {
  const user = useUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/projects" className="brand" title="All projects">
          <div className="brand-name">
            <span className="brand-mark" aria-hidden>
              ◈
            </span>
            Neuro<span className="brand-accent">MEP</span>
          </div>
          <div className="brand-tagline">DESIGN. VALIDATE. DELIVER.</div>
        </NavLink>
        <nav className="nav" aria-label="Pages">
          {PAGES.map((p) =>
            props.projectId ? (
              <NavLink
                key={p.key}
                to={`/projects/${props.projectId}/${p.key}`}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                {p.label}
              </NavLink>
            ) : (
              <span key={p.key} className="nav-item disabled" title="Open a project first">
                {p.label}
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          <span>Appearance</span>
          <button
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-actions">{props.actions}</div>
          <div className="user">
            <span className="avatar" aria-hidden>
              {initials(user.name)}
            </span>
            <span>
              <span className="user-name">{user.name}</span>
              <span className="user-role">{ROLE_LABELS[user.role]}</span>
            </span>
            <button
              className="btn btn-sm btn-danger-outline"
              onClick={async () => {
                await signOut();
                navigate('/login', { replace: true });
              }}
            >
              Sign Out
            </button>
          </div>
        </header>
        <main className="content">{props.children}</main>
      </div>
    </div>
  );
}
