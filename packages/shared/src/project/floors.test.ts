import { describe, expect, it } from 'vitest';
import { FIXED_NOW, sequentialIds } from '../testing.js';
import { createEmptyProject } from './factory.js';
import {
  applyRegistryChange,
  floorSlots,
  floorTags,
  generateRegistry,
  planStatus,
  typicalSet,
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
      '1|typical|First Floor',
    ]);
  });

  it('names upper floors First Floor, Second Floor ... as in the Building tab (A-05)', () => {
    const { floors } = generateRegistry(
      { basements: 0, podiums: 0, typicals: 5 },
      [],
      sequentialIds(),
    );
    expect(floors.map((f) => f.name)).toEqual([
      'Ground Floor',
      'First Floor',
      'Second Floor',
      'Third Floor',
      'Fourth Floor',
      'Fifth Floor',
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
    expect(building.counts).toEqual({ ...smaller, grounds: 1 });
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

describe('ground levels, podiums and the typical set (12.1, user request 7 Nov 2026)', () => {
  it('builds Ground Floor 1 / 2 for two ground levels, then podiums and typical floors', () => {
    const slots = floorSlots({ basements: 1, grounds: 2, podiums: 1, typicals: 2 });
    expect(slots.map((s) => `${s.code}:${s.name}`)).toEqual([
      'B1:Basement 1',
      'GF:Ground Floor 1',
      'GF2:Ground Floor 2',
      'P1:Podium 1',
      '1:First Floor',
      '2:Second Floor',
    ]);
    expect(floorSlots({ basements: 0, podiums: 0, typicals: 0 })[0]!.name).toBe('Ground Floor');
  });

  it('the typical set leaves out the floors chosen as mechanical floors', () => {
    const floors = generateRegistry(
      { basements: 0, grounds: 1, podiums: 1, typicals: 4 },
      [],
      sequentialIds(),
    ).floors;
    const tenth = floors.find((f) => f.code === '2')!;
    const set = typicalSet({ floors, mechanicalFloorIds: [tenth.id, null, null] });
    expect(set.map((f) => f.code)).toEqual(['1', '3', '4']);
  });
});
