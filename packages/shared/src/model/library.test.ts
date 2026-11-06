import { describe, expect, it } from 'vitest';
import { isPlaceable, LIBRARY_ITEMS, libraryItem, nextTag, placeElement } from './library.js';

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
      // Added 6 Nov 2026 (not in Figma): load points standing for mechanical / PHE equipment.
      'Isolator 1P',
      'Isolator 3P',
      'Connection Unit',
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
