import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { ApiClient } from './api/client';
import { App, routes } from './App';
import { HttpAuthProvider } from './auth/AuthProvider';
import './styles/global.css';

const auth = new HttpAuthProvider();
const api = new ApiClient(() => auth.getToken());
auth.attach(api);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App auth={auth} api={api} router={createBrowserRouter(routes)} />
  </StrictMode>,
);
