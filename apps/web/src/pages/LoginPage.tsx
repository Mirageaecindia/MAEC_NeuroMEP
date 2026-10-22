import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import './login.css';

/** Workflow steps, named after the pages in the left navigation. */
const STEPS = [
  ['Import Floor Plan', 'Set up the project, upload floor-plan PDFs and calibrate scale.'],
  ['Floor Modeling', 'Place electrical components and draw connections; cables are sized live.'],
  [
    'Building Modeling',
    'Stack floors in 3D, define risers and connect to transformer and generator.',
  ],
  ['Architecture', 'Review the single-line diagram and panel schedules; lock or override sizes.'],
  ['Simulation & Report', 'Run generator scenarios, clear warnings and export schedules.'],
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const showDemoCredentials = import.meta.env.VITE_SHOW_DEMO_CREDENTIALS === 'true';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/projects';
  if (user) return <Navigate to={from} replace />;

  const emailError = !EMAIL.test(email.trim()) ? 'Enter a valid email address.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailTouched(true);
    if (emailError || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <header className="login-hero">
        <div className="login-kicker">Next-Generation Connected MEP Architecture</div>
        <h1>Design. Validate. Deliver. Intelligent Building Systems.</h1>
        <p>
          NeuroMEP unifies architectural CAD blueprints with automated multi-disciplinary routing,
          live compliance verification, and advanced physics simulation.
        </p>
      </header>
      <div className="login-cards">
        <section className="card login-workflow" aria-labelledby="workflow-title">
          <h2 id="workflow-title" className="card-title">
            End-to-End Engineering Workflow
          </h2>
          <ol>
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="step-no">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{title}</strong>
                  <span className="muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card login-form" aria-labelledby="signin-title">
          <h2 id="signin-title">Engineer Portal Sign In</h2>
          <p className="muted">Authenticate to access the workspace and floor plan designer</p>
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="email">
                User Email ID
              </label>
              <input
                id="email"
                className={`input${emailTouched && emailError ? ' invalid' : ''}`}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailTouched && !!emailError}
                aria-describedby={emailTouched && emailError ? 'email-error' : undefined}
              />
              {emailTouched && emailError && (
                <span id="email-error" className="field-error">
                  {emailError}
                </span>
              )}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <div className="input-group">
                <input
                  id="password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button className="btn btn-primary login-submit" type="submit" disabled={submitting}>
              {submitting && <span className="spinner" aria-hidden />}
              Sign In to Engineering Workspace →
            </button>
            {error && (
              <div className="banner banner-error" role="alert">
                {error}
              </div>
            )}
            <div className="login-links">
              <button type="button" className="btn-link" onClick={() => setForgot(true)}>
                Forgot password?
              </button>
              {forgot && <span className="muted">Contact your administrator.</span>}
            </div>
            {showDemoCredentials && (
              <p className="muted login-demo">
                Development users: <strong>lead@neuromep.dev</strong> (or electrical@, mechanical@,
                phe@, checker@, admin@) / <strong>neuromep-dev</strong>
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
