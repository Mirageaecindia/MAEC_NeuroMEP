import { Navigate, RouterProvider, type RouteObject } from 'react-router';
import type { ApiClient } from './api/client';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProjectPickerPage } from './pages/ProjectPickerPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/projects', element: <ProjectPickerPage /> },
      { path: '/projects/:projectId/setup', element: <PlaceholderPage pageKey="setup" /> },
      {
        path: '/projects/:projectId/floor-modelling',
        element: <PlaceholderPage pageKey="floor-modelling" />,
      },
      {
        path: '/projects/:projectId/building-modelling',
        element: <PlaceholderPage pageKey="building-modelling" />,
      },
      {
        path: '/projects/:projectId/architecture',
        element: <PlaceholderPage pageKey="architecture" />,
      },
      {
        path: '/projects/:projectId/simulation-report',
        element: <PlaceholderPage pageKey="simulation-report" />,
      },
    ],
  },
  { path: '*', element: <Navigate to="/projects" replace /> },
];

export function App(props: {
  auth: AuthProvider;
  api: ApiClient;
  router: Parameters<typeof RouterProvider>[0]['router'];
}) {
  return (
    <AuthProviderBoundary auth={props.auth} api={props.api}>
      <RouterProvider router={props.router} />
    </AuthProviderBoundary>
  );
}
