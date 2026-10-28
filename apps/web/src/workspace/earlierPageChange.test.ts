import { completeProject, modelledProject } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { confirmationFor } from './earlierPageChange';

describe('#TASK-04 confirmation on earlier-page changes (Section 9)', () => {
  const air = { type: 'site', key: 'ambientAirC', value: 48 } as const;

  it('asks once modelling has started and the change feeds the calculations', () => {
    const c = confirmationFor(modelledProject(), air);
    expect(c?.change).toEqual({
      key: 'site.ambientAirC',
      label: 'ambient air temperature',
      from: 50,
      to: 48,
    });
    expect(c?.impact.floors).toEqual(['Ground Floor']);
  });

  it('does not ask while the project is still on Import File or nothing is modelled', () => {
    const early = modelledProject();
    early.meta.reachedPage = 'setup';
    expect(confirmationFor(early, air)).toBeNull();
    expect(confirmationFor(completeProject(), air)).toBeNull();
  });

  it('does not ask for descriptive fields or when nothing changes', () => {
    const p = modelledProject();
    expect(confirmationFor(p, { type: 'details', patch: { name: 'New name' } })).toBeNull();
    expect(confirmationFor(p, { type: 'site', key: 'ambientAirC', value: 50 })).toBeNull();
  });

  it('describes check boxes, demand factors and plot load', () => {
    const p = modelledProject();
    expect(
      confirmationFor(p, { type: 'check', check: 'shortCircuit', enabled: false })?.change,
    ).toMatchObject({ from: 'ticked', to: 'not ticked' });
    expect(
      confirmationFor(p, {
        type: 'demandFactor',
        table: 'byLoadType',
        key: '1',
        value: 0.9,
        audit: { id: 'a', at: '2026-10-28T00:00:00.000Z', userId: 'u-lead' },
      })?.change,
    ).toMatchObject({ key: 'calculation.demandFactors.byLoadType.1', from: null, to: 0.9 });
    expect(
      confirmationFor(p, { type: 'details', patch: { plotLoad: { value: 3000, unit: 'kVA' } } })
        ?.change,
    ).toMatchObject({ key: 'details.plotLoad', from: 2500, to: 3000 });
  });
});
