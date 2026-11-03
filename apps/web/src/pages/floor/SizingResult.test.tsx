import { mockRun, type StoredResult } from '@neuromep/shared';
import { modelledProject, testCable, testElement } from '@neuromep/shared/testing';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resultFigures, SizingResult } from './SizingResult';
import { tooltipLines } from './tooltip';

const RUN = { runId: 'r1', at: '2026-11-01T10:00:00.000Z' };

function sized() {
  const p = modelledProject();
  p.model.results = mockRun(p, { kind: 'project' }, RUN);
  const db = p.model.elements.find((e) => e.kind === 'db')!;
  return { p, db };
}

describe('#TASK-16 right-panel results and tooltips (FR-18, FR-21, FR-36)', () => {
  it('asks for Cable Size before the first run', () => {
    const p = modelledProject();
    render(<SizingResult project={p} id={p.model.elements[0]!.id} />);
    expect(screen.getByText('Not sized yet - press Cable Size.')).toBeInTheDocument();
  });

  it('shows a mock result as Provisional, labelled, with no values', () => {
    const { p, db } = sized();
    render(<SizingResult project={p} id={db.id} />);
    expect(screen.getByText(/Mock run - the calculation engine arrives in WBS 1.6/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/^Provisional - /);
    expect(screen.getByRole('list', { name: 'Checks' })).toHaveTextContent('C1');
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
