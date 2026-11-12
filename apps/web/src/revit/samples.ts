import type { CableConstruction } from '@neuromep/shared';
import { sampleBuilder, type PlanSheet, type Pt, type SampleBuilder } from './sampleBuilder';

/**
 * #TASK-33 Revit exchange samples (user request 12 Nov 2026), modelled on the two DCH-F14 sheets
 * in docs/Floor_plan_inputs:
 *   49-DCH-F14-MRG-DRW-PDM-L01-EEP-2006-A.pdf  1st floor (podium deck), ISO A1 at 1:200
 *   50-DCH-F14-MRG-DRW-TWR-L02-ELE-2102-A.pdf  2nd floor (typical tier 1 L03-L19), ISO A1 at
 *                                              1:100 printed reduced to a letter page
 * Components sit where the drawings show them (electrical room, the red DB symbols, cable trays);
 * tags are the drawings' own. Loads, kVA and lengths are SAMPLE DATA, not design values.
 *
 * Both sheets are rotated 90 deg (/Rotate 90): positions below are read off the sheet as it is
 * shown (pt, origin top-left of the shown sheet, y down) and `shown` turns them into PDF user
 * space as the app stores them (origin bottom-left of the unrotated page, y up) - for these two
 * pages that is a swap of x and y (checked with PyMuPDF's page matrices and placement_check.py).
 */

const shown = (x: number, y: number): Pt => [y, x];

// ----- cable constructions (chosen while drawing, D-05) -----------------------------------------

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
/** Apartment feeders share the corridor trays. */
const CORRIDOR: CableConstruction = { ...TRAY, groupedCircuits: 6 };
const SINGLE_CORE: CableConstruction = { ...TRAY, cores: '1C', armour: 'AWA', groupedCircuits: 1 };
/** Fire-rated feeder to the emergency lighting panel (FLS, generator side). */
const FIRE: CableConstruction = { ...TRAY, insulation: 'FR', armour: 'none', sheath: 'LSZH' };

const kw = (loadType: string, l1: number, l2 = l1, l3 = l1) => ({
  method: 'kw' as const,
  loadType,
  kwL1: l1,
  kwL2: l2,
  kwL3: l3,
});

// ----- the sheets ---------------------------------------------------------------------------------

/**
 * 1 pt = 1/72 in = 0.35278 mm on paper. Sheet 49 is a true A1 at 1:200: 0.070556 m per pt.
 * Sheet 50 is an A1 at 1:100 (title block) fitted to 792 pt instead of 841 mm: 1 pt = 841 / 792
 * mm of the A1 = 0.106187 m on site (its T1-T2 grid then measures 7.6 m). Calibrated over
 * 1000 pt; the engineer should confirm with a dimension on the drawing.
 */
const SHEET_49: PlanSheet = {
  fileName: '49-DCH-F14-MRG-DRW-PDM-L01-EEP-2006-A.pdf',
  widthPt: 1684,
  heightPt: 2384,
  rotationDeg: 90,
  calibration: { a: [0, 0], b: [1000, 0], metres: 70.556 },
  // Grid crossings read from the grid bubbles; the Revit team fills in their Revit coordinates.
  alignment: [
    { name: 'Grid P1 / PA', pdf: { x: 281.1, y: 397.8 }, revit: null },
    { name: 'Grid P12 / PM', pdf: { x: 1384.6, y: 1632.3 }, revit: null },
  ],
};
const SHEET_50: PlanSheet = {
  fileName: '50-DCH-F14-MRG-DRW-TWR-L02-ELE-2102-A.pdf',
  widthPt: 612,
  heightPt: 792,
  rotationDeg: 90,
  calibration: { a: [0, 0], b: [1000, 0], metres: 106.187 },
  alignment: [
    { name: 'Grid T1 / TA', pdf: { x: 219.6, y: 149.8 }, revit: null },
    { name: 'Grid T6 / TG', pdf: { x: 473.1, y: 514.5 }, revit: null },
  ],
};

const FLOORS = { basements: 0, grounds: 1, podiums: 1, typicals: 1 };
const NAMES = { P1: 'Level 01 (Podium deck)', '1': 'Level 02 (Typical tier 1)' };

/** The supply on the Ground Floor (no plan shared: positions in metres). */
function groundSupply(b: SampleBuilder, category: string) {
  b.place('transformer', 'GF', 'TX-GF-01', [10, 10], { kva: 1500, primaryV: 11000 });
  b.place('lv-panel', 'GF', 'LV-GF-01', [16, 10], { demandCategories: [category] });
  b.place('pfc', 'GF', 'PFC-GF-01', [16, 14]);
  b.feed('TX-GF-01', 'LV-GF-01', [], SINGLE_CORE);
  b.feed('LV-GF-01', 'PFC-GF-01', [], TRAY);
}

/** Sample 1: Level 01 podium deck - landlord, essential and emergency lighting boards. */
export function podiumSample() {
  const b = sampleBuilder({
    id: 'revit-sample-L01',
    name: 'DCH-F14 L01 Podium - Revit sample',
    floors: FLOORS,
    plans: { P1: SHEET_49 },
    names: NAMES,
  });
  groundSupply(b, 'landlord');
  // Standby: generator and ATS on GF, the EMDB after the ATS. The generator-side feeders carry the
  // emergency lighting (FLS), so they are fire-rated (manager 3 Nov 2026; C9).
  b.place('generator', 'GF', 'GEN-GF-01', [10, 20], { kvaOverride: 500 });
  b.place('ats', 'GF', 'ATS-GF-01', [16, 20]);
  b.place('mdb', 'GF', 'EMDB-GF-01', [22, 20], { kind: 'emdb', demandCategories: ['landlord'] });
  b.feed('LV-GF-01', 'ATS-GF-01', [], TRAY, 'normal');
  b.feed('GEN-GF-01', 'ATS-GF-01', [], FIRE, 'standby');
  b.feed('ATS-GF-01', 'EMDB-GF-01', [], FIRE);

  // L01 electrical room (shown x 1183-1223, y 481-528 pt), boards as labelled on sheet 49.
  b.place('smdb', 'P1', 'SMDB-L1-LL-01', shown(1195, 488), { demandCategories: ['landlord'] });
  b.place('lighting', 'P1', 'LCP-L1-LL-01', shown(1214, 488), {
    description: 'Landlord lighting control panel',
    demandCategory: 'landlord',
    loads: [kw('1', 2)],
  });
  b.place('db', 'P1', 'DB-L1-LL-01', shown(1195, 520), {
    description: 'Landlord small power',
    demandCategory: 'landlord',
    loads: [kw('2', 4), kw('1', 1)],
  });
  b.place('lighting', 'P1', 'ELCP-L1-LL-01', shown(1207, 521), {
    description: 'Emergency lighting control panel',
    demandCategory: 'landlord',
    loadCategory: 'fls',
    fireRated: true,
    loads: [kw('1', 1)],
  });
  b.place('db', 'P1', 'EDB-L1-LL-01', shown(1218, 521), {
    description: 'Essential small power',
    demandCategory: 'landlord',
    loadCategory: 'essential',
    loads: [kw('2', 3)],
  });
  // DB-L1-GYM at its red symbol by the gym.
  b.place('db', 'P1', 'DB-L1-GYM', shown(984.4, 563.9), {
    description: 'Gym',
    demandCategory: 'landlord',
    loads: [kw('1', 2), kw('2', 3), kw('3', 5)],
  });
  // kWh meters on the room's top wall (sheet: "5 Nos. kWhr meters").
  b.place('meter', 'P1', 'MTR-L1-01', shown(1201, 484), {
    meterType: '3-Ph',
    meteredId: 'smdb-l1-ll-01',
  });
  b.place('meter', 'P1', 'MTR-L1-02', shown(1207, 484), {
    meterType: '3-Ph',
    meteredId: 'db-l1-gym',
  });
  b.place('meter', 'P1', 'MTR-L1-03', shown(1213, 484), {
    meterType: '3-Ph',
    meteredId: 'db-l1-ll-01',
  });

  // Landlord busbar riser BUSBAR-6 (BB1-T-LL01) from LV-GF-01 to the L01 SMDB.
  b.riser('LV-GF-01', 6, ['SMDB-L1-LL-01']);
  b.feed('SMDB-L1-LL-01', 'LCP-L1-LL-01', [], TRAY);
  b.feed('SMDB-L1-LL-01', 'DB-L1-LL-01', [], TRAY);
  // To the gym along the drawn cable tray: out of the room, down the corridor, across.
  b.feed(
    'SMDB-L1-LL-01',
    'DB-L1-GYM',
    [shown(1168.3, 488), shown(1168.3, 556.3), shown(984.4, 556.3)],
    TRAY,
  );
  // Essential and emergency boards from the EMDB on GF: feeders between floors (A-21).
  b.between('EMDB-GF-01', 'ELCP-L1-LL-01', 18, FIRE);
  b.between('EMDB-GF-01', 'EDB-L1-LL-01', 18, TRAY);
  return b.finish();
}

/** The ten apartment DBs of sheet 50 at their red symbols (shown pt) and their size. */
const APARTMENTS: { tag: string; at: [number, number]; type: '1BR' | '2BR' }[] = [
  { tag: 'DB-201', at: [216.0, 302.8], type: '2BR' },
  { tag: 'DB-202', at: [260.6, 272.0], type: '1BR' },
  { tag: 'DB-203', at: [332.0, 272.0], type: '1BR' },
  { tag: 'DB-204', at: [403.8, 272.0], type: '1BR' },
  { tag: 'DB-205', at: [448.3, 302.8], type: '2BR' },
  { tag: 'DB-206', at: [448.3, 389.7], type: '2BR' },
  { tag: 'DB-207', at: [403.9, 420.5], type: '1BR' },
  { tag: 'DB-208', at: [332.5, 420.5], type: '1BR' },
  { tag: 'DB-209', at: [260.7, 420.5], type: '1BR' },
  { tag: 'DB-210', at: [216.1, 389.8], type: '2BR' },
];
/** Sample apartment loads (kW per phase): lighting, small power, AC. */
const APARTMENT_LOADS = {
  '1BR': [kw('1', 0.5), kw('2', 1.5), kw('3', 2)],
  '2BR': [kw('1', 0.7), kw('2', 2), kw('3', 3)],
};

/** Sample 2: Level 02 typical tower floor - SMDB and ten apartment DBs with their meters. */
export function typicalSample() {
  const b = sampleBuilder({
    id: 'revit-sample-L02',
    name: 'DCH-F14 L02 Typical - Revit sample',
    floors: FLOORS,
    plans: { '1': SHEET_50 },
    names: NAMES,
  });
  groundSupply(b, 'residential');
  // Electrical room (shown x 384.5-408.5, y 353.9-382.6 pt).
  b.place('smdb', '1', 'SMDB-T-L2-AP', shown(388, 358), { demandCategories: ['residential'] });
  // Apartment busbar riser BUSBAR-1 (BB1-T-AP1) from LV-GF-01 to the L02 SMDB.
  b.riser('LV-GF-01', 10, ['SMDB-T-L2-AP']);

  const exit = shown(375.5, 358); // out of the room to the riser tray
  const corridor = 397.1; // bottom corridor tray (shown y)
  const core = 324.1; // tray up through the core (shown x)
  const top = 291.05; // top corridor tray (shown y)
  APARTMENTS.forEach((a, i) => {
    b.place('db', '1', a.tag, shown(...a.at), {
      description: `Apartment ${a.tag.slice(3)} (${a.type})`,
      demandCategory: 'residential',
      loads: APARTMENT_LOADS[a.type],
    });
    // "10 Nos. kWhr meters" in the electrical room: one 3-phase meter per apartment.
    b.place(
      'meter',
      '1',
      `MTR-${a.tag.slice(3)}`,
      shown(392 + (i % 5) * 3, 362 + Math.floor(i / 5) * 5),
      {
        meterType: '3-Ph',
        meteredId: a.tag.toLowerCase(),
      },
    );
    const [x, y] = a.at;
    const upper = y < 350;
    const corners = upper
      ? [exit, shown(375.5, corridor), shown(core, corridor), shown(core, top), shown(x, top)]
      : [exit, shown(375.5, corridor), shown(x, corridor)];
    b.feed('SMDB-T-L2-AP', a.tag, corners, CORRIDOR);
  });
  return b.finish();
}

export const REVIT_SAMPLES = [
  { file: 'DCH-F14_L01_Podium', build: podiumSample },
  { file: 'DCH-F14_L02_Typical', build: typicalSample },
];
