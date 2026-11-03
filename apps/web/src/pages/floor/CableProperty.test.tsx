import { testCable, testElement } from '@neuromep/shared/testing';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CableProperty } from './CableProperty';

function show(fromKey: string, feederType: 'cable' | 'busbar' = 'cable') {
  const from = testElement(fromKey, 'src');
  const to = testElement('db', 'db');
  const onChange = vi.fn();
  render(
    <CableProperty
      cable={{ ...testCable(from, to), feederType }}
      elements={[from, to]}
      length={null}
      editable
      takenTags={[]}
      onChange={onChange}
      onEditConstruction={() => undefined}
      onDelete={() => undefined}
    />,
  );
  return onChange;
}

describe('#TASK-13 feeder type: cable or busbar (decision 1 Nov 2026)', () => {
  it('switches a feeder from an MDB to busbar with the default busbar fields', async () => {
    const onChange = show('mdb');
    expect(screen.getByText(/Cu\/XLPE/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type :'), 'busbar');
    expect(onChange).toHaveBeenCalledWith({
      feederType: 'busbar',
      busbar: { conductor: 'Cu', ipRating: null, fireRated: false },
    });
  });

  it('shows the busbar fields instead of the cable construction', () => {
    show('mdb', 'busbar');
    expect(screen.getByLabelText('Conductor :')).toHaveValue('Cu');
    expect(screen.getByText('Datasheet required (OI-13)')).toBeInTheDocument();
    expect(screen.queryByText(/Cu\/XLPE/)).toBeNull();
  });

  it('offers no busbar from an SMDB', () => {
    show('smdb');
    expect(screen.getByRole('option', { name: 'Busbar' })).toBeDisabled();
    expect(screen.getByText(/starts at a transformer or a main panel/)).toBeInTheDocument();
  });
});
