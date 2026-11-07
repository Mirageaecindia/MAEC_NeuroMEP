import { loadTemplateHeader, type Project, type UserSummary } from '@neuromep/shared';
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
    await userEvent.click(chip('Feeder'));
    await chooseConstruction();
    expect(chip('Feeder')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 }); // SMDB
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 310 }); // bend
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 }); // DB
    expect(await screen.findByRole('img', { name: 'Cable FGF-1 (selected)' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Engineering Property' });
    expect(card).toHaveTextContent('From :SMDB-GF-01');
    expect(card).toHaveTextContent('To :DB-GF-01');
    expect(card).toHaveTextContent('Circuit :1RYB');
    expect(card).toHaveTextContent('4C Cu/XLPE/SWA/PVC, 600/1000 V, method B');
    expect(card).toHaveTextContent('+ 5.00 m added'); // measured route + 5 m (3 Nov 2026)
    expect(card).toHaveTextContent('Calculated by Cable Size');

    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 }); // select the DB
    expect(screen.getByRole('region', { name: 'Engineering Property' })).toHaveTextContent(
      'Fed From :SMDB-GF-01',
    );

    // The construction is remembered: the next cable starts without asking again (D-05).
    await userEvent.click(chip('Feeder'));
    expect(screen.queryByRole('dialog', { name: 'Cable construction' })).not.toBeInTheDocument();
    expect(chip('Feeder')).toHaveAttribute('aria-pressed', 'true');
  });

  it('starts a feeder on any component, a DB too (A-20), and Escape cancels it', async () => {
    open(LEAD);
    await planReady();
    await placeAt('DB', 600, 450);
    await userEvent.click(chip('Feeder'));
    await chooseConstruction();
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 450 });
    expect(document.querySelector('.cable-preview')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(chip('Feeder')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('img', { name: /^Cable / })).not.toBeInTheDocument();
  });

  it('takes the optional installation details; depth only for buried cables (12.3)', async () => {
    open(LEAD);
    await planReady();
    await userEvent.click(chip('Feeder'));
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
    await userEvent.selectOptions(within(dialog).getByLabelText('Separation'), '0.30');
    await userEvent.click(use);
    expect(chip('Feeder')).toHaveAttribute('aria-pressed', 'true');
    const remembered = JSON.parse(localStorage.getItem('neuromep.construction.p-1')!);
    expect(remembered).toMatchObject({
      method: 'D-direct',
      trays: 2,
      depthM: 0.8,
      separation: '0.30',
      groupedCircuits: null,
    });
  });

  it('connects any components (A-20), notes the unusual ones and refuses only a loop (E1401)', async () => {
    open(LEAD);
    await planReady();
    await placeAt('Transformer', 300, 300);
    await placeAt('DB', 600, 300);
    await userEvent.click(chip('Feeder'));
    await chooseConstruction();
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 300 });
    expect(await screen.findByRole('img', { name: /^Cable F/ })).toBeInTheDocument();
    // Back from the DB to the transformer would be a loop.
    await userEvent.click(chip('Feeder'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    expect(
      await screen.findByText(/would make a loop, which Cable Size cannot calculate\. \(E1401\)/, {
        selector: '.notice',
      }),
    ).toBeInTheDocument();
    // The DB's card tells what usually feeds it and that a transformer is unusual.
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 600, clientY: 300 });
    const card = screen.getByRole('region', { name: 'Engineering Property' });
    expect(card).toHaveTextContent('Usually fed from');
    expect(card).toHaveTextContent('Fed from Tx_GF_1: a Transformer does not usually feed a DB.');
  });

  it('deletes a selected cable with the Delete key, keeping both components', async () => {
    open(LEAD);
    await planReady();
    await placeAt('SMDB', 300, 300);
    await placeAt('DB', 300, 500);
    await userEvent.click(chip('Feeder'));
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

describe('#TASK-15 load and equipment entry (WBS 1.3.4, 12.3)', () => {
  async function placeAt(name: string, x: number, y: number) {
    await userEvent.click(chip(name));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: x, clientY: y });
  }
  const card = () => screen.getByRole('region', { name: 'Engineering Property' });

  it('enters a DB power factor (refusing one out of range) and its loads', async () => {
    const api = open(LEAD);
    await planReady();
    await placeAt('DB', 300, 300);
    expect(card()).toHaveTextContent('Loads :None entered (E1501)');

    const pf = within(card()).getByLabelText('Power factor :');
    await userEvent.type(pf, '0.4');
    await userEvent.tab();
    expect(within(card()).getByText(/\(E1502\)/)).toBeInTheDocument();
    await userEvent.clear(pf);
    await userEvent.type(pf, '0.9');
    await userEvent.tab();

    await userEvent.click(within(card()).getByRole('button', { name: 'Edit loads' }));
    const dialog = screen.getByRole('dialog', { name: /^Loads - DB-GF-01/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add load line' }));
    await userEvent.type(within(dialog).getByLabelText('L1 kW 1'), '2');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Line 1: enter every value');
    await userEvent.type(within(dialog).getByLabelText('L2 kW 1'), '2');
    await userEvent.type(within(dialog).getByLabelText('L3 kW 1'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save loads' }));
    expect(card()).toHaveTextContent('Loads :1 line, 6.00 kW');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    const db = api.saveProject.mock.calls.at(-1)![0].model.elements[0]!;
    expect(db).toMatchObject({
      powerFactor: 0.9,
      loads: [{ method: 'kw', loadType: '1', kwL1: 2, kwL2: 2, kwL3: 2 }],
    });
  });

  it('updates the live load table and connected kVA as loads are entered (FR-18)', async () => {
    open(LEAD);
    await planReady();
    await placeAt('SMDB', 300, 300);
    await placeAt('DB', 300, 500);
    await userEvent.click(within(card()).getByRole('button', { name: 'Edit loads' }));
    const dialog = screen.getByRole('dialog', { name: /^Loads - DB-GF-01/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add load line' }));
    for (const n of [1, 2, 3])
      await userEvent.type(within(dialog).getByLabelText(`L${n} kW 1`), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save loads' }));

    const table = screen.getByRole('region', { name: 'Load table' });
    expect(table).toHaveTextContent('LOAD TABLE - Ground Floor');
    expect(
      within(table).getByRole('row', { name: /DB-GF-01 2\.0 2\.0 2\.0 0\.85/ }),
    ).toBeInTheDocument();
    expect(table).toHaveTextContent('Connected 6.0 kW · Max demand 6.0 kW');
    // Dubai method (default): a DB on its own is at 100 %, nothing TBC.
    expect(table).not.toHaveTextContent('E1901');
    // Not fed yet: no supply, so it is shown apart, not as connected (manager feedback).
    expect(screen.getByText(/^Connected:/)).toHaveTextContent('Connected: 0 kVA');
    expect(screen.getByText(/^Not connected yet:/)).toHaveTextContent(
      'Not connected yet: 7 kVA on 1 component',
    );

    await userEvent.click(chip('Feeder'));
    const c = await screen.findByRole('dialog', { name: 'Cable construction' });
    for (const [label, value] of [
      ['Cores', '4C'],
      ['Conductor', 'Cu'],
      ['Insulation', 'XLPE'],
      ['Armour', 'SWA'],
      ['Sheath', 'PVC'],
      ['Voltage grade', '600/1000 V'],
      ['Installation method', 'B'],
    ]) {
      await userEvent.selectOptions(within(c).getByLabelText(label!), value!);
    }
    await userEvent.click(within(c).getByRole('button', { name: 'Use this construction' }));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 500 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 }); // select the SMDB
    const below = screen.getByRole('region', { name: 'Load table' });
    expect(below).toHaveTextContent('LOAD TABLE - below SMDB-GF-01');
    expect(below).toHaveTextContent('Connected 6.0 kW · Max demand 6.0 kW');
    // Still no transformer above the SMDB: not connected yet.
    expect(screen.getByText(/^Not connected yet:/)).toHaveTextContent('7 kVA on 1 component');
  });

  it("uses a transformer's kVA as the allowable load of the capacity panel", async () => {
    open(LEAD);
    await planReady();
    await placeAt('Transformer', 300, 300);
    const kva = within(card()).getByLabelText('Capacity :');
    await userEvent.type(kva, '1500');
    await userEvent.tab();
    expect(screen.getByText(/^Allowable:/)).toHaveTextContent('Allowable: 1500 kVA');
  });

  it('#TASK-27 an isolator stands for equipment: FLS makes it fire rated (6 Nov 2026)', async () => {
    open(LEAD);
    await planReady();
    await placeAt('Isolator 3P', 300, 300);
    const props = card();
    expect(props).toHaveTextContent('CMP-006 (draft)');
    expect(within(props).getByLabelText('Fire rated :')).not.toBeChecked();
    await userEvent.selectOptions(within(props).getByLabelText('Load category :'), 'fls');
    expect(within(card()).getByLabelText('Fire rated :')).toBeChecked();
  });

  it('#TASK-18 mechanical equipment: E1803 until Fed from names its isolator, then a dashed link', async () => {
    open(LEAD);
    await planReady();
    await placeAt('Isolator 3P', 300, 300);
    await placeAt('Mechanical Equipment', 300, 500);
    const props = card();
    expect(props).toHaveTextContent('Name :Mechanical Equipment');
    expect(screen.getByRole('list', { name: 'Equipment not connected' })).toHaveTextContent(
      'E1803 ME-GF-01 is not connected to a panel',
    );
    await userEvent.type(within(props).getByLabelText('Rated power :'), '7.5');
    await userEvent.tab();
    await userEvent.selectOptions(within(card()).getByLabelText('Fed from :'), 'ISO-GF-01');
    expect(screen.queryByRole('list', { name: 'Equipment not connected' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Link ME-GF-01 - ISO-GF-01' })).toBeInTheDocument();
    // A feeder cannot be drawn to equipment.
    await userEvent.click(chip('Feeder'));
    const c = await screen.findByRole('dialog', { name: 'Cable construction' });
    for (const [label, value] of [
      ['Cores', '4C'],
      ['Conductor', 'Cu'],
      ['Insulation', 'XLPE'],
      ['Armour', 'SWA'],
      ['Sheath', 'PVC'],
      ['Voltage grade', '600/1000 V'],
      ['Installation method', 'B'],
    ]) {
      await userEvent.selectOptions(within(c).getByLabelText(label!), value!);
    }
    await userEvent.click(within(c).getByRole('button', { name: 'Use this construction' }));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 500 });
    expect(
      await screen.findByText(/is linked to its isolator or connection unit through Fed from/),
    ).toBeVisible();
  });
});

describe('#TASK-15 DB loads from Excel (FR-35)', () => {
  it('previews matched and unmatched rows (E1503), imports and writes the audit log', async () => {
    const api = open(LEAD);
    await planReady();
    await userEvent.click(chip('DB'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 300, clientY: 300 });

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DB loads');
    const header = loadTemplateHeader();
    ws.addRow(header);
    const row = (tag: string, kw: number) =>
      header.map((h, i) => (i === 0 ? tag : h.startsWith('Lighting L') ? kw : null));
    ws.addRow(row('db-gf-01', 3));
    ws.addRow(row('DB-NOT-HERE', 1));
    const file = new File([await wb.xlsx.writeBuffer()], 'loads.xlsx');
    await userEvent.upload(screen.getByLabelText('DB load sheet'), file);

    // ExcelJS reads the sheet in the page; under coverage instrumentation this takes seconds.
    const dialog = await screen.findByRole(
      'dialog',
      { name: 'Import DB loads' },
      { timeout: 20_000 },
    );
    expect(
      within(dialog).getByRole('row', { name: 'DB-GF-01 0.00 kW 9.00 kW' }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Not matched (E1503): row 3 "DB-NOT-HERE"');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 1 DB' }));
    expect(screen.getByRole('region', { name: 'Engineering Property' })).toHaveTextContent(
      'Loads :1 line, 9.00 kW',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    const saved = api.saveProject.mock.calls.at(-1)![0];
    expect(saved.auditLog.at(-1)).toMatchObject({
      area: 'loadImport',
      key: 'DB-GF-01',
      from: 0,
      to: 9,
    });
  }, 40_000); // ExcelJS reads and writes a workbook: slow when the whole suite runs in parallel
});

describe('rotate, copy / paste, Replicate floor, floor names (user request 7 Nov 2026)', () => {
  /** completeProject with the Ground Floor plan (calibrated) also on the First Floor. */
  function twoPlans(): Project {
    const p = completeProject();
    const gf = p.building.floors.find((f) => f.code === 'GF')!;
    const first = p.building.floors.find((f) => f.code === '1')!;
    first.plan = gf.plan;
    return p;
  }
  const placeDb = async (x: number) => {
    await userEvent.click(chip('DB'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: x, clientY: 300 });
  };

  it('selects several, rotates them 90 degrees and pastes copies with the next tags', async () => {
    const api = open(LEAD);
    await planReady();
    await placeDb(300);
    await placeDb(400);
    await screen.findByRole('img', { name: 'DB-GF-02 (selected)' });
    await userEvent.keyboard('{Control>}a{/Control}');
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toHaveTextContent(
      '2 components selected',
    );
    await userEvent.keyboard('r');
    await userEvent.keyboard('{Control>}c{/Control}');
    await userEvent.keyboard('{Control>}v{/Control}');
    expect(await screen.findByRole('img', { name: 'DB-GF-04 (selected)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'DB-GF-03 (selected)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    const saved = api.saveProject.mock.calls.at(-1)![0];
    expect(saved.model.elements.map((e) => [e.tag, e.rotationDeg])).toEqual([
      ['DB-GF-01', 90],
      ['DB-GF-02', 90],
      ['DB-GF-03', 90],
      ['DB-GF-04', 90],
    ]);
  });

  it('sets an exact angle in the Engineering Property', async () => {
    open(LEAD);
    await planReady();
    await placeDb(300);
    const angle = await screen.findByLabelText('Rotation (°) :');
    await userEvent.clear(angle);
    await userEvent.type(angle, '405');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText('Rotation (°) :')).toHaveValue(45));
  });

  it('replicates the floor to another floor, asking what to do with the components already there', async () => {
    const api = open(LEAD, twoPlans());
    await planReady();
    await placeDb(300);
    await placeDb(400);
    await userEvent.click(screen.getByRole('button', { name: 'Replicate floor…' }));
    let dialog = screen.getByRole('dialog', { name: 'Replicate Ground Floor' });
    expect(within(dialog).getByRole('checkbox', { name: /Second Floor/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /First Floor/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replicate to 1 floor' }));
    expect(await screen.findByText(/replicated to 1 floor: 2 components/)).toBeInTheDocument();

    // Again: First Floor now has components, so the dialog asks.
    await userEvent.click(screen.getByRole('button', { name: 'Replicate floor…' }));
    dialog = screen.getByRole('dialog', { name: 'Replicate Ground Floor' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /First Floor/ }));
    const confirm = within(dialog).getByRole('button', { name: 'Replicate to 1 floor' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/First Floor: it has 2 components/),
      'Replace them',
    );
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    const saved = api.saveProject.mock.calls.at(-1)![0];
    const first = saved.building.floors.find((f) => f.code === '1')!;
    // Replaced, not added: still two, and the freed tags are used again.
    expect(saved.model.elements.filter((e) => e.floorId === first.id).map((e) => e.tag)).toEqual([
      'DB-1-01',
      'DB-1-02',
    ]);
    expect(saved.model.elements).toHaveLength(4);
  });

  it('the Technical Lead renames a floor in the Building tab', async () => {
    const api = fakeApi(completeProject());
    render(
      <App
        auth={authFor(LEAD)}
        api={api as unknown as ApiClient}
        router={createMemoryRouter(routes, {
          initialEntries: ['/projects/p-1/floor?tab=building'],
        })}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Rename First Floor' }));
    const input = screen.getByLabelText('Name of First Floor');
    await userEvent.clear(input);
    await userEvent.type(input, 'Office Level 1{Enter}');
    expect(
      await screen.findByRole('button', { name: 'Rename Office Level 1' }),
    ).toBeInTheDocument();
  });
});
