import { describe, expect, it } from 'vitest';
import { sampleDb, testCable, testElement } from '../testing.js';
import type { Cable } from './cable.js';
import type { Element } from './elements.js';
import { fireRatedFlags, flsPaths } from './fireRated.js';

const fr = (c: Cable): Cable => ({ ...c, construction: { ...c.construction, insulation: 'FR' } });
const tagged = (e: Element, tag: string) => ({ ...e, tag }) as Element;

/** TX and GEN into an ATS; ATS > ESMDB > FLS DB and a normal DB. */
function network(patch: (c: Record<string, Cable>) => void = () => {}) {
  const tx = tagged(testElement('transformer', 'tx'), 'TX');
  const gen = tagged(testElement('generator', 'gen'), 'GEN');
  const ats = tagged(testElement('ats', 'ats'), 'ATS');
  const smdb = tagged(testElement('smdb', 'smdb'), 'ESMDB');
  const fls = { ...sampleDb('gf', 'fls'), tag: 'DB-FLS', loadCategory: 'fls' } as Element;
  const db = { ...sampleDb('gf', 'db'), tag: 'DB-N' } as Element;
  const c: Record<string, Cable> = {
    txAts: testCable(tx, ats, 'normal'),
    genAts: testCable(gen, ats, 'standby'),
    atsSmdb: testCable(ats, smdb),
    smdbFls: testCable(smdb, fls),
    smdbDb: testCable(smdb, db),
  };
  for (const [k, v] of Object.entries(c)) c[k] = { ...v, tag: k };
  patch(c);
  return { elements: [tx, gen, ats, smdb, fls, db], cables: Object.values(c), risers: [] };
}

describe('#TASK-27 fire-rated feeder flags (10.14, briefing page 9)', () => {
  it('follows an FLS load up to the generator through the ATS standby input only', () => {
    const paths = flsPaths(network());
    expect([...paths.keys()].sort()).toEqual(['c-ats-smdb', 'c-gen-ats', 'c-smdb-fls']);
    expect(paths.get('c-smdb-fls')).toEqual(['DB-FLS']);
  });

  it('flags every feeder on that path that is not fire-rated (E2701)', () => {
    const flags = fireRatedFlags(network());
    expect(flags.map((f) => [f.code, f.cableId])).toEqual([
      ['E2701', 'c-gen-ats'],
      ['E2701', 'c-ats-smdb'],
      ['E2701', 'c-smdb-fls'],
    ]);
    expect(flags[2]!.message).toBe(
      'smdbFls feeds fire & life-safety load DB-FLS and is not fire-rated',
    );
  });

  it('is quiet once the path is fire-rated, and flags a fire-rated feeder not needed (E2702)', () => {
    const m = network((c) => {
      c.genAts = fr(c.genAts!);
      c.atsSmdb = fr(c.atsSmdb!);
      c.smdbFls = fr(c.smdbFls!);
      c.smdbDb = fr(c.smdbDb!); // normal DB
      c.txAts = fr(c.txAts!); // transformer side (manager: FR on the generator side only)
    });
    expect(fireRatedFlags(m).map((f) => [f.code, f.cableId])).toEqual([
      ['E2702', 'c-tx-ats'],
      ['E2702', 'c-smdb-db'],
    ]);
  });

  it('takes a busbar feeder as fire-rated when its busbar is', () => {
    const m = network((c) => {
      c.genAts = fr(c.genAts!);
      c.smdbFls = fr(c.smdbFls!);
      c.atsSmdb = {
        ...c.atsSmdb!,
        feederType: 'busbar',
        busbar: { conductor: 'Cu', ipRating: null, fireRated: true },
      } as Cable;
    });
    expect(fireRatedFlags(m)).toEqual([]);
  });
});
