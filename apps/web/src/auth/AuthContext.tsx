import type { UserSummary } from '@neuromep/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ApiClient } from '../api/client';
import type { AuthProvider } from './AuthProvider';

interface AuthState {
  user: UserSummary | null;
  /** True until the stored session has been checked. */
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ApiContext = createContext<ApiClient | null>(null);

export function AuthProviderBoundary(props: {
  auth: AuthProvider;
  api: ApiClient;
  children: ReactNode;
}) {
  const { auth, api } = props;
  const [user, setUser] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    auth.getCurrentUser().then((u) => {
      if (!live) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string) => setUser(await auth.signIn(email, password)),
    [auth],
  );
  const signOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
  }, [auth]);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );
  return (
    <ApiContext.Provider value={api}>
      <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
    </ApiContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProviderBoundary');
  return ctx;
}

/** The signed-in user; only for components behind ProtectedRoute. */
export function useUser(): UserSummary {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used inside AuthProviderBoundary');
  return ctx;
}
