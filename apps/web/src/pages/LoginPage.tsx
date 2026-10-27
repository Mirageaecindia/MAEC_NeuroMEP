import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import './login.css';

/** Workflow card exactly as in the Figma login screen (A-03). */
const STEPS = [
  ['Import Floor Plan', 'Upload master PDF blueprints & define exact elevation data.'],
  ['Modeling Lab', 'Place electrical, mechanical, and PHE modules with smart wiring.'],
  ['Visual Validation', 'Inspect true 3D BIM isometric viewports with discipline coloring.'],
  ['Architecture', 'Generate system hierarchy and circuit protection layouts.'],
  ['Simulation', 'Run thermal distribution and pressure drop analytics natively.'],
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Demo-credentials line of the design (A-03). Development shows the seeded Technical Lead; a
 * deployed build shows it only when VITE_DEMO_EMAIL / VITE_DEMO_PASSWORD are set (e.g. staging).
 */
const DEMO = import.meta.env.DEV
  ? { email: 'lead@neuromep.dev', password: 'neuromep-dev' }
  : import.meta.env.VITE_DEMO_EMAIL && import.meta.env.VITE_DEMO_PASSWORD
    ? { email: import.meta.env.VITE_DEMO_EMAIL, password: import.meta.env.VITE_DEMO_PASSWORD }
    : null;

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
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
            {DEMO && (
              <p className="muted login-demo">
                Demo Credentials: <strong>{DEMO.email}</strong> / <strong>{DEMO.password}</strong>
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
