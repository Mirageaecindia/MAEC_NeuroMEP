import { describe, expect, it } from 'vitest';
import { FIXED_NOW, sequentialIds } from '../testing.js';
import { createEmptyProject } from './factory.js';
import {
  applyRegistryChange,
  computeLevels,
  floorSlots,
  floorTags,
  generateRegistry,
  planStatus,
} from './floors.js';
import type { Floor, PdfPlan } from './schema.js';

const pdfPlan = (fileName: string): PdfPlan => ({
  kind: 'pdf',
  fileId: `file-${fileName}`,
  fileName,
  uploadedAt: FIXED_NOW,
  uploadedBy: 'u',
  page: { widthPt: 1000, heightPt: 700 },
  calibration: null,
});

describe('floor registry generation', () => {
  it('orders floors B{n}..B1, GF, P1..Pn, then typical floors 1..n', () => {
    const codes = floorSlots({ basements: 2, podiums: 3, typicals: 2 }).map((s) => s.code);
    expect(codes).toEqual(['B2', 'B1', 'GF', 'P1', 'P2', 'P3', '1', '2']);
  });

  it('always has exactly one ground floor, even with no other floors', () => {
    const { floors } = generateRegistry(
      { basements: 0, podiums: 0, typicals: 0 },
      [],
      sequentialIds(),
    );
    expect(floors.map((f) => [f.code, f.type, f.name])).toEqual([['GF', 'ground', 'Ground Floor']]);
  });

  it('gives each floor a type and a default name', () => {
    const { floors } = generateRegistry(
      { basements: 1, podiums: 1, typicals: 1 },
      [],
      sequentialIds(),
    );
    expect(floors.map((f) => `${f.code}|${f.type}|${f.name}`)).toEqual([
      'B1|basement|Basement 1',
      'GF|ground|Ground Floor',
      'P1|podium|Podium 1',
      '1|typical|Typical Floor 1',
    ]);
  });

  it('rejects negative or fractional counts', () => {
    const ids = sequentialIds();
    expect(() => generateRegistry({ basements: -1, podiums: 0, typicals: 0 }, [], ids)).toThrow();
    expect(() => generateRegistry({ basements: 0, podiums: 1.5, typicals: 0 }, [], ids)).toThrow();
  });

  it('keeps existing floors (id, name, height, plan) when regenerating', () => {
    const counts = { basements: 1, podiums: 0, typicals: 2 };
    const first = generateRegistry(counts, [], sequentialIds('a')).floors;
    const edited: Floor[] = first.map((f) =>
      f.code === '1' ? { ...f, name: 'Office L1', heightM: 3.6, plan: pdfPlan('L1.pdf') } : f,
    );
    const { floors, removed } = generateRegistry(
      { ...counts, typicals: 3 },
      edited,
      sequentialIds('b'),
    );
    expect(floors.find((f) => f.code === '1')).toEqual(edited.find((f) => f.code === '1'));
    expect(floors.map((f) => f.id)).toEqual(['a-1', 'a-2', 'a-3', 'a-4', 'b-1']);
    expect(removed).toEqual([]);
  });

  it('lists removed floors, and separately those that already have a plan', () => {
    const first = generateRegistry({ basements: 2, podiums: 0, typicals: 0 }, [], sequentialIds());
    const withPlan = first.floors.map((f) =>
      f.code === 'B2' ? { ...f, plan: pdfPlan('B2.pdf') } : f,
    );
    const change = generateRegistry(
      { basements: 0, podiums: 0, typicals: 0 },
      withPlan,
      sequentialIds(),
    );
    expect(change.removed.map((f) => f.code)).toEqual(['B2', 'B1']);
    expect(change.removedWithPlans.map((f) => f.code)).toEqual(['B2']);
  });
});

describe('mechanical floor tagging', () => {
  it('tags the chosen rows and clears references to removed floors', () => {
    const p = createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });
    const counts = { basements: 0, podiums: 0, typicals: 3 };
    let building = applyRegistryChange(
      p.building,
      counts,
      generateRegistry(counts, [], sequentialIds()),
    );
    const top = building.floors.at(-1)!;
    const gf = building.floors[0]!;
    building = { ...building, mechanicalFloorIds: [top.id, null, gf.id] };
    expect(floorTags(building).get(top.id)).toEqual(['MF1']);
    expect(floorTags(building).get(gf.id)).toEqual(['MF3']);

    const smaller = { basements: 0, podiums: 0, typicals: 1 };
    const change = generateRegistry(smaller, building.floors, sequentialIds('n'));
    building = applyRegistryChange(building, smaller, change);
    expect(building.mechanicalFloorIds).toEqual([null, null, gf.id]);
    expect(building.counts).toEqual(smaller);
  });
});

describe('cumulative floor levels', () => {
  const registry = (heights: Record<string, number | null>) =>
    generateRegistry({ basements: 2, podiums: 1, typicals: 2 }, [], sequentialIds()).floors.map(
      (f) => ({ ...f, heightM: heights[f.code] ?? null }),
    );
  const byCode = (floors: Floor[], levels: Map<string, number | null>) =>
    Object.fromEntries(floors.map((f) => [f.code, levels.get(f.id)]));

  it('adds heights upwards from GF and subtracts basement heights downwards', () => {
    const floors = registry({ B2: 3.5, B1: 4, GF: 5, P1: 4.5, '1': 3.2, '2': 3.2 });
    expect(byCode(floors, computeLevels(floors, 0))).toEqual({
      B2: -7.5,
      B1: -4,
      GF: 0,
      P1: 5,
      '1': 9.5,
      '2': 12.7,
    });
  });

  it('uses the GF level as the datum', () => {
    const floors = registry({ B2: 3, B1: 3, GF: 4, P1: 4, '1': 3, '2': 3 });
    const levels = byCode(floors, computeLevels(floors, 1.25));
    expect(levels.GF).toBe(1.25);
    expect(levels.B1).toBe(-1.75);
    expect(levels['1']).toBe(9.25);
  });

  it('leaves levels empty beyond a missing height', () => {
    const floors = registry({ B2: 3, B1: null, GF: 4, P1: null, '1': 3, '2': 3 });
    expect(byCode(floors, computeLevels(floors, 0))).toEqual({
      B2: null,
      B1: null,
      GF: 0,
      P1: 4,
      '1': null,
      '2': null,
    });
  });
});

describe('plan status', () => {
  it('moves No plan -> Uncalibrated -> Calibrated', () => {
    expect(planStatus({ plan: null })).toBe('No plan');
    const plan = pdfPlan('a.pdf');
    expect(planStatus({ plan })).toBe('Uncalibrated');
    const calibration = {
      method: 'drawing-scale' as const,
      scaleDenominator: 100,
      sheetSize: 'A1' as const,
      metresPerUnit: 0.035,
      calibratedAt: FIXED_NOW,
      calibratedBy: 'u',
    };
    expect(planStatus({ plan: { ...plan, calibration } })).toBe('Calibrated');
  });
});
