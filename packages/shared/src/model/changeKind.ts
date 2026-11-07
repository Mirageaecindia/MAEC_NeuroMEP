import type { Cable } from './cable.js';
import { ElementSchema, type Element, type ElementKind } from './elements.js';
import { isPlaceable, LIBRARY_ITEMS } from './library.js';

/**
 * Change type (manager feedback, 7 Nov 2026): e.g. an EMDB becomes an ESMDB without deleting its
 * feeders. The component keeps its id, position, feeders, risers, loads and every property the
 * new type also has; the rest start as a new component of that type. Connections are not checked
 * (A-20). Cable Size results become Out of date as for any change.
 */

/** Types a component can be changed to (electrical, drawn on the plan). */
export const CHANGEABLE_KINDS: readonly ElementKind[] = [
  'eb-utility',
  'transformer',
  'generator',
  'ups',
  'ats',
  'lv-panel',
  'acb-panel',
  'mdb',
  'emdb',
  'smdb',
  'esmdb',
  'mcc',
  'emcc',
  'db',
  'isolator',
  'connection-unit',
];

/** Kinds without a library item of their own take the item of their normal counterpart. */
const ITEM_OF: Partial<Record<ElementKind, string>> = {
  emdb: 'mdb',
  esmdb: 'smdb',
  emcc: 'mcc',
  'acb-panel': 'acb',
  isolator: 'isolator-tp',
};

/** Tag prefixes per kind (12.4 patterns and the proposals of the library). */
const PREFIX: Partial<Record<ElementKind, string>> = {
  'eb-utility': 'EB',
  transformer: 'Tx',
  generator: 'Gen',
  ups: 'UPS',
  ats: 'ATS',
  'lv-panel': 'LVP',
  'acb-panel': 'ACB',
  mdb: 'MDB',
  emdb: 'EMDB',
  smdb: 'SMDB',
  esmdb: 'ESMDB',
  mcc: 'MCC',
  emcc: 'EMCC',
  db: 'DB',
  isolator: 'ISO',
  'connection-unit': 'FCU',
};

function itemFor(kind: ElementKind) {
  const key = ITEM_OF[kind];
  return LIBRARY_ITEMS.filter(isPlaceable).find((i) =>
    key ? i.key === key : i.create().kind === kind,
  );
}

/** The tag with the old type's prefix swapped for the new one (MDB-GF-01 -> SMDB-GF-01). */
function swapPrefix(tag: string, from: ElementKind, to: ElementKind, taken: Set<string>) {
  const a = PREFIX[from];
  const b = PREFIX[to];
  if (!a || !b) return tag;
  const sep = tag.charAt(a.length);
  if (tag.slice(0, a.length).toLowerCase() !== a.toLowerCase() || (sep !== '-' && sep !== '_')) {
    return tag;
  }
  const next = `${b}${tag.slice(a.length)}`;
  return taken.has(next.toLowerCase()) ? tag : next;
}

/** The component as the new type, or null when it cannot be one. */
export function changeKind(
  e: Element,
  kind: ElementKind,
  takenTags: Iterable<string> = [],
): Element | null {
  if (e.kind === kind) return e;
  const item = itemFor(kind);
  if (!item || !CHANGEABLE_KINDS.includes(kind)) return null;
  const template = { ...item.create(), kind } as Record<string, unknown>;
  const taken = new Set([...takenTags].map((t) => t.toLowerCase()));
  const keep = {
    id: e.id,
    version: e.version + 1,
    tag: swapPrefix(e.tag, e.kind, kind, taken),
    floorId: e.floorId,
    position: e.position,
    description: e.description,
    location: e.location,
    ipRating: e.ipRating,
    fireRated: e.fireRated,
    ...(e.symbolScale !== undefined && { symbolScale: e.symbolScale }),
    ...(e.rotationDeg !== undefined && { rotationDeg: e.rotationDeg }),
    libraryKey: item.key,
  };
  let candidate: Record<string, unknown> = { ...template, ...keep };
  if (!ElementSchema.safeParse(candidate).success) return null;
  // Every other property the new type also has, when its value fits there.
  for (const [k, v] of Object.entries(e)) {
    if (!(k in template) || k in keep || k === 'kind') continue;
    const next = { ...candidate, [k]: v };
    if (ElementSchema.safeParse(next).success) candidate = next;
  }
  return ElementSchema.parse(candidate);
}

/** Feeder ends after a change of type: an ATS has a normal and a standby input, others 'in'. */
export function portsAfterKindChange(cables: readonly Cable[], id: string, kind: ElementKind) {
  let n = 0;
  return cables.map((c) => {
    if (c.to.elementId !== id) return c;
    const port: Cable['to']['port'] = kind === 'ats' ? (n++ === 0 ? 'normal' : 'standby') : 'in';
    return port === c.to.port ? c : { ...c, to: { ...c.to, port }, version: c.version + 1 };
  });
}
