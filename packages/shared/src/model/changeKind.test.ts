import { describe, expect, it } from 'vitest';
import { testCable, testElement } from '../testing.js';
import { changeKind, portsAfterKindChange } from './changeKind.js';
import type { Element } from './elements.js';

describe('Change type (manager feedback, 7 Nov 2026)', () => {
  it('turns an EMDB into an ESMDB keeping id, properties and loads; the tag prefix follows', () => {
    const emdb = {
      ...testElement('mdb', 'p1'),
      kind: 'emdb' as const,
      tag: 'EMDB-P1-GF-01',
      description: 'Life safety board',
      loadCategory: 'fls' as const,
      manualLoads: [{ method: 'kw' as const, loadType: '1' as const, kwL1: 1, kwL2: 1, kwL3: 1 }],
    } as Element;
    const esmdb = changeKind(emdb, 'esmdb', ['EMDB-P1-GF-01'])!;
    expect(esmdb).toMatchObject({
      id: 'p1',
      kind: 'esmdb',
      tag: 'ESMDB-P1-GF-01',
      description: 'Life safety board',
      loadCategory: 'fls',
      manualLoads: 'manualLoads' in emdb ? emdb.manualLoads : [],
      version: emdb.version + 1,
    });
  });

  it('keeps the fields that fit when the type family changes (DB -> SMDB), drops the rest', () => {
    const db = { ...testElement('db', 'd'), tag: 'DB-GF-01', poles: 'TPN' as const };
    const smdb = changeKind(db, 'smdb', [])!;
    expect(smdb).toMatchObject({ id: 'd', kind: 'smdb', tag: 'SMDB-GF-01', poles: 'TPN' });
    expect('loads' in smdb).toBe(false);
    // A tag in use stays as it was; a tag without the old prefix is kept.
    expect(changeKind(db, 'smdb', ['SMDB-GF-01'])!.tag).toBe('DB-GF-01');
    expect(changeKind({ ...db, tag: 'MAIN BOARD' }, 'mdb', [])!.tag).toBe('MAIN BOARD');
  });

  it('gives an ATS a normal and a standby input; back to a board both become inputs', () => {
    const tx = testElement('transformer', 'tx');
    const gen = testElement('generator', 'gen');
    const mdb = testElement('mdb', 'm');
    const cables = [testCable(tx, mdb), testCable(gen, mdb)];
    const ats = portsAfterKindChange(cables, 'm', 'ats');
    expect(ats.map((c) => c.to.port)).toEqual(['normal', 'standby']);
    expect(portsAfterKindChange(ats, 'm', 'mdb').map((c) => c.to.port)).toEqual(['in', 'in']);
  });
});
