import { Navigate, RouterProvider, type RouteObject } from 'react-router';
import type { ApiClient } from './api/client';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ArchitecturePage } from './pages/architecture/ArchitecturePage';
import { ModellingPage } from './pages/modelling/ModellingPage';
import { ProjectPickerPage } from './pages/ProjectPickerPage';
import { ReportPage } from './pages/report/ReportPage';
import { SetupPage } from './pages/setup/SetupPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/projects', element: <ProjectPickerPage /> },
      { path: '/projects/:projectId/setup', element: <SetupPage /> },
      { path: '/projects/:projectId/modelling', element: <ModellingPage /> },
      { path: '/projects/:projectId/architecture', element: <ArchitecturePage /> },
      { path: '/projects/:projectId/simulation-report', element: <ReportPage /> },
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
