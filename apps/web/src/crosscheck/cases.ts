import { applyRulePackDefaults, rulePackForRegion } from '@neuromep/rulepacks';
import {
  createEmptyProject,
  drawCable,
  ElementSchema,
  generateRegistry,
  isPlaceable,
  libraryItem,
  placeElement,
  type Cable,
  type CableConstruction,
  type Element,
  type Project,
} from '@neuromep/shared';

/**
 * WBS 1.7.5 #TASK-26 - engineer cross-check pack: four small buildings that the Senior Electrical
 * Engineer recalculates by hand. Each is built through the same library items, cable drawing and
 * rule-pack defaults as the app, so the project files open on the server like any project.
 * Every number typed here is a test input chosen to exercise a calculation path - not a design
 * value and not an answer to an open item.
 */

export interface CrossCheckCase {
  /** CC-01 ... */
  id: string;
  title: string;
  /** What the case exercises, for the engineer's sheet. */
  covers: string[];
  /**
   * Feeders the engineer recalculates in full, as "FROM > TO" component tags or "Riser n"; the
   * others are optional.
   */
  featured: string[];
  project: Project;
}

const pack = rulePackForRegion('dubai')!;
const NOW = '2026-11-06T08:00:00.000Z';

// ----- cable constructions (chosen while drawing, D-05) ------------------------------------------

const TRAY: CableConstruction = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'J',
  trays: 1,
  depthM: null,
  separation: 'touching',
  groupedCircuits: 3,
};
const SINGLE_CORE: CableConstruction = {
  ...TRAY,
  cores: '1C',
  armour: 'AWA',
  groupedCircuits: 1,
};
/** Fire-rated (FP600-type, XLPE values on trays): generator-side FLS feeders. */
const FIRE: CableConstruction = { ...TRAY, insulation: 'FR', armour: 'none', sheath: 'LSZH' };
const BURIED: CableConstruction = {
  ...TRAY,
  method: 'D-direct',
  trays: null,
  depthM: 0.8,
  separation: 'touching',
  groupedCircuits: 2,
};
const DUCT: CableConstruction = {
  ...TRAY,
  insulation: 'PVC',
  method: 'D-duct',
  trays: null,
  depthM: 0.8,
  separation: '0.45',
  groupedCircuits: 2,
};
const CONDUIT: CableConstruction = {
  ...TRAY,
  insulation: 'PVC',
  armour: 'none',
  voltageGrade: '450/750 V',
  method: 'B',
  trays: null,
  separation: null,
  groupedCircuits: 2,
};
const C = { TRAY, SINGLE_CORE, FIRE, BURIED, DUCT, CONDUIT };

// ----- builder -----------------------------------------------------------------------------------

interface Builder {
  project: Project;
  /** Places a library item on a floor (by code), with its tag and engineering fields. */
  place(key: string, floor: string, tag: string, patch?: Record<string, unknown>): Element;
  /** Draws a feeder of `routedM` metres on the plan (the rule pack adds 5 m, A-05). */
  feed(
    fromTag: string,
    toTag: string,
    routedM: number,
    construction: CableConstruction,
    port?: 'in' | 'normal' | 'standby',
  ): Cable;
  /** A Building-tab riser: source, length, boards fed from its tap-offs. */
  riser(fromTag: string, lengthM: number, feeds: string[]): void;
}

function builder(args: {
  name: string;
  category: NonNullable<Project['details']['category']>;
  plotKva: number;
  floors: { basements: number; typicals: number };
  demandMethod: Project['calculation']['demandMethod'];
  busbarMaker: Project['calculation']['busbarMaker'];
}): Builder {
  let project = createEmptyProject({ id: 'cross-check', userId: 'u-lead', now: NOW });
  project.details = {
    name: args.name,
    location: 'Dubai',
    clientName: 'MAEC - engineer cross-check (test data)',
    plotRef: 'WBS 1.7.5',
    designStage: 'SD',
    revision: 'A',
    category: args.category,
    plotLoad: { value: args.plotKva, unit: 'kVA' },
  };
  project.calculation.region = 'dubai';
  project.calculation.upstreamFaultMva = 350;
  project.calculation.demandMethod = args.demandMethod;
  project.calculation.busbarMaker = args.busbarMaker;
  const counts = { basements: args.floors.basements, podiums: 0, typicals: args.floors.typicals };
  project.building.counts = counts;
  let n = 0;
  project.building.floors = generateRegistry(counts, [], () => `f${++n}`).floors;
  project = applyRulePackDefaults(project, pack);
  // Every check ticked on Page 1, so the engineer sees each one worked out (C4 / C5 end in
  // "Device data required" until the breaker catalogue, OI-03).
  project.calculation.checks = {
    currentCarryingCapacity: true,
    voltageDrop: true,
    shortCircuit: true,
    letThroughEnergy: true,
    earthFaultLoopImpedance: true,
  };
  const p = project;
  const floorOf = (code: string) => {
    const f = p.building.floors.find((x) => x.code === code);
    if (!f) throw new Error(`No floor ${code}`);
    return f.id;
  };
  const byTag = (tag: string) => {
    const e = p.model.elements.find((x) => x.tag === tag);
    if (!e) throw new Error(`No component ${tag}`);
    return e;
  };
  // Components laid out left to right per floor, 6 m apart (drawing only).
  const column = new Map<string, number>();
  return {
    project: p,
    place(key, floor, tag, patch = {}) {
      const item = libraryItem(key);
      if (!item || !isPlaceable(item)) throw new Error(`Not a library item: ${key}`);
      const x = (column.get(floor) ?? 0) + 1;
      column.set(floor, x);
      const placed = placeElement(item, {
        id: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        floorId: floorOf(floor),
        floorCode: floor,
        position: { x: 6 * x, y: 10 },
        taken: p.model.elements.map((e) => e.tag),
      });
      const e = ElementSchema.parse({ ...placed, tag, ...patch });
      p.model.elements.push(e);
      return e;
    },
    feed(fromTag, toTag, routedM, construction, port = 'in') {
      const from = byTag(fromTag);
      const to = byTag(toTag);
      const floorCode = p.building.floors.find((f) => f.id === from.floorId)!.code;
      const cable = drawCable({
        id: `c-${from.id}-${to.id}`,
        cables: p.model.cables,
        from: { element: from, port: 'out' },
        to: { element: to, port },
        route: [
          { x: from.position.x, y: 12 },
          { x: from.position.x + routedM, y: 12 },
        ],
        floorCode,
        construction,
      });
      p.model.cables.push(cable);
      return cable;
    },
    riser(fromTag, lengthM, feeds) {
      p.model.risers.push({
        id: `riser-${p.model.risers.length + 1}`,
        lengthM,
        widthM: 1,
        fedFromId: byTag(fromTag).id,
        feeds: feeds.map((t) => byTag(t).id),
      });
    },
  };
}

/** A DB's load: one line per load type, kW on L1 / L2 / L3. */
const kw = (loadType: string, l1: number, l2: number, l3: number) => ({
  method: 'kw' as const,
  loadType,
  kwL1: l1,
  kwL2: l2,
  kwL3: l3,
});
const db = (
  category: string,
  loads: ReturnType<typeof kw>[],
  patch: Record<string, unknown> = {},
) => ({
  demandCategory: category,
  loads,
  earthLeakage: 'none',
  ...patch,
});

// ----- the four buildings ------------------------------------------------------------------------

/** CC-01: office tower, Dubai non-Emaar demand, busbar riser with tap-offs, trays. */
function office(): CrossCheckCase {
  const b = builder({
    name: 'CC-01 Office tower',
    category: 'OFFICE',
    plotKva: 1000,
    floors: { basements: 0, typicals: 3 },
    demandMethod: 'dubai-non-emaar',
    busbarMaker: 'gersan',
  });
  b.place('transformer', 'GF', 'TX-1', { kva: 1000, primaryV: 11000 });
  b.place('lv-panel', 'GF', 'LV-1', { demandCategories: ['office'] });
  b.feed('TX-1', 'LV-1', 10, C.SINGLE_CORE);
  for (const f of ['1', '2', '3']) {
    b.place('smdb', f, `SMDB-${f}F`, { demandCategories: ['office'] });
    b.place('db', f, `DB-${f}F-P`, db('office', [kw('2', 8, 8, 8)], { powerFactor: 0.85 }));
    b.place('db', f, `DB-${f}F-L`, db('office', [kw('1', 2, 2, 2)]));
    b.feed(`SMDB-${f}F`, `DB-${f}F-P`, 30, C.TRAY);
    b.feed(`SMDB-${f}F`, `DB-${f}F-L`, 25, C.TRAY);
  }
  b.riser('LV-1', 30, ['SMDB-1F', 'SMDB-2F', 'SMDB-3F']);
  return {
    id: 'CC-01',
    title: 'Office tower - riser with tap-offs',
    covers: [
      '1000 kVA transformer, uk / ur from the manufacturer catalogue (11 kV primary)',
      'Dubai non-Emaar demand: office 0.8 applied once at LV-1',
      'Gersan busbar riser, 30 m, three tap-offs (k = (n + 1) / 2n), tap-off breakers',
      'Single-core transformer feeder; 4C Cu/XLPE/SWA on a tray, 3 circuits grouped',
      'Lighting load at the Lighting power factor (0.85), small power at the DB power factor',
      'Short circuit at LV-1 and through the riser (max / min), ECC, DEWA minimum',
    ],
    featured: ['TX-1 > LV-1', 'SMDB-1F > DB-1F-P', 'Riser 1'],
    project: b.project,
  };
}

/** CC-02: standby generator through an ATS, FLS fire pump and emergency lighting. */
function standby(): CrossCheckCase {
  const b = builder({
    name: 'CC-02 Residential with standby',
    category: 'RESIDENTIAL',
    plotKva: 1500,
    floors: { basements: 0, typicals: 2 },
    demandMethod: 'dubai-non-emaar',
    busbarMaker: 'schneider',
  });
  b.place('transformer', 'GF', 'TX-1', { kva: 1500, primaryV: 11000 });
  b.place('mdb', 'GF', 'MDB-1', { demandCategories: ['residential', 'landlord'] });
  b.place('generator', 'GF', 'G-1', { kvaOverride: 500, xdSubtransientPct: 14 });
  b.place('ats', 'GF', 'ATS-1');
  b.place('smdb', 'GF', 'ESMDB-1', { loadCategory: 'fls', demandCategories: ['landlord'] });
  b.place('isolator-tp', 'GF', 'ISO-FP', {
    loadCategory: 'fls',
    fireRated: true,
    starter: 'star-delta',
    efficiency: 0.92,
    manualLoads: [kw('9', 10, 10, 10)],
  });
  b.place(
    'db',
    'GF',
    'DB-EL',
    db('landlord', [kw('1', 3, 3, 3)], { loadCategory: 'fls', fireRated: true }),
  );
  b.place(
    'db',
    'GF',
    'DB-LL',
    db('landlord', [kw('2', 5, 5, 5)], { loadCategory: 'essential', powerFactor: 0.85 }),
  );
  b.feed('TX-1', 'MDB-1', 12, C.SINGLE_CORE);
  b.feed('MDB-1', 'ATS-1', 15, C.TRAY, 'normal');
  b.feed('G-1', 'ATS-1', 40, C.FIRE, 'standby');
  b.feed('ATS-1', 'ESMDB-1', 8, C.FIRE);
  b.feed('ESMDB-1', 'ISO-FP', 20, C.FIRE);
  b.feed('ESMDB-1', 'DB-EL', 25, C.FIRE);
  b.feed('ESMDB-1', 'DB-LL', 20, C.TRAY);
  for (const f of ['1', '2']) {
    b.place(
      'db',
      f,
      `DB-${f}F`,
      db('residential', [kw('2', 7, 7, 7), kw('3', 4, 4, 4)], { powerFactor: 0.9 }),
    );
  }
  b.riser('MDB-1', 20, ['DB-1F', 'DB-2F']);
  return {
    id: 'CC-02',
    title: 'Standby generator, ATS and fire-life-safety loads',
    covers: [
      'Generator 500 kVA, X"d 14 % (test input), through ATS-1: normal and standby supply',
      'Fire pump on a 3-pole isolator: 30 kW Fire Pumps, star-delta, efficiency 0.92 (Ib with efficiency)',
      'Fire-rated cable on the generator side (FR on a tray uses the XLPE values); C8 / C9',
      'Short circuit from the transformer (max) and from the generator alone (min on the standby side)',
      'Residential + landlord categories at MDB-1 (non-Emaar 0.65 / 0.8); AC power factor 0.8',
      'Schneider riser, two tap-offs; Generator Load Analysis report',
    ],
    featured: ['G-1 > ATS-1', 'ESMDB-1 > ISO-FP'],
    project: b.project,
  };
}

/** CC-03: retail with pumps, buried and ducted cables, Emaar demand. */
function retail(): CrossCheckCase {
  const b = builder({
    name: 'CC-03 Retail with pumps',
    category: 'MALL',
    plotKva: 1600,
    floors: { basements: 1, typicals: 1 },
    demandMethod: 'dubai-emaar',
    busbarMaker: 'powerbar',
  });
  b.place('transformer', 'GF', 'TX-1', { kva: 1600, primaryV: 11000 });
  b.place('lv-panel', 'GF', 'LV-1', { demandCategories: ['retail', 'landlord'] });
  b.place('mcc', 'B1', 'MCC-1', { demandCategories: ['landlord'] });
  b.place('isolator-tp', 'B1', 'ISO-P1', {
    starter: 'DOL',
    efficiency: 0.9,
    manualLoads: [kw('8', 11 / 3, 11 / 3, 11 / 3)],
  });
  b.place('isolator-tp', 'B1', 'ISO-P2', {
    starter: 'star-delta',
    efficiency: 0.91,
    manualLoads: [kw('8', 5, 5, 5)],
  });
  b.place('smdb', 'GF', 'SMDB-R', { demandCategories: ['retail'] });
  b.place(
    'db',
    'GF',
    'DB-R1',
    db('retail', [kw('2', 10, 10, 10), kw('1', 4, 3, 3)], { powerFactor: 0.85 }),
  );
  b.place('db', 'GF', 'DB-R2', db('retail', [kw('2', 10, 8, 7)], { powerFactor: 0.85 }));
  b.place('db', '1', 'DB-1F', db('retail', [kw('3', 10, 10, 10)]));
  b.feed('TX-1', 'LV-1', 10, C.SINGLE_CORE);
  b.feed('LV-1', 'MCC-1', 35, C.BURIED);
  b.feed('MCC-1', 'ISO-P1', 15, C.CONDUIT);
  b.feed('MCC-1', 'ISO-P2', 20, C.CONDUIT);
  b.feed('LV-1', 'SMDB-R', 50, C.DUCT);
  b.feed('SMDB-R', 'DB-R1', 30, C.TRAY);
  b.feed('SMDB-R', 'DB-R2', 35, C.TRAY);
  b.riser('LV-1', 25, ['DB-1F']);
  return {
    id: 'CC-03',
    title: 'Retail with pumps - buried, ducted and conduit cables',
    covers: [
      '1600 kVA transformer; Dubai Emaar demand: retail 0.8 / landlord 0.75 at LV-1, SMDB x 0.8',
      'Buried direct XLPE cable at 0.8 m (ground 40 deg C, soil 2.0 K.m/W): K1 / Kr / K3 factors',
      'PVC cable in a duct at 0.8 m, 0.45 m apart; PVC cable in conduit (method B)',
      'Pumps on isolators: DOL 11 kW at 0.9, star-delta 15 kW at 0.91 (Pumps power factor)',
      'Unbalanced DB (10 / 8 / 7 kW): Ib from the largest phase',
      'Powerbar riser with one tap-off',
    ],
    featured: ['LV-1 > MCC-1', 'LV-1 > SMDB-R'],
    project: b.project,
  };
}

/** CC-04: car park and plant - long runs where voltage drop sets the size, parallel runs, 230 V. */
function longRuns(): CrossCheckCase {
  const b = builder({
    name: 'CC-04 Car park and plant',
    category: 'MIXED_USE',
    plotKva: 1000,
    floors: { basements: 1, typicals: 4 },
    demandMethod: 'manual',
    busbarMaker: 'gersan',
  });
  // Manual method (A-15): load-type factors typed on Page 1 - test inputs for this case only.
  const dfs = b.project.calculation.demandFactors;
  const factors: Record<string, number> = { '1': 0.9, '2': 0.6, '3': 0.8 };
  for (const code of Object.keys(dfs.byLoadType) as (keyof typeof dfs.byLoadType)[]) {
    dfs.byLoadType[code] = { value: factors[code] ?? 1, source: 'user' };
  }
  for (const cat of Object.keys(dfs.byCategory) as (keyof typeof dfs.byCategory)[]) {
    dfs.byCategory[cat] = { value: 1, source: 'user' };
  }
  dfs.secondLevel = { value: 1, source: 'user' };
  b.place('transformer', 'B1', 'TX-1', { kva: 1000, primaryV: 11000 });
  b.place('mdb', 'B1', 'MDB-1', { demandCategories: ['landlord'] });
  b.place('smdb', 'B1', 'SMDB-CP', { demandCategories: ['landlord'] });
  b.place('db', 'B1', 'DB-CP1', db('landlord', [kw('1', 3, 3, 3)]));
  b.place(
    'db',
    'B1',
    'DB-CP2',
    db('landlord', [kw('2', 6, 0, 0)], { poles: 'SPN', powerFactor: 0.9 }),
  );
  b.place('smdb', 'B1', 'SMDB-CH', { demandCategories: ['landlord'] });
  b.feed('TX-1', 'MDB-1', 15, C.SINGLE_CORE);
  b.feed('MDB-1', 'SMDB-CP', 120, C.TRAY);
  b.feed('SMDB-CP', 'DB-CP1', 90, C.TRAY);
  b.feed('SMDB-CP', 'DB-CP2', 150, { ...C.TRAY, cores: '3C' });
  b.feed('MDB-1', 'SMDB-CH', 160, { ...C.TRAY, groupedCircuits: 1 });
  b.place('db', 'B1', 'DB-CH', db('landlord', [kw('3', 100, 100, 100)], { powerFactor: 0.85 }));
  b.feed('SMDB-CH', 'DB-CH', 10, { ...C.TRAY, groupedCircuits: 1 });
  for (const f of ['1', '2', '3', '4']) {
    b.place('db', f, `DB-${f}F`, db('landlord', [kw('2', 5, 5, 5)], { powerFactor: 0.85 }));
  }
  b.riser('MDB-1', 40, ['DB-1F', 'DB-2F', 'DB-3F', 'DB-4F']);
  return {
    id: 'CC-04',
    title: 'Car park and plant - long runs, voltage drop and parallel runs',
    covers: [
      'Manual demand method: Lighting 0.9, Power 0.6, AC 0.8 (test inputs) once per board',
      '120 m and 90 m feeders where the cumulative voltage drop sets the size (C2)',
      'Single-phase DB on 230 V, 150 m: drop on the phase and neutral',
      '300 kW AC plant at 160 m: parallel runs (more runs when one cable is not enough)',
      'Gersan riser 40 m with four tap-offs',
    ],
    featured: ['SMDB-CP > DB-CP2', 'MDB-1 > SMDB-CH'],
    project: b.project,
  };
}

/** The pack, in order. */
export function crossCheckCases(): CrossCheckCase[] {
  return [office(), standby(), retail(), longRuns()];
}
