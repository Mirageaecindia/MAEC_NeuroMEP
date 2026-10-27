import {
  createEmptyProject,
  type Project,
  type ProjectSummary,
  type UserSummary,
} from '@neuromep/shared';
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

const SUMMARY: ProjectSummary = {
  id: 'p-1',
  name: 'AMR - EW09',
  clientName: 'MLD',
  designStage: 'SD',
  revision: 'A',
  updatedAt: FIXED_NOW,
  lastPage: 'modelling',
};

function fakeApi(project?: Project, projects: ProjectSummary[] = []): ApiClient {
  let current = project;
  return {
    listProjects: async () => ({ projects }),
    users: async () => ({ users: [LEAD, ELEC] }),
    getProject: async () => ({ project: current! }),
    saveProject: async (p: Project) => {
      current = { ...p, version: p.version + 1 };
      return { project: current };
    },
    createProject: vi.fn(async (p?: Project) => ({
      project: { ...(p ?? current!), id: 'p-new', version: 1 },
    })),
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

const tool = (name: string) =>
  within(screen.getByRole('toolbar', { name: 'Tools' })).getByRole('button', { name });

describe('#TASK-01 login (Figma screen 0)', () => {
  it('redirects to Login when there is no session', async () => {
    const router = renderAt('/projects', new FakeAuth(null), fakeApi());
    expect(
      await screen.findByRole('heading', { name: 'Engineer Portal Sign In' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the workflow card and demo-credentials line exactly as designed (A-03)', async () => {
    renderAt('/login', new FakeAuth(null), fakeApi());
    const steps = await screen.findByRole('list');
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('strong')!.textContent),
    ).toEqual([
      'Import Floor Plan',
      'Modeling Lab',
      'Visual Validation',
      'Architecture',
      'Simulation',
    ]);
    expect(screen.getByText(/Demo Credentials:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('signs in and opens All Projects', async () => {
    const router = renderAt('/projects', new FakeAuth(null), fakeApi(undefined, [SUMMARY]));
    await userEvent.type(await screen.findByLabelText('User Email ID'), 'lead@neuromep.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'right{Enter}');
    expect(await screen.findByText('Project Name : AMR - EW09')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/projects');
  });

  it('shows a plain error for wrong credentials and validates the email first', async () => {
    const auth = new FakeAuth(null);
    renderAt('/login', auth, fakeApi());
    await userEvent.type(await screen.findByLabelText('User Email ID'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'right{Enter}');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('User Email ID'));
    await userEvent.type(screen.getByLabelText('User Email ID'), 'lead@neuromep.dev');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'wrong{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });
});

describe('WBS 1.2.1 shell (A-03)', () => {
  it('has the five top tabs and a fully greyed toolbar on All Projects', async () => {
    renderAt('/projects', new FakeAuth(LEAD), fakeApi(undefined, [SUMMARY]));
    const tabs = await screen.findByRole('navigation', { name: 'Pages' });
    expect(
      within(tabs)
        .getAllByText(/./)
        .map((t) => t.textContent),
    ).toEqual(['All Projects', 'Import File', 'Floor Setup', 'Schematic', 'Output']);
    for (const b of within(screen.getByRole('toolbar', { name: 'Tools' })).getAllByRole('button')) {
      expect(b).toBeDisabled();
    }
  });

  it('opens a project card on its last page', async () => {
    const router = renderAt('/projects', new FakeAuth(LEAD), fakeApi(completeProject(), [SUMMARY]));
    await userEvent.click(await screen.findByRole('button', { name: /AMR - EW09/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/floor'));
  });
});

describe('#TASK-03 / #TASK-04 Import File (Figma screen 2)', () => {
  it('is editable for the Technical Lead and read-only for an Electrical Engineer', async () => {
    renderAt('/projects/p-1/import', new FakeAuth(ELEC), fakeApi(completeProject()));
    expect(await screen.findByLabelText(/Project Name/)).toBeDisabled();
    expect(screen.getByText(/viewing it read-only/)).toBeInTheDocument();
  });

  it('always calculates Current Carrying Capacity and Voltage Drop; the other checks are optional (A-06)', async () => {
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), fakeApi(completeProject()));
    const ccc = await screen.findByRole('checkbox', { name: 'Current Carrying Capacity' });
    expect(ccc).toBeChecked();
    expect(ccc).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Voltage Drop' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Short-circuit' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Earth Fault Loop Impedance' })).toBeEnabled();
  });

  it('shows demand factors as TBC and Next is enabled for a complete project', async () => {
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), fakeApi(completeProject()));
    expect(await screen.findByLabelText(/^Lighting/)).toHaveAttribute('placeholder', 'TBC');
    expect(tool('Next')).toBeEnabled();
  });

  it('Next on an incomplete project shows inline errors and keeps Floor Setup closed', async () => {
    const empty = {
      ...createEmptyProject({ id: 'p-2', userId: 'u-lead', now: FIXED_NOW }),
      version: 1,
    };
    const router = renderAt('/projects/p-2/import', new FakeAuth(LEAD), fakeApi(empty));
    await screen.findByLabelText(/Project Name/);
    expect(screen.queryByRole('link', { name: 'Floor Setup' })).not.toBeInTheDocument();
    await userEvent.click(tool('Next'));
    expect(await screen.findByText('Enter the project name.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/projects/p-2/import');
  });

  it('tabs open in order: Next opens the following tab, earlier tabs stay open (A-12)', async () => {
    const router = renderAt('/projects/p-1/import', new FakeAuth(LEAD), fakeApi(completeProject()));
    await screen.findByLabelText(/Project Name/);
    const tabs = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(tabs).getByRole('link', { name: 'Floor Setup' })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Schematic' })).not.toBeInTheDocument();
    await userEvent.click(tool('Next'));
    await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE');
    await userEvent.click(tool('Next'));
    await screen.findByText('Architecture Details');
    expect(router.state.location.pathname).toBe('/projects/p-1/schematic');
    await userEvent.click(screen.getByRole('link', { name: 'Floor Setup' }));
    await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE');
    expect(router.state.location.pathname).toBe('/projects/p-1/floor');
    expect(screen.getByRole('link', { name: 'Schematic' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Output' })).not.toBeInTheDocument();
  });

  it('a link to a tab not reached yet opens the furthest tab reached (A-12)', async () => {
    const router = renderAt('/projects/p-1/output', new FakeAuth(LEAD), fakeApi(completeProject()));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/floor'));
  });

  it('No of Floors builds the floor list Ground + First ... (A-05)', async () => {
    const empty = {
      ...createEmptyProject({ id: 'p-2', userId: 'u-lead', now: FIXED_NOW }),
      version: 1,
    };
    renderAt('/projects/p-2/import', new FakeAuth(LEAD), fakeApi(empty));
    await userEvent.type(await screen.findByLabelText(/No of Floors/), '2');
    await userEvent.tab();
    const picker = await screen.findByRole('combobox', { name: 'Floor' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Second Floor (no plan)', 'First Floor (no plan)', 'Ground Floor (no plan)']);
  });

  it('Save on an incomplete new project shows every missing field and creates nothing', async () => {
    const api = fakeApi();
    renderAt('/projects/new', new FakeAuth(LEAD), api);
    await screen.findByLabelText(/Project Name/);
    await userEvent.click(tool('Save'));
    expect(await screen.findByText('Enter the project name.')).toBeInTheDocument();
    expect(screen.getByText('Assign at least one Electrical engineer.')).toBeInTheDocument();
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('a new project is only for the Technical Lead (A-01)', async () => {
    renderAt('/projects/new', new FakeAuth(ELEC), fakeApi());
    expect(
      await screen.findByText(/Only the Technical Lead can create projects/),
    ).toBeInTheDocument();
  });
});

describe('#TASK-06 / #TASK-17 / #TASK-18 Floor Setup and Building tab (Figma 3.1 - 3.8)', () => {
  it('shows the component library, the capacity panel and a Cable Size button disabled until the source is connected (A-07)', async () => {
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(completeProject()));
    expect(
      await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transformer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cable Size' })).toBeDisabled();
  });

  it('Building tab: Cable Size Calculator is enabled only when every floor is connected; then Save', async () => {
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(completeProject()));
    await userEvent.click(await screenTool('Building'));
    const summary = screen.getByRole('complementary', { name: 'Building Summary' });
    const calc = within(summary).getByRole('button', { name: 'Cable Size Calculator' });
    expect(calc).toBeDisabled();
    await userEvent.type(within(summary).getByLabelText('Riser 1 length'), '26');
    for (const board of screen.getAllByRole('button', { name: / board$/ }))
      await userEvent.click(board);
    expect(calc).toBeEnabled();
    expect(within(summary).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(calc);
    expect(within(summary).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(summary).getByRole('button', { name: 'Demand Factors' })).toBeInTheDocument();
  });

  it('Building Summary lists the floors top-down with basements at the bottom (A-13)', async () => {
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(completeProject()));
    const summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    const names = within(summary)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
      .filter((t) => t?.endsWith(' :'));
    expect(names[0]).toMatch(/^Second Floor/);
    expect(names.indexOf('Ground Floor :')).toBe(names.length - 2);
    expect(names.at(-1)).toMatch(/^Basement/);
  });

  it('Demand Factors reopens the 12 load-type factors; a change needs a new Cable Size run (A-14)', async () => {
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(completeProject()));
    const summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    await userEvent.type(within(summary).getByLabelText('Riser 1 length'), '26');
    for (const board of screen.getAllByRole('button', { name: / board$/ }))
      await userEvent.click(board);
    await userEvent.click(within(summary).getByRole('button', { name: 'Cable Size Calculator' }));
    await userEvent.click(within(summary).getByRole('button', { name: 'Demand Factors' }));
    const dialog = screen.getByRole('dialog', { name: 'Demand Factors' });
    expect(within(dialog).getAllByPlaceholderText('TBC')).toHaveLength(12);
    await userEvent.type(within(dialog).getByLabelText('Lighting demand factor'), '1.5');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText('Lighting demand factor'));
    await userEvent.type(within(dialog).getByLabelText('Lighting demand factor'), '0.8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(summary).queryByRole('button', { name: 'Demand Factors' }),
    ).not.toBeInTheDocument();
  });
});

describe('#TASK-30 / #TASK-31 Schematic and Output (Figma 4, 5)', () => {
  it('Schematic lists transformers; Output shows a preview once a schedule is ticked', async () => {
    const project = completeProject();
    project.meta.reachedPage = 'simulation-report';
    renderAt('/projects/p-1/schematic', new FakeAuth(LEAD), fakeApi(project));
    expect(await screen.findByRole('checkbox', { name: 'All Transformer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Output' }));
    const second = await screen.findByRole('checkbox', { name: 'Second Level Schedule' });
    expect(screen.queryByRole('table', { name: /Schedule/ })).not.toBeInTheDocument();
    await userEvent.click(second);
    expect(screen.getByRole('table', { name: /Schedule SMDB/ })).toBeInTheDocument();
  });
});

async function screenTool(name: string) {
  await screen.findByRole('toolbar', { name: 'Tools' });
  return tool(name);
}
