import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Redirects to Login when there is no session; returns there afterwards. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="muted" style={{ padding: 24 }}>
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
