import { describe, expect, it } from 'vitest';
import type { Floor } from '../project/schema.js';
import { testCable as cable, testElement as el } from '../testing.js';
import { completenessIssues, scenarioSupply, suppliedIn } from './network.js';
import { setBoardRiser, setRiser } from './riser.js';

const floor = (id: string, name: string): Floor => ({
  id,
  code: id,
  name,
  type: 'typical',
  heightM: null,
  plan: null,
});
const floors = [
  floor('gf', 'Ground Floor'),
  floor('f1', 'First Floor'),
  floor('f2', 'Second Floor'),
];

const tx = el('transformer', 'TX');
const gen = el('generator', 'GEN');
const ats = el('ats', 'ATS');
const mdb = el('mdb', 'MDB');
const smdb = el('smdb', 'SMDB-1', 'f1');
const db = el('db', 'DB-1', 'f1');
const loose = el('db', 'DB-2', 'f2');

/** TX + GEN > ATS > MDB > Riser 1 > SMDB-1 (First Floor) > DB-1; DB-2 on the Second Floor alone. */
function network() {
  let risers = setRiser([], 'riser-1', { lengthM: 20, fedFromId: 'MDB' });
  risers = setBoardRiser(risers, 'SMDB-1', 'riser-1');
  return {
    elements: [tx, gen, ats, mdb, smdb, db, loose],
    cables: [
      cable(tx, ats, 'normal'),
      cable(gen, ats, 'standby'),
      cable(ats, mdb),
      cable(smdb, db),
    ],
    risers,
  };
}

describe('#TASK-18 network completeness (FR-20, E1801 / E1802)', () => {
  it('follows cables, ATS inputs and risers to the sources of each scenario', () => {
    const m = network();
    for (const scenario of ['normal', 'standby'] as const) {
      const on = suppliedIn(m, scenario);
      expect([...on].sort()).toEqual(
        ['ATS', 'DB-1', 'MDB', 'SMDB-1', scenario === 'normal' ? 'TX' : 'GEN'].sort(),
      );
    }
  });

  it('reports a floor without a riser tap-off and components without a source', () => {
    expect(completenessIssues(network(), floors)).toEqual([
      {
        code: 'E1802',
        floorId: 'f2',
        message: 'Second Floor has boards but no tap-off from a riser.',
      },
      {
        code: 'E1801',
        floorId: 'f2',
        elementId: 'DB-2',
        message: 'DB-2 has no path to a transformer or generator.',
      },
    ]);
  });

  it('accepts a component supplied on standby only (generator-only panel)', () => {
    const m = network();
    const genOnly = el('mdb', 'MDB-G');
    m.elements = [tx, gen, ats, mdb, smdb, db, genOnly];
    m.cables = [...m.cables, cable(gen, genOnly)];
    expect(completenessIssues(m, floors)).toEqual([]);
    expect(scenarioSupply(m, 'normal').notSupplied.map((e) => e.id)).toEqual(['MDB-G']);
    expect(scenarioSupply(m, 'standby').notSupplied).toEqual([]);
  });

  it('loses the standby supply when the ATS standby input is not connected', () => {
    const m = network();
    m.cables = m.cables.filter((c) => c.to.port !== 'standby');
    expect(scenarioSupply(m, 'standby').supplied).toEqual([]);
  });
});
