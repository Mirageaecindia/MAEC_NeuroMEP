import { createEmptyProject, type Project, type UserSummary } from '@neuromep/shared';
import { completeProject, FIXED_NOW } from '@neuromep/shared/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from './api/client';
import { App, routes } from './App';
import type { AuthProvider } from './auth/AuthProvider';

const LEAD: UserSummary = {
  id: 'u-lead',
  name: 'Alex Morgan',
  email: 'lead@neuromep.dev',
  role: 'TECHNICAL_LEAD',
};
const ELEC: UserSummary = {
  id: 'u-elec',
  name: 'Sam Patel',
  email: 'electrical@neuromep.dev',
  role: 'ELECTRICAL_ENGINEER',
};

/** In-memory AuthProvider: one valid password, like the dev provider. */
class FakeAuth implements AuthProvider {
  constructor(public user: UserSummary | null = null) {}
  signIn = vi.fn(async (email: string, password: string) => {
    if (password !== 'right') throw new Error('Email or password is incorrect.');
    this.user = { ...LEAD, email };
    return this.user;
  });
  async signOut() {
    this.user = null;
  }
  async getCurrentUser() {
    return this.user;
  }
  getToken() {
    return this.user ? 'token' : null;
  }
}

function fakeApi(project?: Project): ApiClient {
  let current = project;
  return {
    listProjects: async () => ({ projects: [] }),
    users: async () => ({ users: [LEAD, ELEC] }),
    getProject: async () => ({ project: current! }),
    saveProject: async (p: Project) => {
      current = { ...p, version: p.version + 1 };
      return { project: current };
    },
    downloadPlan: async () => {
      throw new ApiError(404, 'Plan file not found.');
    },
  } as unknown as ApiClient;
}

function renderAt(path: string, auth: AuthProvider, api: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App auth={auth} api={api} router={router} />);
  return router;
}

describe('login and protected routes', () => {
  it('redirects to Login when there is no session', async () => {
    const router = renderAt('/projects', new FakeAuth(null), fakeApi());
    expect(
      await screen.findByRole('heading', { name: 'Engineer Portal Sign In' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the workflow steps with the page names and no demo credentials by default', async () => {
    renderAt('/login', new FakeAuth(null), fakeApi());
    const steps = await screen.findByRole('list');
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('strong')!.textContent),
    ).toEqual([
      'Import Floor Plan',
      'Floor Modeling',
      'Building Modeling',
      'Architecture',
      'Simulation & Report',
    ]);
    expect(screen.queryByText(/neuromep-dev/)).not.toBeInTheDocument();
  });

  it('signs in and returns to the page that was asked for', async () => {
    const auth = new FakeAuth(null);
    const router = renderAt('/projects', auth, fakeApi());
    await userEvent.type(await screen.findByLabelText('User Email ID'), 'lead@neuromep.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'right{Enter}');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/projects');
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument();
  });

  it('shows a plain error for wrong credentials', async () => {
    renderAt('/login', new FakeAuth(null), fakeApi());
    await userEvent.type(await screen.findByLabelText('User Email ID'), 'lead@neuromep.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /Sign In to Engineering Workspace/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('validates the email format before calling the provider', async () => {
    const auth = new FakeAuth(null);
    renderAt('/login', auth, fakeApi());
    await userEvent.type(await screen.findByLabelText('User Email ID'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'right{Enter}');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('toggles password visibility', async () => {
    renderAt('/login', new FakeAuth(null), fakeApi());
    const pw = await screen.findByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(pw).toHaveAttribute('type', 'text');
  });
});

describe('Page 1 roles', () => {
  it('is read-only for an Electrical Engineer', async () => {
    renderAt('/projects/p-1/setup', new FakeAuth(ELEC), fakeApi(completeProject()));
    const name = await screen.findByLabelText(/Project Name/);
    expect(name).toBeDisabled();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Project' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update floor registry' })).toBeDisabled();
  });

  it('is editable for the Technical Lead', async () => {
    renderAt('/projects/p-1/setup', new FakeAuth(LEAD), fakeApi(completeProject()));
    const name = await screen.findByLabelText(/Project Name/);
    expect(name).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save Project' })).toBeInTheDocument();
  });
});

describe('Page 1 Next button', () => {
  it('is disabled for an incomplete project and lists what is missing', async () => {
    const empty = {
      ...createEmptyProject({ id: 'p-2', userId: 'u-lead', now: FIXED_NOW }),
      version: 1,
    };
    renderAt('/projects/p-2/setup', new FakeAuth(LEAD), fakeApi(empty));
    const next = await screen.findByRole('button', { name: 'Next →' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(next.parentElement!);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Card 1: Enter the project name.');
    expect(tip).toHaveTextContent('Card 5: Assign at least one Electrical engineer.');
    // Clicking it shows every inline error and stays on the page.
    await userEvent.click(next);
    expect(await screen.findByText('Enter the client name.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Project Set-up/ })).toBeInTheDocument();
  });

  it('shows the TBC demand-factor warning without blocking Next (D-19)', async () => {
    renderAt('/projects/p-1/setup', new FakeAuth(LEAD), fakeApi(completeProject()));
    expect(await screen.findByText(/16 of 16 factors have/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next →' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('is enabled when everything required is valid and a floor is calibrated', async () => {
    renderAt('/projects/p-1/setup', new FakeAuth(LEAD), fakeApi(completeProject()));
    expect(await screen.findByRole('button', { name: 'Next →' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('shows inline errors after a field is left empty, without blocking typing', async () => {
    const empty = {
      ...createEmptyProject({ id: 'p-2', userId: 'u-lead', now: FIXED_NOW }),
      version: 1,
    };
    renderAt('/projects/p-2/setup', new FakeAuth(LEAD), fakeApi(empty));
    const name = await screen.findByLabelText(/Project Name/);
    await userEvent.click(name);
    await userEvent.tab();
    expect(await screen.findByText('Enter the project name.')).toBeInTheDocument();
    await userEvent.type(name, 'Tower');
    expect(name).toHaveValue('Tower');
    await waitFor(() =>
      expect(screen.queryByText('Enter the project name.')).not.toBeInTheDocument(),
    );
  });
});
