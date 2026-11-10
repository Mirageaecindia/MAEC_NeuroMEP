import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import type { Element } from './elements.js';
import { pfcRating } from './pfc.js';
import { metersOn } from './schedule.js';

const tan = (pf: number) => Math.tan(Math.acos(pf));
const PFS = { defaultPf: 0.85, byType: { '1': 0.85, '2': 0.8, '4': 1 } as const };

/** TX > MDB > two DBs (office, residential) and a PFC bank fed from the MDB. */
function building() {
  const p = completeProject();
  p.calculation.demandMethod = 'dubai-non-emaar';
  p.calculation.demandFactors.byCategory.office = { value: 0.8, source: 'rulepack' };
  p.calculation.demandFactors.byCategory.residential = { value: 0.65, source: 'rulepack' };
  const tx = testElement('transformer', 'tx');
  const mdb = testElement('mdb', 'mdb');
  const office = {
    ...sampleDb('gf', 'db-o'),
    powerFactor: null,
    demandCategory: 'office',
    loads: [
      { method: 'kw', loadType: '1', kwL1: 10, kwL2: 10, kwL3: 10 }, // lighting pf 0.85
      { method: 'kw', loadType: '4', kwL1: 2, kwL2: 2, kwL3: 2 }, // heater pf 1.0
    ],
  } as Element;
  const flats = {
    ...sampleDb('gf', 'db-r'),
    powerFactor: 0.9, // the DB's own power factor applies to all its loads
    demandCategory: 'residential',
    loads: [{ method: 'kw', loadType: '2', kwL1: 20, kwL2: 20, kwL3: 20 }],
  } as Element;
  const pfc = testElement('pfc', 'pfc');
  p.model.elements = [tx, mdb, office, flats, pfc];
  p.model.cables = [
    testCable(tx, mdb),
    testCable(mdb, office),
    testCable(mdb, flats),
    testCable(mdb, pfc),
  ];
  return p;
}

describe('#TASK-28 PFC bank rating (10.15, components workbook, 10 Nov 2026)', () => {
  it('rates the bank per demand category of the panel feeding it, to the target power factor', () => {
    const r = pfcRating(building(), 'pfc', PFS, 0.95);
    expect(r.panelId).toBe('mdb');
    const office = r.rows.find((x) => x.category === 'office')!;
    const flats = r.rows.find((x) => x.category === 'residential')!;
    // Office: 30 kW lighting + 6 kW heater at the category factor 0.8.
    expect(office.demandKw).toBeCloseTo(36 * 0.8, 9);
    expect(office.kvar).toBeCloseTo(0.8 * (30 * (tan(0.85) - tan(0.95)) + 6 * (0 - tan(0.95))), 9);
    // Residential: 60 kW at the DB's own pf 0.9, factor 0.65.
    expect(flats.demandKw).toBeCloseTo(60 * 0.65, 9);
    expect(flats.kvar).toBeCloseTo(0.65 * 60 * (tan(0.9) - tan(0.95)), 9);
    expect(r.kvar).toBeCloseTo(office.kvar + flats.kvar, 9);
    expect(r.missingPf).toEqual([]);
  });

  it('is never below 0, and not calculated without a target or a load power factor', () => {
    const p = building();
    expect(pfcRating(p, 'pfc', PFS, 1).kvar).toBeGreaterThan(pfcRating(p, 'pfc', PFS, 0.95).kvar!);
    expect(pfcRating(p, 'pfc', PFS, 0.5).kvar).toBe(0);
    expect(pfcRating(p, 'pfc', PFS, null).kvar).toBeNull();
    const noPf = pfcRating(p, 'pfc', { defaultPf: null, byType: {} }, 0.95);
    expect(noPf.kvar).toBeNull();
    expect(noPf.missingPf).toEqual(['DB-db-o']);
  });

  it('has no rating while nothing feeds it', () => {
    const p = building();
    p.model.cables = p.model.cables.filter((c) => c.to.elementId !== 'pfc');
    expect(pfcRating(p, 'pfc', PFS, 0.95)).toMatchObject({ panelId: null, kvar: null });
  });
});

describe('meters (user request 10 Nov 2026)', () => {
  it('counts the typed meters linked to a component, by type', () => {
    const m = (id: string, meterType: string | null, meteredId: string | null) =>
      ({ ...testElement('meter', id), meterType, meteredId }) as Element;
    const els = [
      m('m1', '1-Ph', 'db'),
      m('m2', '1-Ph', 'db'),
      m('m3', '3-Ph', 'db'),
      m('m4', 'LV/HV', 'other'),
      m('m5', null, 'db'),
    ];
    expect(metersOn(els, 'db')).toEqual({ ph1: 2, ph3: 1, lvhv: 0 });
    expect(metersOn(els, 'nothing')).toBeNull();
    expect(metersOn(els, null)).toBeNull();
  });
});
