import {
  createEmptyProject,
  isPlaceable,
  libraryItem,
  placeElement,
  setBoardRiser,
  setRiser,
  type Element,
  type Project,
  type ProjectSummary,
  type UserSummary,
} from '@neuromep/shared';
import {
  completeProject,
  FIXED_NOW,
  modelledProject,
  testCable,
  testElement,
} from '@neuromep/shared/testing';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

/** Ends the session from the server side, as an expired cookie would (set by fakeApi). */
let endSession: () => void = () => undefined;

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
      plansToUpload: p ? p.building.floors.filter((f) => f.plan).length : 0,
    })),
    downloadPlan: async () => {
      throw new ApiError(404, 'Plan file not found.');
    },
    symbols: async () => ({ symbols: [] }),
    nextExportVersion: vi.fn(async () => ({ version: 1 })),
    setUnauthorizedHandler: (handler: () => void) => {
      endSession = handler;
      return () => undefined;
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

  it('returns to Login when the session ends while working (WBS 1.2.2)', async () => {
    const router = renderAt('/projects', new FakeAuth(LEAD), fakeApi(undefined, [SUMMARY]));
    await screen.findByText('Project Name : AMR - EW09');
    act(() => endSession());
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
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

describe('#TASK-08 persistence (WBS 1.2.5)', () => {
  it('autosaves 10 s after the first change; further typing does not push it back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const api = fakeApi(completeProject());
      const save = vi.spyOn(api, 'saveProject');
      renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
      const name = await screen.findByLabelText(/Project Name/);
      await user.type(name, 'X');
      await act(() => vi.advanceTimersByTimeAsync(6000));
      await user.type(name, 'Y');
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(save).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]![0].details.name).toBe('NeoTowerXY');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#TASK-08 version conflicts (WBS 1.2.5)', () => {
  it('reports a conflict and reloads the newer version on request (E0802)', async () => {
    const api = fakeApi(completeProject());
    const newer = { ...completeProject(), version: 5 };
    newer.details = { ...newer.details, name: 'Saved by someone else' };
    api.saveProject = async () => {
      throw new ApiError(
        409,
        'Someone else saved this project after you opened it (E0802)',
        {},
        'E0802',
      );
    };
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
    const name = await screen.findByLabelText(/Project Name/);
    await userEvent.type(name, 'X');
    await userEvent.click(tool('Save'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('E0802');
    api.getProject = async () => ({ project: newer });
    await userEvent.click(within(alert).getByRole('button', { name: /Reload/ }));
    expect(await screen.findByDisplayValue('Saved by someone else')).toBeInTheDocument();
  });
});

describe('#TASK-02 All Projects (WBS 1.2.3)', () => {
  it('shows stage, revision and last modified on hover (FR-02)', async () => {
    renderAt('/projects', new FakeAuth(LEAD), fakeApi(undefined, [SUMMARY]));
    const card = await screen.findByRole('button', { name: /AMR - EW09/ });
    expect(card.title).toMatch(/^Stage: .+ · Revision: A · Last modified: /);
  });

  it('tells an engineer with no projects how they get one', async () => {
    renderAt('/projects', new FakeAuth(ELEC), fakeApi(undefined, []));
    expect(await screen.findByText(/No projects are assigned to you yet/)).toBeInTheDocument();
  });

  it('offers to try again when the list cannot be loaded', async () => {
    const api = fakeApi(undefined, [SUMMARY]);
    const ok = api.listProjects.bind(api);
    let calls = 0;
    api.listProjects = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(0, 'Cannot reach the NeuroMEP server.');
      return ok();
    };
    renderAt('/projects', new FakeAuth(LEAD), api);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Project Name : AMR - EW09')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('imports a project file as a new project and asks for its floor plans again', async () => {
    const api = fakeApi(completeProject());
    const router = renderAt('/projects/new', new FakeAuth(LEAD), api);
    const file = new File([JSON.stringify(completeProject())], 'NeoTower.json', {
      type: 'application/json',
    });
    await userEvent.upload(await screen.findByLabelText('Project file'), file);
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-new/import'));
    expect(
      await screen.findByText(/1 floor plan is not inside a project file: upload it again/),
    ).toBeInTheDocument();
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
    expect(await screen.findByRole('textbox', { name: /^Lighting\*?$/ })).toHaveAttribute(
      'placeholder',
      'TBC',
    );
    expect(tool('Next')).toBeEnabled();
  });

  it('Demand Method switches the factor sets; Busbar Manufacturer is chosen per project (3 Nov 2026)', async () => {
    const api = fakeApi(completeProject());
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
    const method = await screen.findByLabelText('Demand Method');
    expect(method).toHaveValue('dubai-non-emaar');
    await userEvent.selectOptions(method, 'dubai-emaar');
    expect(screen.getByLabelText(/^Residential/)).toHaveValue('0.6');
    expect(screen.getByLabelText(/^SMDB level/)).toHaveValue('0.8');
    await userEvent.selectOptions(method, 'manual');
    expect(screen.queryByLabelText(/^SMDB level/)).not.toBeInTheDocument();
    expect(screen.getByText('The load-type factors apply at every board.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Busbar Manufacturer'), 'schneider');
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.calculation).toMatchObject({
        demandMethod: 'manual',
        busbarMaker: 'schneider',
      }),
    );
  });

  it('Load Power Factor per load type: rule-pack values, Lead edits kept as overrides (6 Nov 2026)', async () => {
    const api = fakeApi(completeProject());
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
    const lighting = await screen.findByLabelText('Lighting power factor');
    expect(lighting).toHaveValue('0.85');
    expect(screen.getByLabelText('Power power factor')).toHaveValue('0.8');
    expect(screen.getByLabelText('Heater power factor')).toHaveValue('1');
    expect(screen.getByLabelText('Kitchen power factor')).toHaveValue('0.85'); // the default
    await userEvent.clear(lighting);
    await userEvent.type(lighting, '1.5{Enter}');
    expect(lighting).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(lighting);
    await userEvent.type(lighting, '0.9{Enter}');
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect(
        (await api.getProject('p-1')).project.calculation.defaultOverrides['loadPowerFactor.1'],
      ).toBe(0.9),
    );
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

  it('Floor Plans below Plot Ref matches chosen PDFs to floors from the lowest up', async () => {
    const project = completeProject();
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), fakeApi(project));
    const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });
    await userEvent.upload(await screen.findByLabelText('Floor plan files'), [
      pdf('first.pdf'),
      pdf('second.pdf'),
    ]);
    const dialog = await screen.findByRole('dialog', { name: 'Match floor plans to floors' });
    const [lowest, next, third] = project.building.floors;
    const picked = (f: typeof lowest) =>
      (within(dialog).getByLabelText(`Plan for ${f!.name}`) as HTMLSelectElement).selectedOptions[0]
        ?.textContent;
    expect(picked(lowest)).toBe('first.pdf');
    expect(picked(next)).toBe('second.pdf');
    if (third) expect(picked(third)).toMatch(/No plan|Keep current plan/);
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

  it('asks before changing a calculation input once modelling has started (Section 9)', async () => {
    const api = fakeApi(modelledProject());
    const save = vi.spyOn(api, 'saveProject');
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
    const air = await screen.findByLabelText(/Ambient Air/);
    await userEvent.clear(air);
    await userEvent.type(air, '48');
    await userEvent.tab();
    let dialog = screen.getByRole('dialog', { name: 'Change an earlier page?' });
    expect(dialog).toHaveTextContent('from 50 to 48');
    expect(dialog).toHaveTextContent('This affects 1 floor (Ground Floor), 1 panel and 0 cables');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText(/Ambient Air/)).toHaveValue('50');

    await userEvent.clear(screen.getByLabelText(/Ambient Air/));
    await userEvent.type(screen.getByLabelText(/Ambient Air/), '48');
    await userEvent.tab();
    dialog = screen.getByRole('dialog', { name: 'Change an earlier page?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(screen.getByLabelText(/Ambient Air/)).toHaveValue('48');
    await userEvent.click(tool('Save'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls.at(-1)![0];
    expect(saved.site.ambientAirC.value).toBe(48);
    expect(saved.auditLog.at(-1)).toMatchObject({
      area: 'earlierPageChange',
      key: 'site.ambientAirC',
      from: 50,
      to: 48,
    });
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
  it('#TASK-10 lets the assigned electrical engineer upload plans; a checker only views', async () => {
    renderAt('/projects/p-1/floor', new FakeAuth(ELEC), fakeApi(completeProject()));
    await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE');
    expect(tool('Open')).toBeEnabled();
    cleanup();
    const checker: UserSummary = { ...ELEC, id: 'u-check', role: 'CHECKER' };
    renderAt('/projects/p-1/floor', new FakeAuth(checker), fakeApi(completeProject()));
    await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE');
    expect(tool('Open')).toBeDisabled();
  });

  it('#TASK-28 checks each transformer against its kVA x the loading limit (E2801, 80 % ticked)', async () => {
    const project = buildingProject();
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(tx, { kva: 80 });
    // 60 kW at pf 0.85 = 71 kVA: 88 % of 80 kVA, above an 80 % limit (64 kVA).
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    project.model.cables.push(testCable(tx, db));
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(structuredClone(project)));
    const list = await screen.findByRole('list', { name: 'Transformer loading' });
    expect(list).toHaveTextContent('TX-1: 71 of 80 kVA (88 %)');
    expect(list).not.toHaveTextContent('E2801');
    cleanup();
    project.calculation.defaultOverrides = { transformerLoadingLimitPct: 80 };
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(project));
    expect(await screen.findByRole('list', { name: 'Transformer loading' })).toHaveTextContent(
      'E2801 TX-1: 71 of 80 kVA (88 %) - above the 80 % limit (64 kVA)',
    );
  });

  it('#TASK-27 flags a feeder to an FLS load that is not fire-rated (E2701), live', async () => {
    const project = buildingProject();
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(db, { loadCategory: 'fls' });
    project.model.cables.push({ ...testCable(tx, db), tag: 'F-01' });
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(project));
    expect(await screen.findByRole('list', { name: 'Fire-rated feeders' })).toHaveTextContent(
      'E2701 F-01 feeds fire & life-safety load DB-db-1 and is not fire-rated. Select it and choose FR insulation in its Engineering Property.',
    );
  });

  it('Import File ticks the 80 % transformer loading limit as a Lead override (6 Nov 2026)', async () => {
    const api = fakeApi(completeProject());
    renderAt('/projects/p-1/import', new FakeAuth(LEAD), api);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Limit to 80 %/ }));
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.calculation.defaultOverrides).toEqual({
        transformerLoadingLimitPct: 80,
      }),
    );
  });

  it('shows the component library, the capacity panel and a Cable Size button disabled until the source is connected (A-07)', async () => {
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(completeProject()));
    expect(
      await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transformer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cable Size( |$)/ })).toBeDisabled();
  });

  it('#TASK-18 a riser fed from the transformer feeds the floor boards; then Cable Size (A-07)', async () => {
    const project = buildingProject();
    project.calculation.busbarMaker = 'schneider';
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    const api = fakeApi(project);
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), api);
    await userEvent.click(await screenTool('Building'));
    const summary = screen.getByRole('complementary', { name: 'Building Summary' });
    const calc = within(summary).getByRole('button', { name: 'Cable Size Calculator' });
    expect(calc).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'DB-db-1 board' }));
    expect(await screen.findByText('Enter a riser length in Riser Design first.')).toBeVisible();
    await userEvent.type(within(summary).getByLabelText('Riser 1 length'), '26');
    await userEvent.click(screen.getByRole('button', { name: 'Riser 1' }));
    expect(await screen.findByText('Riser 1 is fed from TX-1.')).toBeVisible();
    expect(calc).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'DB-db-1 board' }));
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.model.risers[0]).toMatchObject({
        fedFromId: 'tx',
        feeds: ['db-1'],
      }),
    );
    expect(within(summary).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(calc);
    await waitFor(() =>
      expect(within(summary).getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    // Cost: the riser's busbar (smallest Schneider rating, 800 A) x 2.2 AED (3 Nov 2026).
    expect(summary).toHaveTextContent('Cost : 1760 AED');
    // The riser is sized; the two feeders of the sample plan have no load yet.
    expect(
      screen.getByText(
        'Cable Size ran on the whole project: 1 sized, 2 waiting for load - select an item to see why in the right panel.',
      ),
    ).toBeVisible();
    await userEvent.click(within(summary).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.model.risers[0]?.feeds).toEqual(['db-1']),
    );
    expect(within(summary).getByRole('button', { name: 'Demand Factors' })).toBeInTheDocument();
  });

  it('#TASK-17 keeps the Riser Design in the project and refuses a length of 0', async () => {
    const api = fakeApi(completeProject());
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), api);
    let summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    await userEvent.type(within(summary).getByLabelText('Riser 2 length'), '15');
    await userEvent.type(within(summary).getByLabelText('Riser 2 width'), '0');
    expect(await screen.findByText('Riser length and width are more than 0 m.')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Riser diagram' })).toContainElement(
      screen.getByLabelText('Riser 2'),
    );
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.model.risers[1]?.lengthM).toBe(15),
    );
    cleanup();
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), api);
    summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    expect(within(summary).getByLabelText('Riser 2 length')).toHaveValue('15');
    expect(within(summary).getByLabelText('Riser 2 width')).toHaveValue('');
  });

  it('Undo and Redo step back and forward through the latest changes', async () => {
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(completeProject()));
    const summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    expect(tool('Undo')).toBeDisabled();
    await userEvent.type(within(summary).getByLabelText('Riser 2 length'), '7');
    await userEvent.click(tool('Undo'));
    expect(within(summary).getByLabelText('Riser 2 length')).toHaveValue('');
    expect(tool('Undo')).toBeDisabled();
    await userEvent.click(tool('Redo'));
    expect(within(summary).getByLabelText('Riser 2 length')).toHaveValue('7');
    expect(tool('Redo')).toBeDisabled();
  });

  it('underlines only the active tab; the guide button reads Help', async () => {
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), fakeApi(completeProject()));
    const tabs = await screen.findByRole('navigation', { name: 'Pages' });
    await screen.findByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE');
    const active = [...tabs.querySelectorAll('.tab.active')].map((t) => t.textContent);
    expect(active).toEqual(['Floor Setup']);
    expect(tool('Help')).toBeInTheDocument();
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

  it('#TASK-18 network check: warnings until the DB reaches the transformer; standby view', async () => {
    const project = buildingProject();
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(project));
    const check = await screen.findByRole('region', { name: 'Network check' });
    const warnings = within(check).getByRole('list', { name: 'Network warnings' });
    expect(warnings).toHaveTextContent(
      'E1802 Ground Floor has boards but no tap-off from a riser.',
    );
    // Where the chain breaks, and what to do about it.
    expect(warnings).toHaveTextContent(
      'E1801 DB-db-1 has no incoming feeder. In Floor Setup, draw a feeder to DB-db-1 from a panel above it, or click it in this diagram to put it on a riser tap-off.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'DB-db-1 board' }));
    expect(within(check).getByText(/^Every component has a path to a source;/)).toBeVisible();
    await userEvent.click(within(check).getByRole('radio', { name: 'Standby' }));
    expect(within(check).getByText(/On generator supply: 0 of 1 components/)).toBeVisible();
  });

  it('#TASK-18 a riser fed from an MDB with no feeder: one warning naming the MDB, source marked', async () => {
    const project = buildingProject();
    const gf = project.building.floors.find((f) => f.code === 'GF')!.id;
    project.model.elements.push({ ...testElement('mdb', 'mdb', gf), tag: 'MDB-GF-01' });
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'mdb' });
    project.model.risers = setRiser(project.model.risers, 'riser-2', {
      lengthM: 10,
      fedFromId: 'tx',
    });
    project.model.risers = setBoardRiser(project.model.risers, 'db-1', 'riser-1');
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(project));
    const check = await screen.findByRole('region', { name: 'Network check' });
    const warnings = within(check).getByRole('list', { name: 'Network warnings' });
    expect(warnings).toHaveTextContent(
      'E1801 MDB-GF-01 has no incoming feeder - 1 component below it has no supply: DB-db-1. In Floor Setup, draw a feeder to MDB-GF-01 from the transformer (or from the generator through an ATS).',
    );
    // A source box per riser source, labelled with its own tag; the MDB is marked "no supply".
    const diagram = screen.getByRole('img', { name: 'Riser diagram' });
    expect(within(diagram).getByLabelText('Source TX-1')).toBeInTheDocument();
    expect(within(diagram).getByLabelText('Source MDB-GF-01')).toHaveTextContent('no supply');
  });

  it('#TASK-27 Cost "-" lists why: no load and no busbar manufacturer', async () => {
    const project = buildingProject();
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    project.model.risers = setBoardRiser(project.model.risers, 'db-1', 'riser-1');
    project.calculation.busbarMaker = null;
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(project));
    await userEvent.click(await screen.findByRole('button', { name: 'Cable Size Calculator' }));
    const why = await screen.findByLabelText('Why there is no cost');
    expect(screen.getByText(/^Cost :/).closest('p')).toHaveTextContent('Cost : - AED');
    expect(why).toHaveTextContent(
      'No load reaches Riser 1: enter the loads of the DBs fed from DB-db-1 in Floor Setup.',
    );
    expect(why).toHaveTextContent(
      'No busbar manufacturer chosen: choose it on Import File (Busbar Manufacturer).',
    );
    // The run's notice says what it found, not only that it ran.
    expect(
      screen.getByText(
        /^Cable Size ran on the whole project: .*waiting for load - select an item to see why/,
      ),
    ).toBeVisible();
  });

  it('#TASK-27 says why the Cable Size Calculator is not available yet', async () => {
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(buildingProject()));
    const button = await screen.findByRole('button', { name: 'Cable Size Calculator' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/^Enter a riser length in Riser Design, then click the riser/),
    ).toBeVisible();
  });

  it('#TASK-10 an engineer flags a connected floor done; it locks until the Lead reopens it (A-08)', async () => {
    const project = buildingProject();
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    const api = fakeApi(project);
    renderAt('/projects/p-1/floor', new FakeAuth(ELEC), api);
    await userEvent.click(await screenTool('Status'));
    let dialog = screen.getByRole('dialog', { name: 'Ground Floor status' });
    const flag = within(dialog).getByRole('button', { name: 'Flag Electrical done' });
    expect(flag).toBeDisabled(); // DB-db-1 has no source yet (E1801)
    expect(dialog).toHaveTextContent('DB-db-1 has no path to a transformer or generator. (E1801)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await userEvent.click(tool('Building'));
    await userEvent.click(await screen.findByRole('button', { name: 'DB-db-1 board' }));
    await userEvent.click(tool('Building'));
    await userEvent.click(await screenTool('Status'));
    dialog = screen.getByRole('dialog', { name: 'Ground Floor status' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Flag Electrical done' }));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.model.floorFlags).toMatchObject([
        { discipline: 'electrical', by: ELEC.id },
      ]),
    );
    expect(within(dialog).queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/flagged done for electrical and locked \(E1003\)/)).toBeVisible();

    cleanup();
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), api);
    await userEvent.click(await screenTool('Status'));
    dialog = screen.getByRole('dialog', { name: 'Ground Floor status' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen Electrical' }));
    expect(
      within(dialog).getByRole('button', { name: 'Flag Electrical done' }),
    ).toBeInTheDocument();
  });

  it('#TASK-26 the right-panel Cable Size runs the engine and keeps real results (WBS 1.7.1)', async () => {
    const project = buildingProject();
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(tx, { kva: 1000, ukPct: 6, urPct: 1 });
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    const cable = testCable(tx, db);
    project.model.cables.push(cable);
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    const api = fakeApi(project);
    renderAt('/projects/p-1/floor', new FakeAuth(LEAD), api);
    const button = await screen.findByRole('button', { name: /^Cable Size( |$)/ });
    await userEvent.click(button);
    expect(await screen.findByText(/^Cable Size ran on /)).toBeVisible();
    await userEvent.click(tool('Save'));
    await waitFor(async () => {
      const saved = (await api.getProject('p-1')).project.model.results;
      const r = saved.find((x) => x.elementId === cable.id);
      // 60 kW balanced at pf 0.85: Ib = 101.9 A, In 125 A.
      expect(r).toMatchObject({ engineVersion: '0.1.0', device: { ratingA: 125 } });
      expect(r!.values.ibA).toBeCloseTo(60_000 / (Math.sqrt(3) * 400 * 0.85), 6);
      expect(saved.find((x) => x.elementId === 'db-1')?.device?.ratingA).toBe(125);
    });
  });

  it('Demand Factors reopens the 12 load-type factors; a change needs a new Cable Size run (A-14)', async () => {
    const project = buildingProject();
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    renderAt('/projects/p-1/floor?tab=building', new FakeAuth(LEAD), fakeApi(project));
    const summary = await screen.findByRole('complementary', { name: 'Building Summary' });
    await userEvent.click(within(summary).getByRole('button', { name: 'Cable Size Calculator' }));
    await userEvent.click(await within(summary).findByRole('button', { name: 'Demand Factors' }));
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
  it('#TASK-30 Schematic draws the single-line diagram of the model transformers', async () => {
    const project = buildingProject();
    project.meta.reachedPage = 'simulation-report';
    project.model.risers = [{ id: 'r1', lengthM: 20, widthM: 1, fedFromId: 'tx', feeds: ['db-1'] }];
    renderAt('/projects/p-1/schematic', new FakeAuth(LEAD), fakeApi(project));
    expect(await screen.findByRole('checkbox', { name: 'TX-1' })).toBeChecked();
    const sld = screen.getByRole('img', { name: 'Single-line diagram from TX-1' });
    expect(within(sld).getByText('DB-db-1')).toBeInTheDocument();
    expect(within(sld).getByText('Riser 1 tap-off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'TX-1' }));
    expect(screen.getByText('Select a transformer on the left.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('#TASK-31 Output previews schedules by level and asks the sheet inputs before download', async () => {
    const project = buildingProject();
    project.meta.reachedPage = 'simulation-report';
    renderAt('/projects/p-1/output', new FakeAuth(LEAD), fakeApi(project));
    const floorLevel = await screen.findByRole('checkbox', { name: 'Floor Level Schedule' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Second Level Schedule' }));
    expect(screen.getByText('No boards of the ticked levels in this project yet.')).toBeVisible();
    await userEvent.click(floorLevel);
    const sheet = screen.getByRole('table', { name: 'Schedule DB-db-1' });
    expect(sheet).toHaveTextContent('INCOMER');
    const download = screen.getByRole('button', { name: 'Download' });
    expect(download).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('DB-db-1 type of meter'), 'upto-125a-3ph');
    await userEvent.type(screen.getByLabelText('Planned completion date'), '2027-06-30');
    expect(download).toBeDisabled(); // the logo is still missing
    await userEvent.upload(screen.getByLabelText('Logo'), PNG_LOGO);
    await waitFor(() => expect(download).toBeEnabled());
    expect(within(sheet).getByRole('img', { name: /logo/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Generator Load Analysis' }));
    expect(screen.getByText(/^No generator in this project yet/)).toBeVisible();
  });
});

describe('#TASK-28 Generator Load Analysis (OI-11, briefing page 8)', () => {
  /** TX and GEN 100 kVA into an ATS that feeds DB-db-1 (60 kW). */
  function genProject() {
    const project = buildingProject();
    project.meta.reachedPage = 'simulation-report';
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(tx, { kva: 1000 });
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    const gen = { ...testElement('generator', 'gen'), tag: 'GEN-1', kvaOverride: 100 } as Element;
    const ats = { ...testElement('ats', 'ats'), tag: 'ATS-1' } as Element;
    project.model.elements.push(gen, ats);
    project.model.cables.push(
      testCable(tx, ats, 'normal'),
      testCable(gen, ats, 'standby'),
      testCable(ats, db),
    );
    return project;
  }

  it('edits the factors per load, sizes the generator and downloads the sheet', async () => {
    let saved: Blob | null = null;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = b as Blob;
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = fakeApi(genProject());
    renderAt('/projects/p-1/output', new FakeAuth(LEAD), api);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Generator Load Analysis' }));
    const sheet = screen.getByLabelText('Generator load analysis GEN-1');
    expect(sheet).toHaveTextContent('1 load still at 1.0 in every case');
    expect(within(sheet).getByRole('row', { name: /DB-db-1/ })).toHaveTextContent(
      'ATS-1DB-db-120.00020.00020.00060.000',
    );
    const fire = within(sheet).getByLabelText('Case-2 factor DB-db-1');
    await userEvent.clear(fire);
    await userEvent.type(fire, '0.5{Enter}');
    expect(sheet).not.toHaveTextContent('still at 1.0');
    // Case 1 stays 60 kW (higher than fire 30 kW): + 10 % = 66 kW, / 0.8 = 83 kVA; 100 kVA chosen.
    const rating = within(sheet).getByRole('table', { name: 'Generator rating GEN-1' });
    expect(rating).toHaveTextContent('LOAD ON GENERATOR60 kW');
    expect(rating).toHaveTextContent('GENERATOR RATING REQUIRED (kVA)83 kVA');
    expect(rating).toHaveTextContent('GENERATOR RATING SELECTED (kVA)100 kVA');
    await userEvent.click(tool('Save'));
    await waitFor(async () =>
      expect((await api.getProject('p-1')).project.model.generatorFactors).toEqual([
        { elementId: 'db-1', normal: 1, powerFailure: 1, fire: 0.5, remarks: '' },
      ]),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(
      await screen.findByText(
        /_GeneratorLoadAnalysis_v1\.xlsx \(1 generator\)\.$/,
        {},
        { timeout: 10_000 },
      ),
    ).toBeVisible();
    expect(api.nextExportVersion).toHaveBeenCalledWith('p-1', 'generator-analysis');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saved!.arrayBuffer());
    const ws = wb.getWorksheet('GEN-1')!;
    expect(ws.getCell('A1').value).toBe('LOAD ANALYSIS - GENERATORS - GEN-1');
    expect([ws.getCell('A5').value, ws.getCell('B5').value]).toEqual(['GEN-1', 'ATS-1']);
    expect([ws.getCell('B6').value, ws.getCell('F6').value, ws.getCell('L6').value]).toEqual([
      'DB-db-1',
      60,
      30,
    ]);
    create.mockRestore();
    click.mockRestore();
  });

  it('is read-only for someone without the electrical layer', async () => {
    const checker: UserSummary = { ...ELEC, id: 'u-check', role: 'CHECKER' };
    renderAt('/projects/p-1/output', new FakeAuth(checker), fakeApi(genProject()));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Generator Load Analysis' }));
    expect(screen.getByLabelText('Case-1 factor DB-db-1')).toBeDisabled();
  });
});

describe('#TASK-31 schedule download (WBS 1.7.2)', () => {
  /** ExcelJS / jsPDF load on demand: the first import is slow on a busy test machine. */
  const SLOW = { timeout: 10_000 };
  /** TX 1000 kVA > DB-db-1 (60 kW) by a feeder; a riser from TX so Cable Size is enabled. */
  function fedProject() {
    const project = buildingProject();
    project.meta.reachedPage = 'simulation-report';
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(tx, { kva: 1000, ukPct: 6, urPct: 1 });
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    const cable = testCable(tx, db);
    cable.construction = { ...cable.construction, groupedCircuits: 1 };
    project.model.cables.push(cable);
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    return project;
  }

  async function fillAndDownload(project: Project, format: 'xlsx' | 'pdf' = 'xlsx') {
    const api = fakeApi(project);
    renderAt('/projects/p-1/output', new FakeAuth(LEAD), api);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Floor Level Schedule' }));
    await userEvent.selectOptions(screen.getByLabelText('Format'), format);
    await userEvent.selectOptions(screen.getByLabelText('DB-db-1 type of meter'), 'upto-125a-3ph');
    await userEvent.type(screen.getByLabelText('Planned completion date'), '2027-06-30');
    await userEvent.upload(screen.getByLabelText('Logo'), PNG_LOGO);
    const download = screen.getByRole('button', { name: 'Download' });
    await waitFor(() => expect(download).toBeEnabled());
    await userEvent.click(download);
    return api;
  }

  it('runs Cable Size, then saves <project>_Schedules_v1.xlsx with a sheet per board', async () => {
    let saved: Blob | null = null;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = b as Blob;
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = await fillAndDownload(fedProject());
    expect(
      await screen.findByText(/^Downloaded .*_Schedules_v1\.xlsx \(1 schedule\)\.$/, {}, SLOW),
    ).toBeVisible();
    expect(api.nextExportVersion).toHaveBeenCalledWith('p-1', 'schedules');
    expect(click).toHaveBeenCalled();
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saved!.arrayBuffer());
    const ws = wb.getWorksheet('DB-db-1')!;
    expect(String(ws.getCell('A1').value)).toMatch(/PLANNED COMPLETION DATE : 2027-06-30/);
    expect(ws.getCell('A6').value).toBe('INCOMER');
    // 60 kW at pf 0.85: Ib 101.9 A -> 125 A breaker; loads 20 / 20 / 20 kW.
    expect(ws.getCell('D6').value).toBe(125);
    expect([ws.getCell('K6').value, ws.getCell('N6').value]).toEqual([20, 60]);
    expect(ws.getImages()).toHaveLength(1); // the logo
    create.mockRestore();
    click.mockRestore();
  });

  it('saves <project>_Schedules_v1.pdf, numbered apart from the Excel files', async () => {
    let saved: Blob | null = null;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = b as Blob;
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = await fillAndDownload(fedProject(), 'pdf');
    expect(
      await screen.findByText(/^Downloaded .*_Schedules_v1\.pdf \(1 schedule\)\.$/, {}, SLOW),
    ).toBeVisible();
    expect(api.nextExportVersion).toHaveBeenCalledWith('p-1', 'schedules-pdf');
    expect(saved!.type).toBe('application/pdf');
    const pdf = new TextDecoder('latin1').decode(await saved!.arrayBuffer());
    expect(pdf.startsWith('%PDF-')).toBe(true);
    for (const t of [
      'INCOMER',
      'OUTGOING WAYS:',
      'DB-db-1',
      '125',
      'PLANNED COMPLETION DATE : 2027-06-30',
    ]) {
      expect(pdf).toContain(t);
    }
    expect(pdf).toMatch(/\/Subtype \/Image/); // the logo
    create.mockRestore();
    click.mockRestore();
  });

  it('is blocked (E3101) while a result is blocked', async () => {
    const project = fedProject();
    // A single-phase load on 4-core cable: no CableSizer rating, the feeder is blocked (E2101).
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 0, kwL3: 0 }] });
    const api = await fillAndDownload(project);
    expect(await screen.findByText(/^E3101 Export blocked - /)).toBeVisible();
    expect(api.nextExportVersion).not.toHaveBeenCalled();
  });
});

describe('#TASK-31 calculation sheet (WBS 1.7.3)', () => {
  const SLOW = { timeout: 10_000 };

  function fedProject() {
    const project = buildingProject();
    project.meta.reachedPage = 'simulation-report';
    const tx = project.model.elements.find((e) => e.id === 'tx')!;
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(tx, { kva: 1000, ukPct: 6, urPct: 1 });
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }] });
    const cable = testCable(tx, db);
    cable.construction = { ...cable.construction, groupedCircuits: 1 };
    project.model.cables.push({ ...cable, tag: 'F0-1' });
    project.model.risers = setRiser([], 'riser-1', { lengthM: 26, fedFromId: 'tx' });
    return project;
  }

  /** Ticks only the Calculation Sheet (no schedule inputs needed) and downloads it. */
  async function download(project: Project, format: 'xlsx' | 'pdf') {
    let saved: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = b as Blob;
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = fakeApi(project);
    renderAt('/projects/p-1/output', new FakeAuth(LEAD), api);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Calculation Sheet' }));
    expect(screen.getByLabelText('Calculation sheet')).toHaveTextContent('F0-1');
    await userEvent.selectOptions(screen.getByLabelText('Format'), format);
    const button = screen.getByRole('button', { name: 'Download' });
    expect(button).toBeEnabled(); // no logo, date or meters asked for this sheet
    await userEvent.click(button);
    // The cable, and Riser 1 (in the data: fed from the transformer, no tap-offs yet).
    const name = new RegExp(`^Downloaded .*_CalculationSheet_v1\\.${format} \\(2 rows\\)\\.$`);
    expect(await screen.findByText(name, {}, SLOW)).toBeVisible();
    expect(api.nextExportVersion).toHaveBeenCalledWith(
      'p-1',
      format === 'xlsx' ? 'calc-sheet' : 'calc-sheet-pdf',
    );
    vi.restoreAllMocks();
    return saved! as Blob;
  }

  it('runs Cable Size, then saves one Excel row per cable with inputs, results and checks', async () => {
    const blob = await download(fedProject(), 'xlsx');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Calculation Sheet')!;
    expect(String(ws.getCell('A1').value)).toMatch(/^CALCULATION SHEET - PROJECT : /);
    const head = (ws.getRow(5).values as unknown[]).slice(1);
    const at = (label: string) => head.indexOf(label) + 1;
    const row = ws.getRow(7);
    expect([row.getCell(1).value, row.getCell(3).value, row.getCell(4).value]).toEqual([
      'F0-1',
      'TX-1',
      'DB-db-1',
    ]);
    expect([ws.getCell('A8').value, ws.getCell('B8').value]).toEqual(['Riser 1', 'Riser']);
    // 60 kW at pf 0.85: Ib 101.9 A, 125 A breaker; C1 and C2 pass.
    expect(row.getCell(at('Load current Ib')).value).toBeCloseTo(101.88, 1);
    expect(row.getCell(at('Rating In')).value).toBe(125);
    expect([row.getCell(at('C1')).value, row.getCell(at('C2')).value]).toEqual(['Pass', 'Pass']);
    expect(row.getCell(at('Status')).value).not.toBe('Out of date');
  });

  it('saves the PDF and is not blocked by a blocked feeder (the sheet records it)', async () => {
    const project = fedProject();
    const db = project.model.elements.find((e) => e.id === 'db-1')!;
    Object.assign(db, { loads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 0, kwL3: 0 }] });
    const blob = await download(project, 'pdf');
    const pdf = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(pdf.startsWith('%PDF-')).toBe(true);
    for (const t of ['CALCULATION SHEET', 'F0-1', 'Blocked', 'E2101']) expect(pdf).toContain(t);
  });
});

/** A 1 x 1 PNG: the logo (Excel takes PNG / JPEG). */
const PNG_LOGO = new File(
  [
    Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    ),
  ],
  'logo.png',
  { type: 'image/png' },
);

/** modelledProject() with a transformer on the Ground Floor (Building tab). */
function buildingProject(): Project {
  const p = modelledProject();
  const gf = p.building.floors.find((f) => f.code === 'GF')!;
  const item = libraryItem('transformer');
  if (!item || !isPlaceable(item)) throw new Error('transformer');
  const tx = placeElement(item, {
    id: 'tx',
    floorId: gf.id,
    floorCode: 'GF',
    position: { x: 2, y: 2 },
    taken: [],
  });
  p.model.elements.push({ ...tx, tag: 'TX-1' });
  return p;
}

async function screenTool(name: string) {
  await screen.findByRole('toolbar', { name: 'Tools' });
  return tool(name);
}
