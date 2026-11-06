import type { Element } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it, vi } from 'vitest';

// A rule pack without a default load power factor: a DB with none entered, whose load type
// (Kitchen) has no power factor of its own either, cannot get an Ib.
vi.mock('@neuromep/rulepacks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@neuromep/rulepacks')>();
  return {
    ...real,
    getRulePack: (id: string, version: string) => {
      const pack = real.getRulePack(id, version);
      return {
        ...pack,
        calculationDefaults: pack.calculationDefaults.filter(
          (d) => d.key !== 'defaultLoadPowerFactor',
        ),
      };
    },
  };
});

describe('#TASK-20 missing power factor (V-14)', () => {
  it('blocks the feeder with E2003 instead of assuming a power factor', async () => {
    const { designFeeders } = await import('./design.js');
    const p = completeProject();
    const f = p.building.floors[0]!.id;
    const mdb = testElement('mdb', 'mdb', f);
    const db = {
      ...sampleDb(f, 'db'),
      powerFactor: null,
      loads: [{ method: 'kw' as const, loadType: '6' as const, kwL1: 1, kwL2: 1, kwL3: 1 }],
    } as Element;
    p.model.elements = [mdb, db];
    p.model.cables = [testCable(mdb, db)];
    const d = designFeeders(p)[0]!;
    expect(d).toMatchObject({ status: 'blocked', ibA: null, pf: null });
    expect(d.errors[0]).toBe('E2003');
    expect(d.trace.at(-1)?.detail).toBe('Power factor missing on the load.');
  });
});

describe('#TASK-22 riser with a load but no power factor (V-14)', () => {
  it('says so instead of sizing the riser', async () => {
    const { checkNetworkFeeders } = await import('./checks.js');
    const p = completeProject();
    const f = p.building.floors[0]!.id;
    const tx = testElement('transformer', 'tx', f);
    const db = {
      ...sampleDb(f, 'db'),
      tag: 'DB-1',
      powerFactor: null,
      loads: [{ method: 'kw' as const, loadType: '6' as const, kwL1: 1, kwL2: 1, kwL3: 1 }],
    } as Element;
    p.model.elements = [tx, db];
    p.model.risers = [{ id: 'r1', lengthM: 10, widthM: 1, fedFromId: 'tx', feeds: ['db'] }];
    const riser = checkNetworkFeeders(p).risers[0]!;
    expect(riser.ibA).toBeNull();
    expect(riser.notes[0]).toBe('No power factor for the load on Riser 1 (E2003).');
  });
});
