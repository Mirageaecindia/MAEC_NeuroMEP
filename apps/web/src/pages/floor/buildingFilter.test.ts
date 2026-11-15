import type { Element } from '@neuromep/shared';
import { testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { boardGap, connections, isGreyed, passesFilter } from './buildingFilter';

/** TX > MDB > DB, an SMDB on a riser from the MDB, a loose DB, an isolator with its equipment, a meter. */
function network() {
  const tx = testElement('transformer', 'tx');
  const mdb = testElement('mdb', 'mdb');
  const db = testElement('db', 'db');
  const smdb = testElement('smdb', 'smdb');
  const loose = testElement('db', 'loose');
  const iso = testElement('isolator-tp', 'iso');
  const ahu = { ...testElement('mechanical-equipment', 'ahu'), fedFromId: 'iso' } as Element;
  const meter = { ...testElement('meter', 'm1'), meteredId: 'db' } as Element;
  const lone = testElement('meter', 'm2');
  return {
    elements: [tx, mdb, db, smdb, loose, iso, ahu, meter, lone],
    cables: [testCable(tx, mdb), testCable(mdb, db)],
    risers: [{ id: 'riser-1', lengthM: 10, widthM: 1, fedFromId: 'mdb', feeds: ['smdb'] }],
  };
}

describe('Building tab view filters (user request 15 Nov 2026)', () => {
  const m = network();
  const c = connections(m);
  const shown = (filter: 'all' | 'power-required' | 'disconnected') =>
    m.elements.filter((e) => passesFilter(e.id, filter, c)).map((e) => e.id);

  it('Show All Components: everything', () => {
    expect(shown('all')).toHaveLength(m.elements.length);
  });

  it('Show Power Required: no incoming connection - the transformer and meters too', () => {
    // Fed by a feeder (mdb, db), a riser tap-off (smdb) or its isolator (ahu): greyed.
    expect(shown('power-required')).toEqual(['tx', 'loose', 'iso', 'm1', 'm2']);
  });

  it('Show Disconnected Components: neither incoming nor outgoing', () => {
    // The isolator feeds its equipment; the meter m1 is linked to what it measures.
    expect(shown('disconnected')).toEqual(['loose', 'm2']);
  });

  it("a component's own Hide / Show wins over its floor's filter", () => {
    const tx = m.elements[0]!;
    const mdb = m.elements[1]!;
    expect(isGreyed(tx, 'power-required', undefined, c)).toBe(false);
    expect(isGreyed(tx, 'power-required', 'hidden', c)).toBe(true);
    expect(isGreyed(mdb, 'power-required', undefined, c)).toBe(true);
    expect(isGreyed(mdb, 'power-required', 'shown', c)).toBe(false);
  });

  it('spaces the components for the longest tag', () => {
    expect(boardGap([])).toBe(96);
    expect(boardGap(['DB-1'])).toBe(96);
    expect(boardGap(['SMDB-T-L2-AP-0001-LONG'])).toBe(22 * 6 + 24);
  });
});
