import { CALC_COLUMNS, type CalcSheet } from '@neuromep/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('calculation sheet breaker type dropdown (A-34, 27 Nov 2026)', () => {
  const row = (patch: Record<string, unknown>) =>
    ({
      ...sheet,
      rows: [
        {
          ...Object.fromEntries(CALC_COLUMNS.map((c) => [c.key, null])),
          ref: 'F-02',
          cableId: 'c-2',
          device: 'MCCB',
          ...patch,
        },
      ],
    }) as unknown as CalcSheet;

  it('shows the default type; choosing another calls back with it, the default with null', async () => {
    const onBreakerType = vi.fn();
    render(<CalcSheetPreview sheet={row({})} onBreakerType={onBreakerType} />);
    const select = screen.getByLabelText('F-02 breaker type');
    expect(select).toHaveValue('MCCB');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'MCCB',
      'ACB',
    ]);
    await userEvent.selectOptions(select, 'ACB');
    expect(onBreakerType).toHaveBeenLastCalledWith('c-2', 'ACB');
    await userEvent.selectOptions(select, 'MCCB');
    expect(onBreakerType).toHaveBeenLastCalledWith('c-2', null);
  });

  it('a choice different from the default is shown orange with the reason', () => {
    render(
      <CalcSheetPreview
        sheet={row({ 'device:chosen': 'ACB', device: 'ACB', 'device:default': 'MCCB' })}
        onBreakerType={() => undefined}
      />,
    );
    const cell = screen.getByLabelText('F-02 breaker type').closest('td')!;
    expect(cell).toHaveClass('calc-changed');
    expect(cell.getAttribute('title')).toMatch(/Changed from the default MCCB \(W2004\)/);
  });

  it('read-only without edit rights', () => {
    render(<CalcSheetPreview sheet={row({})} />);
    expect(screen.queryByLabelText('F-02 breaker type')).not.toBeInTheDocument();
  });
});
