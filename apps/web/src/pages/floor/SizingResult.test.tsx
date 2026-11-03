import { inputsKey, mergeRun, type ElementResult, type StoredResult } from '@neuromep/shared';
import { modelledProject, testCable, testElement } from '@neuromep/shared/testing';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resultFigures, SizingResult } from './SizingResult';
import { tooltipLines } from './tooltip';

const RESULT: Omit<ElementResult, 'elementId'> = {
  status: 'provisional',
  provisionalReasons: ['device-data-required'],
  errors: ['E2402'],
  sizedBy: 'C2',
  checks: {
    C1: { state: 'pass', detail: '1 x 16 mm²: Iz 77.0 A vs In 63 A: pass' },
    C3: { state: 'not-calculated', detail: 'Not calculated - not selected on Page 1' },
  },
  size: { runs: 1, cores: '4C', sizeMm2: 16, eccMm2: 16, lengthM: 35 },
  device: { type: 'MCCB', ratingA: 63, poles: '3P', faultRatingKa: 25 },
  load: null,
  values: {
    ibA: 51.2,
    inA: 63,
    izA: 77,
    vdOwnPct: 0.456,
    vdTotalPct: 1.5,
    ikMaxKa: 12.345,
    ikMinKa: 4.5,
    ipKa: 20,
    zsMohm: null,
  },
  trace: [{ step: 'Ib', detail: 'three-phase: Ib = 51.2 A' }],
};

function sized() {
  const p = modelledProject();
  const db = p.model.elements.find((e) => e.kind === 'db')!;
  p.model.results = mergeRun(p, { kind: 'project' }, [{ ...RESULT, elementId: db.id }], {
    runId: 'r1',
    at: '2026-11-03T10:00:00.000Z',
    engineVersion: '0.1.0',
    inputsKey: inputsKey(p),
  });
  return { p, db };
}

describe('#TASK-16 right-panel results and tooltips (FR-18, FR-21, FR-36)', () => {
  it('asks for Cable Size before the first run', () => {
    const p = modelledProject();
    render(<SizingResult project={p} id={p.model.elements[0]!.id} />);
    expect(screen.getByText('Not sized yet - press Cable Size.')).toBeInTheDocument();
  });

  it('shows status, Sized by, size, breaker, currents, drops, faults, checks and the trace', () => {
    const { p, db } = sized();
    render(<SizingResult project={p} id={db.id} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Provisional - breaker data required (E2402)',
    );
    const card = screen.getByRole('region', { name: 'Cable Size result' });
    expect(card).toHaveTextContent('C2 Voltage drop');
    expect(card).toHaveTextContent('1 x 4C 16 mm² + 16 mm² ECC');
    expect(card).toHaveTextContent('63 A MCCB 3P 25 kA');
    expect(card).toHaveTextContent('51.2 A / 63 A / 77.0 A');
    expect(card).toHaveTextContent('12.35 kA max, 4.50 kA min');
    const checks = screen.getByRole('list', { name: 'Checks' });
    expect(checks).toHaveTextContent('C1 Current-carrying capacity: pass');
    expect(checks).toHaveTextContent('C3 Breaking / making capacity: not selected on Page 1');
    expect(screen.getByText('Calculation trace')).toBeInTheDocument();
    expect(card).toHaveTextContent('three-phase: Ib = 51.2 A');
  });

  it('turns grey and says Out of date once an input changes', () => {
    const { p, db } = sized();
    p.calculation.checks.shortCircuit = !p.calculation.checks.shortCircuit;
    render(<SizingResult project={p} id={db.id} />);
    expect(screen.getByRole('status')).toHaveTextContent('Out of date - press Cable Size');
    expect(screen.getByRole('region', { name: 'Cable Size result' })).toHaveClass('out-of-date');
  });

  it('prints voltage drop to 2 decimals', () => {
    const { p, db } = sized();
    const r = p.model.results.find((x) => x.elementId === db.id)!;
    const values: StoredResult['values'] = { ...r.values, vdOwnPct: 0.456, vdTotalPct: 1.5 };
    expect(resultFigures({ ...r, values })).toMatchObject({ vdOwn: '0.46 %', vdTotal: '1.50 %' });
  });

  it('builds the 12.5 tooltip of a feeder and a board', () => {
    const { p, db } = sized();
    const mdb = testElement('mdb', 'mdb-x', db.floorId);
    const cable = testCable(mdb, db);
    p.model.elements.push(mdb);
    p.model.cables.push(cable);
    const feeder = tooltipLines(p, new Map(), { allowancePct: 0, additionM: 5 }, cable.id)!;
    expect(feeder[0]).toBe(`${cable.tag} - Cable`);
    expect(feeder.some((l) => l.startsWith('Length: '))).toBe(true);
    expect(feeder.at(-1)).toMatch(/^Vd circuit: - · Vd total: -$/);
    const board = tooltipLines(p, new Map(), { allowancePct: 0, additionM: 5 }, db.id)!;
    expect(board[0]).toBe(db.tag);
    expect(board.some((l) => l.startsWith('Fed from: '))).toBe(true);
  });
});
