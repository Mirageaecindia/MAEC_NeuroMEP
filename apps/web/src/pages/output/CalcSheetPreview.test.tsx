import { CALC_COLUMNS, type CalcSheet } from '@neuromep/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalcSheetPreview } from './CalcSheetPreview';

const sheet = {
  project: 'P',
  rulePack: 'dubai v1',
  sizesPending: false,
  notSized: { missingPf: [], missingEfficiency: [], awaitingLoad: [], otherBlocked: 0 },
  rows: [
    {
      ...Object.fromEntries(CALC_COLUMNS.map((c) => [c.key, null])),
      ref: 'F-01',
      C1: 'Fail',
      'C1:detail': 'Iz 38.2 A < In 40 A',
    },
  ],
} as unknown as CalcSheet;

describe('calculation sheet check columns (hover descriptions, 26 Nov 2026)', () => {
  it('keeps the C1 header short and explains it on hover, header and cells', () => {
    render(<CalcSheetPreview sheet={sheet} />);
    const head = screen.getByRole('columnheader', { name: 'C1' });
    expect(head).toHaveAttribute('title', expect.stringMatching(/^C1 Current-carrying capacity/));
    const cell = screen.getByRole('cell', { name: 'Fail' });
    expect(cell.getAttribute('title')).toMatch(
      /Current-carrying capacity[\s\S]*Result: Fail - Iz 38\.2 A < In 40 A[\s\S]*N\.C\. = not calculated/,
    );
  });
});
