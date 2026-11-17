import { describe, expect, it } from 'vitest';
import {
  BUILDING_TAB_HIDDEN,
  hiddenInBuildingTab,
  isPlaceable,
  LIBRARY_ITEMS,
  libraryItem,
  nextTag,
  placeElement,
} from './library.js';

const place = (key: string, taken: string[] = [], floorCode = 'GF') => {
  const item = libraryItem(key)!;
  if (!isPlaceable(item)) throw new Error(`${key} is a tool`);
  return placeElement(item, {
    id: `${key}-1`,
    floorId: 'f-gf',
    floorCode,
    position: { x: 10, y: 5 },
    taken,
  });
};

describe('#TASK-11 component library (A-11, Section 13)', () => {
  it('has the Figma items in order, then the load points, all enabled, Cable as a tool', () => {
    expect(LIBRARY_ITEMS.map((i) => i.label)).toEqual([
      'ATS',
      'Generator',
      'EB Utility',
      'Transformer',
      'RMU',
      'LV Panel',
      'ACB',
      'MDB',
      'SMDB',
      'MCC',
      'DB',
      'Feeder',
      'Lighting',
      // Added 7 Nov 2026 (manager feedback, not in Figma).
      'UPS',
      // Added 6 Nov 2026 (not in Figma): load points standing for mechanical / PHE equipment.
      'Isolator 1P',
      'Isolator 3P',
      'Connection Unit',
      // Components workbook (user request 10 Nov 2026).
      'PFC Bank',
      'Meter',
      // Briefing page 9 (6 Nov 2026): equipment on the mechanical / PHE layers.
      'Mechanical Equipment',
      'PHE Equipment',
    ]);
    expect(LIBRARY_ITEMS.filter((i) => !isPlaceable(i)).map((i) => i.key)).toEqual(['cable']);
  });

  it('creates a valid element for every placeable item, with engineering values left empty', () => {
    for (const item of LIBRARY_ITEMS.filter(isPlaceable)) {
      const e = place(item.key);
      expect(e).toMatchObject({
        floorId: 'f-gf',
        position: { x: 10, y: 5 },
        discipline: item.discipline,
      });
    }
    expect(LIBRARY_ITEMS.filter((i) => i.discipline !== 'electrical').map((i) => i.key)).toEqual([
      'mechanical-equipment',
      'phe-equipment',
    ]);
    expect(place('mechanical-equipment')).toMatchObject({
      kind: 'equipment',
      discipline: 'mechanical',
      fedFromId: null,
      kw: null,
      efficiency: null,
      starter: null,
      fls: false,
    });
    expect(place('transformer')).toMatchObject({ kind: 'transformer', kva: null, ukPct: null });
    expect(place('lighting')).toMatchObject({ kind: 'db', description: 'Lighting' });
    expect(place('rmu')).toMatchObject({ kind: 'eb-utility', description: 'RMU' });
  });
});

describe('Building tab: the items after the Feeder (user request 18 Nov 2026)', () => {
  it('are left out of the Building tab and greyed there', () => {
    expect([...BUILDING_TAB_HIDDEN]).toEqual([
      'lighting',
      'ups',
      'isolator-sp',
      'isolator-tp',
      'connection-unit',
      'pfc',
      'meter',
      'mechanical-equipment',
      'phe-equipment',
    ]);
    const at = { floorId: 'gf', floorCode: 'GF', position: { x: 0, y: 0 }, taken: [] };
    const make = (key: string) => {
      const item = libraryItem(key)!;
      if (!isPlaceable(item)) throw new Error(key);
      return placeElement(item, { id: key, ...at });
    };
    expect(hiddenInBuildingTab(make('isolator-tp'))).toBe(true);
    // A lighting board is a DB in the model, still left out as the Lighting item.
    expect(hiddenInBuildingTab(make('lighting'))).toBe(true);
    expect(hiddenInBuildingTab(make('db'))).toBe(false);
    expect(hiddenInBuildingTab(make('smdb'))).toBe(false);
  });
});

describe('#TASK-12 automatic tags (Section 12.4, OI-24)', () => {
  it('follows 12.4 for transformers and generators and proposes the rest', () => {
    expect(place('transformer').tag).toBe('Tx_GF_1');
    expect(place('generator', [], 'B1').tag).toBe('Gen_B1_1');
    expect(place('smdb', [], '2').tag).toBe('SMDB-2-01');
    expect(place('lighting').tag).toBe('LDB-GF-01');
  });

  it('takes the next free number, ignoring case', () => {
    expect(place('transformer', ['Tx_GF_1', 'tx_gf_2']).tag).toBe('Tx_GF_3');
    expect(nextTag({ pattern: 'DB-{floor}-{nn}', source: 'proposal' }, 'GF', ['DB-GF-01'])).toBe(
      'DB-GF-02',
    );
  });
});
