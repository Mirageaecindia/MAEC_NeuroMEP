import type { UserSummary } from '@neuromep/shared';
import { completeProject } from '@neuromep/shared/testing';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import { App, routes } from '../App';
import type { AuthProvider } from '../auth/AuthProvider';

const LEAD: UserSummary = {
  id: 'u-lead',
  name: 'Alex Morgan',
  email: 'lead@neuromep.dev',
  role: 'TECHNICAL_LEAD',
};
const auth: AuthProvider = {
  signIn: async () => LEAD,
  signOut: async () => undefined,
  getCurrentUser: async () => LEAD,
  getToken: () => 'token',
};
const api = {
  getProject: async () => ({ project: completeProject() }),
  users: async () => ({ users: [LEAD] }),
} as unknown as ApiClient;

const renderAt = (path: string) =>
  render(
    <App auth={auth} api={api} router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );

describe('WBS 1.2.1 UI shell and page layouts', () => {
  it('shows the four working pages in the navigation (D-20)', async () => {
    renderAt('/projects/p-1/modelling');
    const nav = await screen.findByRole('navigation', { name: 'Pages' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      '1Import Floor Plan',
      '2Floor & Building Modelling',
      '3Architecture',
      '4Simulation & Report',
    ]);
  });

  it('Page 2 switches between Floor view and Building view with the top-right toggle', async () => {
    renderAt('/projects/p-1/modelling');
    expect(await screen.findByRole('region', { name: 'Floor view' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Building' }));
    expect(screen.getByRole('region', { name: 'Building view' })).toBeInTheDocument();
    expect(screen.getByLabelText('Riser')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Building' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Page 2 has the load table, Cable Size with scope, and the component library', async () => {
    renderAt('/projects/p-1/modelling');
    const panel = await screen.findByRole('complementary', { name: 'Right panel' });
    expect(within(panel).getByRole('table')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Scope')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Cable Size' }));
    expect(within(panel).getByText('Sized by')).toBeInTheDocument();
    const library = screen.getByRole('region', { name: 'Component library' });
    expect(
      within(library)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['All', 'Electrical', 'Mechanical', 'PHE']);
  });

  it('Page 3 shows the network tree and panel schedule; Page 4 the scenarios and check list', async () => {
    const { unmount } = renderAt('/projects/p-1/architecture');
    expect(await screen.findByRole('region', { name: 'Network tree' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Panel schedule' })).toBeInTheDocument();
    unmount();
    renderAt('/projects/p-1/simulation-report');
    expect(await screen.findByRole('radio', { name: 'Standby - fire mode' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Final check list' })).toBeInTheDocument();
  });
});
