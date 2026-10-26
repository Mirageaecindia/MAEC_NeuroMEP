import { Navigate, RouterProvider, type RouteObject } from 'react-router';
import type { ApiClient } from './api/client';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { FloorSetupPage } from './pages/floor/FloorSetupPage';
import { ImportFilePage, NewProjectPage } from './pages/import/ImportFilePage';
import { LoginPage } from './pages/LoginPage';
import { OutputPage } from './pages/output/OutputPage';
import { AllProjectsPage } from './pages/projects/AllProjectsPage';
import { SchematicPage } from './pages/schematic/SchematicPage';
import { ProjectWorkspace } from './workspace/ProjectWorkspace';

/** Login, then the five top tabs of the Figma design (A-03). */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/projects', element: <AllProjectsPage /> },
      { path: '/projects/new', element: <NewProjectPage /> },
      {
        path: '/projects/:projectId',
        element: <ProjectWorkspace />,
        children: [
          { index: true, element: <Navigate to="import" replace /> },
          { path: 'import', element: <ImportFilePage /> },
          { path: 'floor', element: <FloorSetupPage /> },
          { path: 'schematic', element: <SchematicPage /> },
          { path: 'output', element: <OutputPage /> },
        ],
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
