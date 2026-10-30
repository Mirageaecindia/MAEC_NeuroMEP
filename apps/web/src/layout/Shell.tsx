import { canCreateProject, initials, ROLE_LABELS } from '@neuromep/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth, useUser } from '../auth/AuthContext';
import { Icons } from './icons';
import './shell.css';

/** Top tabs (Figma, A-03). `path` is relative to the open project; null = no project needed. */
export const TABS = [
  { key: 'projects', label: 'All Projects' },
  { key: 'import', label: 'Import File' },
  { key: 'floor', label: 'Floor Setup' },
  { key: 'schematic', label: 'Schematic' },
  { key: 'output', label: 'Output' },
] as const;
export type TabKey = (typeof TABS)[number]['key'];

export function tabPath(tab: TabKey, projectId: string | null): string | null {
  if (tab === 'projects') return '/projects';
  if (tab === 'import') return projectId ? `/projects/${projectId}/import` : '/projects/new';
  return projectId ? `/projects/${projectId}/${tab}` : null;
}

/** Furthest tab the open project has reached (A-12); provided by the project workspace. */
export const ReachedTabContext = createContext<TabKey | null>(null);
const tabIndex = (t: TabKey) => TABS.findIndex((x) => x.key === t);

// ----- small notices (e.g. "Bot comes in a later release") -----
interface Notices {
  text: string | null;
  show: (text: string) => void;
  clear: () => void;
}
const NoticeContext = createContext<Notices>({
  text: null,
  show: () => undefined,
  clear: () => undefined,
});
/** Shows a short notice in the page frame. Works anywhere below NoticeProvider (App root). */
export const useNotice = () => useContext(NoticeContext).show;

/**
 * Holds the current notice above the router, so a page can raise one from its own code (the page
 * renders its Shell, so a provider inside Shell would not reach it) and it survives a navigation.
 */
export function NoticeProvider(props: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const show = useCallback((t: string) => setText(t), []);
  const clear = useCallback(() => setText(null), []);
  const value = useMemo(() => ({ text, show, clear }), [text, show, clear]);
  return <NoticeContext.Provider value={value}>{props.children}</NoticeContext.Provider>;
}

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

/**
 * Application frame of the Figma design: logo and a page-specific panel on the left (with an
 * optional Download button and the Appearance toggle at the bottom), top tabs with the user and
 * Sign Out, the shared toolbar, then the page.
 */
export function Shell(props: {
  tab: TabKey;
  projectId: string | null;
  sidebar?: ReactNode;
  sidebarFooter?: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const user = useUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const reached = useContext(ReachedTabContext);
  // Tabs open in order (A-12): earlier tabs any time, later ones only through Next.
  const canOpen = (t: TabKey) =>
    t === 'projects' ||
    (props.projectId
      ? tabIndex(t) <= tabIndex(reached ?? 'import')
      : t === 'import' && canCreateProject(user));
  const location = useLocation();
  // A page may hand a notice to the next one through the navigation state (e.g. after an
  // import); it shows once per navigation, whether or not this frame was replaced.
  const handed = (location.state as { notice?: string } | null)?.notice ?? null;
  const { text: own, clear } = useContext(NoticeContext);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const notice = own ?? (handed && seenKey !== location.key ? handed : null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => {
      clear();
      setSeenKey(location.key);
    }, 4000);
    return () => clearTimeout(t);
  }, [notice, location.key, clear]);

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <NavLink to="/projects" className="brand" title="All projects">
            <span className="brand-name">
              {Icons.logo()}
              <span>
                Neuro<span className="brand-accent">MEP</span>
              </span>
            </span>
            <span className="brand-tagline">DESIGN. VALIDATE. DELIVER.</span>
          </NavLink>
          <hr className="sidebar-rule" />
          <div className="sidebar-body">{props.sidebar}</div>
          <div className="sidebar-footer">
            {props.sidebarFooter}
            <div className="appearance">
              <span>Appearance</span>
              <button
                className="theme-toggle"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <nav className="tabs" aria-label="Pages">
              {TABS.map((t) => {
                const to = canOpen(t.key) ? tabPath(t.key, props.projectId) : null;
                const active = t.key === props.tab;
                return to ? (
                  <NavLink
                    key={t.key}
                    to={to}
                    className={() => `tab${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {t.label}
                  </NavLink>
                ) : (
                  <span
                    key={t.key}
                    className="tab disabled"
                    aria-disabled="true"
                    title={props.projectId ? 'Use Next to move on' : 'Open a project first'}
                  >
                    {t.label}
                  </span>
                );
              })}
            </nav>
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
          <div className="toolbar-row">{props.toolbar}</div>
          <main className="content">{props.children}</main>
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
      </div>
    </>
  );
}

/** Library-style panel with All / Electrical / Mechanical / PHE pills (left panel, Figma). */
export function DisciplineTabs(props: {
  value: string;
  onChange: (v: 'All' | 'Electrical' | 'Mechanical' | 'PHE') => void;
  disabled?: boolean;
}) {
  return (
    <div className="pill-tabs" role="tablist">
      {(['All', 'Electrical', 'Mechanical', 'PHE'] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={props.value === t}
          className={props.value === t ? 'active' : ''}
          disabled={props.disabled}
          onClick={() => props.onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
