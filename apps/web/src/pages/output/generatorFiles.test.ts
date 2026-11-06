import type { GeneratorAnalysis } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { generatorPdf, genLines, genSummary } from './generatorFiles';

const row = (to: string, kw: number, edited: boolean) => ({
  elementId: to,
  from: 'ESMDB-1',
  to,
  kw: { L1: kw, L2: kw, L3: kw },
  totalKw: 3 * kw,
  factors: { normal: 0.8, powerFailure: 0.8, fire: 0.8 },
  remarks: edited ? '1D+1S' : '',
  edited,
  normalKw: 2.4 * kw,
  powerFailureKw: 2.4 * kw,
  fireKw: 2.4 * kw,
});
const analysis = (rows: number): GeneratorAnalysis => ({
  generatorId: 'gen',
  tag: 'GEN-1',
  groups: [
    {
      from: 'EMDB-1',
      to: 'ESMDB-1',
      rows: Array.from({ length: rows }, (_, i) => row(`PUMP-${i + 1}`, 2, i === 0)),
    },
  ],
  totals: { connectedKw: 6 * rows, normalKw: 4.8 * rows, powerFailureKw: 4.8 * rows, fireKw: 0 },
  loadKw: 4.8 * rows,
  governing: 'power failure',
  sparePct: 10,
  spareKw: 0.48 * rows,
  requiredKw: 5.28 * rows,
  pf: 0.8,
  requiredKva: 6.6 * rows,
  selectedKva: null,
  adequate: null,
});

describe('#TASK-28 Generator Load Analysis files', () => {
  it('lays out panel rows, load rows and the totals; highlights loads not edited', () => {
    const lines = genLines(analysis(2));
    expect(lines.map((l) => l.kind)).toEqual(['group', 'row', 'row', 'total']);
    expect(lines[1]!.cells.slice(0, 6)).toEqual([
      'ESMDB-1',
      'PUMP-1',
      '2.000',
      '2.000',
      '2.000',
      '6.000',
    ]);
    expect(lines.map((l) => l.unedited)).toEqual([undefined, false, true, undefined]);
    expect(genSummary(analysis(2))[4]).toEqual([
      'GENERATOR RATING SELECTED (kVA)',
      '-',
      'Enter the kVA of GEN-1 in Floor Setup',
    ]);
  });

  it('writes a PDF and continues on a new page with the heads repeated', async () => {
    const pdf = new TextDecoder('latin1').decode(
      await generatorPdf([analysis(60)], { project: 'Avarra', client: 'Palace' }),
    );
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('LOAD ANALYSIS - GENERATORS - GEN-1');
    expect(pdf).toContain('PUMP-60');
    expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(pdf.match(/\(FROM\)/g)!.length).toBeGreaterThan(1); // heads on every page
  });
});
