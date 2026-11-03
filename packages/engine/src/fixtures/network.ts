import type { Cable, Element, Project } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';

/**
 * Test buildings for the engine (WBS 1.6.7): a small builder for radial networks with real
 * engineering inputs, used by the worked-example, invariant and random-network tests.
 */

export const TRAY: Cable['construction'] = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'J',
  trays: 1,
  depthM: null,
  separation: 'D',
  groupedCircuits: 6,
};

export interface Builder {
  project: Project;
  floor: string;
  /** Adds a component; `patch` sets its engineering fields. */
  add(key: string, id: string, patch?: Record<string, unknown>): Element;
  /** Adds a feeder of `lengthM` in total (route + 1 m vertical, no allowance). */
  feed(
    from: string,
    to: string,
    lengthM: number,
    c?: Partial<Cable['construction']>,
    port?: 'in' | 'normal' | 'standby',
  ): Cable;
  db(id: string, kw: [number, number, number], patch?: Record<string, unknown>): Element;
}

/** A complete project (Dubai pack, 350 MVA, 50 / 35 deg C, 2.0 K.m/W) with confirmed factors. */
export function building(): Builder {
  const project = completeProject();
  project.calculation.upstreamFaultMva = 350;
  project.calculation.defaultOverrides = { cableLengthAllowancePct: 0 };
  for (const code of Object.keys(project.calculation.demandFactors.byLoadType)) {
    project.calculation.demandFactors.byLoadType[code as '1'] = { value: 1, source: 'user' };
  }
  project.calculation.checks = {
    ...project.calculation.checks,
    shortCircuit: true,
    letThroughEnergy: false,
    earthFaultLoopImpedance: false,
  };
  const floor = project.building.floors[0]!.id;
  project.model.elements = [];
  project.model.cables = [];
  project.model.risers = [];
  const byId = (id: string) => project.model.elements.find((e) => e.id === id)!;
  const b: Builder = {
    project,
    floor,
    add(key, id, patch = {}) {
      // Kinds without a library item are built from a close one and renamed.
      const like: Record<string, string> = {
        motor: 'mdb',
        ups: 'mdb',
        esmdb: 'smdb',
        emdb: 'mdb',
        emcc: 'mcc',
      };
      const base = like[key]
        ? ({ ...testElement(like[key], id, floor), kind: key } as unknown as Element)
        : testElement(key, id, floor);
      const e = {
        ...base,
        tag: id.toUpperCase(),
        ...(key === 'motor'
          ? {
              poles: 'TP',
              loadCategory: 'normal',
              demandCategory: null,
              manualLoads: [],
              standbyKw: null,
              earthLeakage: 'none',
              efficiency: 0.9,
              starter: null,
            }
          : {}),
        ...(key === 'ups'
          ? { kvaOverride: 100, xdSubtransientPct: null, sustainedScKa: null }
          : {}),
        ...patch,
      } as Element;
      project.model.elements.push(e);
      return e;
    },
    feed(from, to, lengthM, c = {}, port = 'in') {
      const cable = testCable(byId(from), byId(to));
      const out: Cable = {
        ...cable,
        id: `c-${from}-${to}`,
        to: { elementId: to, port },
        construction: { ...TRAY, ...c },
        verticalM: 1,
        route: [
          { x: 0, y: 0 },
          { x: lengthM - 1, y: 0 },
        ],
      };
      project.model.cables.push(out);
      return out;
    },
    db(id, kw, patch = {}) {
      const e = {
        ...sampleDb(floor, id),
        tag: id.toUpperCase(),
        earthLeakage: 'none',
        powerFactor: 0.85,
        loads: [{ method: 'kw', loadType: '2', kwL1: kw[0], kwL2: kw[1], kwL3: kw[2] }],
        ...patch,
      } as Element;
      project.model.elements.push(e);
      return e;
    },
  };
  return b;
}

/** Seeded pseudo-random numbers (mulberry32), so a failing random network can be replayed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
  };
}

/**
 * A random radial building: transformer > MDB > 1-4 SMDBs > 1-5 DBs each, with random loads
 * (some unbalanced or single-phase), lengths and installation methods.
 */
export function randomBuilding(seed: number): Builder {
  const r = rng(seed);
  const b = building();
  const kva = r.pick([500, 630, 1000, 1500, 2000]);
  b.add('transformer', 'tx', { kva, ukPct: null, urPct: null });
  b.add('mdb', 'mdb');
  // The transformer cable is short and single-core on a tray, as in practice.
  b.feed('tx', 'mdb', r.between(5, 20), {
    cores: '1C',
    armour: 'AWA',
    groupedCircuits: 1,
    separation: 'touching',
  });
  const smdbs = 1 + Math.floor(r.next() * 4);
  for (let i = 0; i < smdbs; i++) {
    const sm = `sm${i}`;
    b.add('smdb', sm);
    b.feed('mdb', sm, r.between(10, 80), installation(r));
    const dbs = 1 + Math.floor(r.next() * 5);
    for (let j = 0; j < dbs; j++) {
      const id = `db${i}_${j}`;
      const kind = r.next();
      const kw = r.between(2, 60);
      const load: [number, number, number] =
        kind < 0.15
          ? [Math.min(kw, 12), 0, 0]
          : kind < 0.4
            ? [kw / 2, kw / 3, kw / 6]
            : [kw / 3, kw / 3, kw / 3];
      b.db(id, load, { powerFactor: r.pick([0.8, 0.85, 0.9, 0.95]) });
      b.feed(sm, id, r.between(5, 90), installation(r));
    }
  }
  return b;
}

function installation(r: ReturnType<typeof rng>): Partial<Cable['construction']> {
  const method = r.pick(['J', 'J', 'B', 'D-direct'] as const);
  const insulation = r.pick(['XLPE', 'XLPE', 'PVC'] as const);
  if (method === 'J')
    return {
      method,
      insulation,
      trays: r.pick([1, 2, 3]),
      separation: r.pick(['touching', 'D', '2D']),
      groupedCircuits: r.pick([1, 2, 3, 4, 6]),
    };
  if (method === 'B')
    return {
      method,
      insulation,
      trays: null,
      separation: null,
      groupedCircuits: r.pick([1, 2, 3, 4, 6]),
    };
  return {
    method,
    insulation,
    trays: null,
    separation: 'touching',
    groupedCircuits: r.pick([1, 2, 3, 4]),
    depthM: r.pick([0.6, 0.8, 1]),
  };
}
