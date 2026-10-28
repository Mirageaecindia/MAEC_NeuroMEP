import type { Project, UserSummary } from '@neuromep/shared';
import { completeProject } from '@neuromep/shared/testing';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { App, routes } from '../../App';
import type { AuthProvider } from '../../auth/AuthProvider';
import { LIBRARY_DRAG_TYPE } from '../../viewer/PlanViewer';

// pdf.js cannot run in jsdom: an A3-landscape page (1191 x 842 pt) stands in for the plan.
vi.mock('../../viewer/pdf', () => {
  const page = {
    view: [0, 0, 1191, 842],
    getViewport: ({ scale }: { scale: number }) => ({
      transform: [scale, 0, 0, -scale, 0, 842 * scale],
      width: 1191 * scale,
      height: 842 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  return {
    openPdf: async () => ({
      getPage: async () => page,
      loadingTask: { destroy: async () => undefined },
    }),
    loadSnapIndex: async () => {
      throw new Error('no snapping in tests');
    },
    readFirstPageSize: async () => ({ widthPt: 1191, heightPt: 842, pages: 1 }),
  };
});

const user = (id: string, role: UserSummary['role']): UserSummary => ({
  id,
  role,
  name: id,
  email: `${id}@neuromep.dev`,
});
const LEAD = user('u-lead', 'TECHNICAL_LEAD');
const CHECKER = user('u-check', 'CHECKER');

const authFor = (u: UserSummary): AuthProvider => ({
  signIn: async () => u,
  signOut: async () => undefined,
  getCurrentUser: async () => u,
});

function fakeApi(project: Project) {
  let current = project;
  const api = {
    listProjects: async () => ({ projects: [] }),
    users: async () => ({ users: [] }),
    getProject: async () => ({ project: current }),
    saveProject: vi.fn(async (p: Project) => {
      current = { ...p, version: p.version + 1 };
      return { project: current };
    }),
    downloadPlan: async () => new ArrayBuffer(8),
    symbols: async () => ({
      symbols: [{ key: 'db', cmpCode: 'CMP-001', status: 'draft', svg: '<svg></svg>' }],
    }),
    setUnauthorizedHandler: () => () => undefined,
  };
  return api;
}

function open(u: UserSummary, project = completeProject()) {
  const api = fakeApi(project);
  render(
    <App
      auth={authFor(u)}
      api={api as unknown as ApiClient}
      router={createMemoryRouter(routes, { initialEntries: ['/projects/p-1/floor'] })}
    />,
  );
  return api;
}

const canvasArea = () => document.querySelector('.viewer-canvas') as HTMLElement;
const planReady = () =>
  waitFor(() =>
    expect((document.querySelector('canvas.viewer-page') as HTMLElement).style.display).not.toBe(
      'none',
    ),
  );
const chip = (name: string) =>
  within(screen.getByLabelText('Component Library')).getByRole('button', { name });

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 700,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    },
  );
});
// The last cable construction is remembered in the browser: each test starts without it.
beforeEach(() => localStorage.clear());
afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.unstubAllGlobals();
});

describe('#TASK-12 placing components on Floor Setup (WBS 1.3.1)', () => {
  it('places an armed item with the next click and tags it automatically', async () => {
    const api = open(LEAD);
    await planReady();
    await userEvent.click(chip('DB'));
    expect(chip('DB')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    expect(await screen.findByRole('img', { name: 'DB-GF-01 (selected)' })).toBeInTheDocument();
    expect(chip('DB')).toHaveAttribute('aria-pressed', 'false');
    const card = screen.getByRole('region', { name: 'Engineering Property' });
    expect(card).toHaveTextContent('Name :DB');
    expect(within(card).getByLabelText('Tag :')).toHaveValue('DB-GF-01');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    const saved = api.saveProject.mock.calls.at(-1)![0];
    expect(saved.model.elements).toHaveLength(1);
    // Stored in metres: the calibration of the fixture is 0.1 m per PDF unit.
    const e = saved.model.elements[0]!;
    expect(e).toMatchObject({ kind: 'db', libraryKey: 'db', discipline: 'electrical' });
    expect(e.position.x).toBeGreaterThan(0);
  });

  it('places a library item dropped on the plan', async () => {
    open(LEAD);
    await planReady();
    // jsdom's drop events carry no pointer position: add it as a browser would.
    const drop = createEvent.drop(canvasArea(), {
      dataTransfer: { getData: () => 'transformer', types: [LIBRARY_DRAG_TYPE] },
    });
    Object.defineProperties(drop, { clientX: { value: 400 }, clientY: { value: 250 } });
    fireEvent(canvasArea(), drop);
    expect(await screen.findByRole('img', { name: 'Tx_GF_1 (selected)' })).toBeInTheDocument();
  });

  it('renames with a unique tag, moves by dragging and deletes with the Delete key', async () => {
    open(LEAD);
    await planReady();
    for (const x of [300, 500]) {
      await userEvent.click(chip('DB'));
      fireEvent.mouseDown(canvasArea(), { button: 0, clientX: x, clientY: 300 });
    }
    const tag = screen.getByLabelText('Tag :');
    await userEvent.clear(tag);
    await userEvent.type(tag, 'DB-GF-01');
    expect(screen.getByText('Another component already has this tag.')).toBeInTheDocument();
    await userEvent.clear(tag);
    await userEvent.type(tag, 'DB-KITCHEN');
    await userEvent.tab();
    expect(await screen.findByRole('img', { name: 'DB-KITCHEN (selected)' })).toBeInTheDocument();

    const before = screen
      .getByRole('img', { name: 'DB-KITCHEN (selected)' })
      .querySelector('text')!;
    const x0 = Number(before.getAttribute('x'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 500, clientY: 300 });
    fireEvent.mouseMove(canvasArea(), { clientX: 560, clientY: 320 });
    fireEvent.mouseUp(canvasArea());
    const after = screen.getByRole('img', { name: 'DB-KITCHEN (selected)' }).querySelector('text')!;
    expect(Number(after.getAttribute('x'))).toBeCloseTo(x0 + 60, 6);

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByRole('img', { name: /DB-KITCHEN/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'DB-GF-01' })).toBeInTheDocument();
  });

  it('does not place on an uncalibrated plan (E0701)', async () => {
    const project = completeProject();
    project.building.floors.find((f) => f.code === 'GF')!.plan!.calibration = null;
    open(LEAD, project);
    await planReady();
    await userEvent.keyboard('{Escape}'); // leave the calibration prompt
    await userEvent.click(chip('DB'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    expect(
      await screen.findByText('Calibrate the plan before placing components (E0701).', {
        selector: '.notice',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /DB-GF/ })).not.toBeInTheDocument();
  });

  it('lets a checker look but not place', async () => {
    open(CHECKER);
    await planReady();
    expect(chip('DB')).toBeDisabled();
  });
});

describe('#TASK-13 drawing cables (WBS 1.3.2)', () => {
  async function placeAt(name: string, x: number, y: number) {
    await userEvent.click(chip(name));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: x, clientY: y });
  }
  async function chooseConstruction() {
    const dialog = await screen.findByRole('dialog', { name: 'Cable construction' });
    const pick: [string, string][] = [
      ['Cores', '4C'],
      ['Conductor', 'Cu'],
      ['Insulation', 'XLPE'],
      ['Armour', 'SWA'],
      ['Sheath', 'PVC'],
      ['Voltage grade', '600/1000 V'],
      ['Installation method', 'B'],
    ];
    for (const [label, value] of pick) {
      await userEvent.selectOptions(within(dialog).getByLabelText(label), value);
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this construction' }));
  }

  it('draws a right-angled cable from a board to a DB with its way, tag and length', async () => {
    open(LEAD);
    await planReady();
    await placeAt('SMDB', 300, 300);
    await placeAt('DB', 600, 450);
    await userEvent.click(chip('Cable'));
    await chooseConstruction();
    expect(chip('Cable')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 }); // SMDB
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 310 }); // bend
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 }); // DB
    expect(await screen.findByRole('img', { name: 'Cable FGF-1 (selected)' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Engineering Property' });
    expect(card).toHaveTextContent('From :SMDB-GF-01');
    expect(card).toHaveTextContent('To :DB-GF-01');
    expect(card).toHaveTextContent('Circuit :1RYB');
    expect(card).toHaveTextContent('4C Cu/XLPE/SWA/PVC, 600/1000 V, method B');
    expect(card).toHaveTextContent('vertical 1.00 m + 10 % (interim, OI-17)');
    expect(card).toHaveTextContent('Calculated by Cable Size');

    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 }); // select the DB
    expect(screen.getByRole('region', { name: 'Engineering Property' })).toHaveTextContent(
      'Fed From :SMDB-GF-01',
    );

    // The construction is remembered: the next cable starts without asking again (D-05).
    await userEvent.click(chip('Cable'));
    expect(screen.queryByRole('dialog', { name: 'Cable construction' })).not.toBeInTheDocument();
    expect(chip('Cable')).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuses to start on a DB, which has no outgoing way, and Escape cancels a cable', async () => {
    open(LEAD);
    await planReady();
    await placeAt('DB', 600, 450);
    await userEvent.click(chip('Cable'));
    await chooseConstruction();
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 });
    expect(
      await screen.findByText('DB-GF-01 has no outgoing way: start from the board that feeds.', {
        selector: '.notice',
      }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(chip('Cable')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('img', { name: /^Cable / })).not.toBeInTheDocument();
  });

  it('takes the optional installation details; depth only for buried cables (12.3)', async () => {
    open(LEAD);
    await planReady();
    await userEvent.click(chip('Cable'));
    const dialog = await screen.findByRole('dialog', { name: 'Cable construction' });
    expect(within(dialog).queryByLabelText('Depth of laying (m)')).not.toBeInTheDocument();
    for (const [label, value] of [
      ['Cores', '4C'],
      ['Conductor', 'Cu'],
      ['Insulation', 'XLPE'],
      ['Armour', 'SWA'],
      ['Sheath', 'PVC'],
      ['Voltage grade', '600/1000 V'],
      ['Installation method', 'D-direct'],
    ]) {
      await userEvent.selectOptions(within(dialog).getByLabelText(label!), value!);
    }
    const use = within(dialog).getByRole('button', { name: 'Use this construction' });
    expect(use).toBeEnabled(); // installation details may stay TBC
    await userEvent.type(within(dialog).getByLabelText('Trays'), '0');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Trays: must be a whole number of at least 1.',
    );
    expect(use).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText('Trays'));
    await userEvent.type(within(dialog).getByLabelText('Trays'), '2');
    await userEvent.type(within(dialog).getByLabelText('Depth of laying (m)'), '0.8');
    await userEvent.selectOptions(within(dialog).getByLabelText('Separation'), '2D');
    await userEvent.click(use);
    expect(chip('Cable')).toHaveAttribute('aria-pressed', 'true');
    const remembered = JSON.parse(localStorage.getItem('neuromep.construction.p-1')!);
    expect(remembered).toMatchObject({
      method: 'D-direct',
      trays: 2,
      depthM: 0.8,
      separation: '2D',
      groupedCircuits: null,
    });
  });

  it('refuses a connection that breaks the supply order (E1401)', async () => {
    open(LEAD);
    await planReady();
    await placeAt('Transformer', 300, 300);
    await placeAt('DB', 600, 300);
    await userEvent.click(chip('Cable'));
    await chooseConstruction();
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 300 });
    expect(
      await screen.findByText(
        'Tx_GF_1 cannot feed DB-GF-01: follow source > MDB > SMDB / MCC > DB. (E1401)',
        { selector: '.notice' },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Cable / })).not.toBeInTheDocument();
  });

  it('deletes a selected cable with the Delete key, keeping both components', async () => {
    open(LEAD);
    await planReady();
    await placeAt('SMDB', 300, 300);
    await placeAt('DB', 300, 500);
    await userEvent.click(chip('Cable'));
    await chooseConstruction();
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 500 });
    expect(await screen.findByRole('img', { name: 'Cable FGF-1 (selected)' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByRole('img', { name: /^Cable / })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'SMDB-GF-01' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'DB-GF-01' })).toBeInTheDocument();
  });
});
