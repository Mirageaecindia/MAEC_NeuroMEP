import { ElementSchema, type Discipline, type Element, type ModelPoint } from './elements.js';

/**
 * Component library of Floor Setup (A-11: the Figma items, all enabled; design doc Section 13).
 * Each placeable item creates one network element. Engineering values start empty (TBC) - the
 * engineer enters them, the engine calculates sizes - so nothing is invented here.
 *
 * CMP codes: Section 13 gives CMP-001..003 for DB / SMDB / MCC and lists ten items for the nine
 * codes CMP-007..015; they are assigned in the listed order and stay drafts until the legend
 * symbols are supplied (OI-34).
 */

/** How a tag is proposed (Section 12.4, OI-24 to be confirmed). `{floor}` = floor code (GF, B1, 2). */
export interface TagRule {
  pattern: string;
  /** Section 12.4 defines it, or the engineer defines it and this is only a proposal. */
  source: '12.4' | 'proposal';
}

interface PlaceableItem {
  key: string;
  label: string;
  discipline: Discipline;
  cmpCode: string;
  tag: TagRule;
  tool?: false;
  /** The element this item creates, without id, tag, floor and position. */
  create: () => Omit<Element, 'id' | 'tag' | 'floorId' | 'position'>;
}

interface ToolItem {
  key: string;
  label: string;
  discipline: Discipline;
  /** A drawing tool, not a component (Cable: WBS 1.3.2). */
  tool: true;
}

export type LibraryItem = PlaceableItem | ToolItem;

const common = {
  version: 0,
  description: '',
  location: '',
  discipline: 'electrical' as const,
  ipRating: null,
  fireRated: false,
};
const board = (incomerDevice: 'ACB' | 'MCCB') => ({
  poles: 'TPN' as const,
  loadCategory: 'normal' as const,
  incomerDevice,
  earthLeakage: 'none' as const,
  mounting: null,
  standbyKw: null,
});
const panel = (kind: 'lv-panel' | 'mdb' | 'acb-panel' | 'smdb', incomer: 'ACB' | 'MCCB') => () => ({
  ...common,
  ...board(incomer),
  kind,
  demandCategories: [],
  manualLoads: [],
  icwKa: null,
  ipkKa: null,
  demandFactorOverrides: {},
});
const db = (description: string) => () => ({
  ...common,
  ...board('MCCB'),
  description,
  kind: 'db' as const,
  demandCategory: null,
  loads: [],
  powerFactor: null,
  thirdHarmonicPct: null,
});
const proposal = (prefix: string): TagRule => ({
  pattern: `${prefix}-{floor}-{nn}`,
  source: 'proposal',
});

export const LIBRARY_ITEMS: readonly LibraryItem[] = [
  {
    key: 'ats',
    label: 'ATS',
    discipline: 'electrical',
    cmpCode: 'CMP-010',
    tag: proposal('ATS'),
    create: () => ({ ...common, kind: 'ats' }),
  },
  {
    key: 'generator',
    label: 'Generator',
    discipline: 'electrical',
    cmpCode: 'CMP-009',
    tag: { pattern: 'Gen_{floor}_{n}', source: '12.4' },
    create: () => ({
      ...common,
      kind: 'generator',
      kvaOverride: null,
      xdSubtransientPct: null,
      sustainedScKa: null,
    }),
  },
  {
    key: 'eb-utility',
    label: 'EB Utility',
    discipline: 'electrical',
    cmpCode: 'CMP-007',
    tag: proposal('EB'),
    create: () => ({ ...common, kind: 'eb-utility' }),
  },
  {
    key: 'transformer',
    label: 'Transformer',
    discipline: 'electrical',
    cmpCode: 'CMP-008',
    tag: { pattern: 'Tx_{floor}_{n}', source: '12.4' },
    create: () => ({
      ...common,
      kind: 'transformer',
      kva: null,
      primaryV: null,
      ukPct: null,
      urPct: null,
      vectorGroup: '',
    }),
  },
  {
    // The supply point fed through a ring main unit: same element as EB Utility (Section 3, L0).
    key: 'rmu',
    label: 'RMU',
    discipline: 'electrical',
    cmpCode: 'CMP-007',
    tag: proposal('RMU'),
    create: () => ({ ...common, description: 'RMU', kind: 'eb-utility' }),
  },
  {
    key: 'lv-panel',
    label: 'LV Panel',
    discipline: 'electrical',
    cmpCode: 'CMP-011',
    tag: proposal('LVP'),
    create: panel('lv-panel', 'ACB'),
  },
  {
    key: 'acb',
    label: 'ACB',
    discipline: 'electrical',
    cmpCode: 'CMP-012',
    tag: proposal('ACB'),
    create: panel('acb-panel', 'ACB'),
  },
  {
    key: 'mdb',
    label: 'MDB',
    discipline: 'electrical',
    cmpCode: 'CMP-011',
    tag: proposal('MDB'),
    create: panel('mdb', 'ACB'),
  },
  {
    key: 'smdb',
    label: 'SMDB',
    discipline: 'electrical',
    cmpCode: 'CMP-002',
    tag: proposal('SMDB'),
    create: panel('smdb', 'MCCB'),
  },
  {
    key: 'mcc',
    label: 'MCC',
    discipline: 'electrical',
    cmpCode: 'CMP-003',
    tag: proposal('MCC'),
    create: () => ({ ...common, ...board('MCCB'), kind: 'mcc', demandCategories: [] }),
  },
  {
    key: 'db',
    label: 'DB',
    discipline: 'electrical',
    cmpCode: 'CMP-001',
    tag: proposal('DB'),
    create: db(''),
  },
  // Feeder: drawn like a cable; cable or busbar chosen in the Engineering Property (1 Nov 2026).
  { key: 'cable', label: 'Feeder', discipline: 'electrical', tool: true },
  {
    // Lighting is a lighting distribution board in Phase 1 (decision 28 Oct 2026, A-11).
    key: 'lighting',
    label: 'Lighting',
    discipline: 'electrical',
    cmpCode: 'CMP-001',
    tag: proposal('LDB'),
    create: db('Lighting'),
  },
];

export const libraryItem = (key: string): LibraryItem | undefined =>
  LIBRARY_ITEMS.find((i) => i.key === key);

/** The next free tag for an item on a floor: Tx_GF_1, Tx_GF_2 … or DB-GF-01, DB-GF-02 … */
export function nextTag(rule: TagRule, floorCode: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const tag = rule.pattern
      .replace('{floor}', floorCode)
      .replace('{nn}', String(n).padStart(2, '0'))
      .replace('{n}', String(n));
    if (!used.has(tag.toLowerCase())) return tag;
  }
}

/** A new, valid element for a library item placed on a floor at a point (metres). */
export function placeElement(
  item: PlaceableItem,
  args: {
    id: string;
    floorId: string;
    floorCode: string;
    position: ModelPoint;
    taken: Iterable<string>;
  },
): Element {
  return ElementSchema.parse({
    ...item.create(),
    libraryKey: item.key,
    id: args.id,
    tag: nextTag(item.tag, args.floorCode, args.taken),
    floorId: args.floorId,
    position: args.position,
  });
}

export const isPlaceable = (item: LibraryItem): item is PlaceableItem => !item.tool;

/** The library item an element was placed from (by its libraryKey, or by its kind for older data). */
export function itemOfElement(e: Element): PlaceableItem | undefined {
  const placeable = LIBRARY_ITEMS.filter(isPlaceable);
  return (
    placeable.find((i) => i.key === e.libraryKey) ??
    placeable.find((i) => i.create().kind === e.kind)
  );
}
