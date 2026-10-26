/**
 * Sample data for the clickable page layouts (WBS 1.2.1). Layout preview only: these values are
 * not calculated and are replaced by the real model and engine in WBS 1.3 - 1.7.
 */

export interface SampleFloor {
  code: string;
  name: string;
  levelM: number;
  boards: string[];
}

/** Building view: floors stacked by elevation, top first (Figure 7.1). */
export const SAMPLE_FLOORS: SampleFloor[] = [
  { code: 'R', name: 'Roof', levelM: 16.8, boards: ['MCC-R'] },
  { code: '3', name: 'Level 03', levelM: 12.6, boards: ['SMDB-3'] },
  { code: '2', name: 'Level 02', levelM: 8.4, boards: ['SMDB-2'] },
  { code: '1', name: 'Level 01', levelM: 4.2, boards: ['SMDB-1'] },
  { code: 'GF', name: 'Ground Floor', levelM: 0, boards: ['MDB', 'Tx_GF_1', 'Gen_GF_1', 'ATS-1'] },
];

export interface SampleNode {
  tag: string;
  kind: string;
  x: number;
  y: number;
}

/** Floor view of Level 03 (positions in the preview drawing, not metres). */
export const SAMPLE_FLOOR_NODES: SampleNode[] = [
  { tag: 'SMDB-3', kind: 'SMDB', x: 120, y: 80 },
  { tag: 'DB-3A', kind: 'DB', x: 380, y: 170 },
  { tag: 'DB-3B', kind: 'DB', x: 170, y: 330 },
];
export const SAMPLE_FLOOR_CABLES: [string, string][] = [
  ['SMDB-3', 'DB-3A'],
  ['SMDB-3', 'DB-3B'],
];

export interface SampleLoadRow {
  tag: string;
  loadType: string;
  kwL1: number;
  kwL2: number;
  kwL3: number;
  pf: number;
}

/** Right-panel load table rows (FR-18). */
export const SAMPLE_LOADS: SampleLoadRow[] = [
  { tag: 'DB-3A', loadType: 'Lighting', kwL1: 2.0, kwL2: 2.0, kwL3: 2.0, pf: 0.9 },
  { tag: 'DB-3A', loadType: 'Power (sockets)', kwL1: 3.5, kwL2: 3.0, kwL3: 3.0, pf: 0.85 },
  { tag: 'DB-3B', loadType: 'AC/HVAC', kwL1: 6.0, kwL2: 6.0, kwL3: 6.0, pf: 0.85 },
];

/** Largest phase current, design doc 10.4 (unbalanced boards, V-05). */
export const phaseCurrentA = (r: SampleLoadRow) =>
  (Math.max(r.kwL1, r.kwL2, r.kwL3) * 1000) / (230 * r.pf);

/** Architecture page: network tree (source to DBs). */
export interface SampleTreeNode {
  tag: string;
  detail: string;
  children?: SampleTreeNode[];
}
export const SAMPLE_TREE: SampleTreeNode = {
  tag: 'Tx_GF_1',
  detail: '1500 kVA',
  children: [
    {
      tag: 'MDB',
      detail: 'ACB 2250 A',
      children: [
        { tag: 'SMDB-1', detail: 'MCCB 160 A', children: [{ tag: 'DB-1A', detail: 'MCCB 63 A' }] },
        { tag: 'SMDB-2', detail: 'MCCB 160 A' },
        {
          tag: 'SMDB-3',
          detail: 'MCCB 160 A',
          children: [
            { tag: 'DB-3A', detail: 'MCCB 40 A' },
            { tag: 'DB-3B', detail: 'MCCB 50 A' },
          ],
        },
        { tag: 'MCC-R', detail: 'MCCB 250 A' },
      ],
    },
  ],
};

/** Panel schedule rows (Section 14 columns). */
export const SAMPLE_SCHEDULE = [
  {
    way: 1,
    ref: 'DB-3A',
    poles: 'TPN',
    device: 'MCCB 40 A',
    duty: '25 kA',
    cable: '1 x 4C x 10 mm2 Cu/XLPE/SWA/PVC',
    ecc: '10 mm2',
    length: 40,
    kw: [5.5, 5.0, 5.0],
    md: 15.5,
  },
  {
    way: 2,
    ref: 'DB-3B',
    poles: 'TPN',
    device: 'MCCB 50 A',
    duty: '25 kA',
    cable: '1 x 4C x 16 mm2 Cu/XLPE/SWA/PVC',
    ecc: '16 mm2',
    length: 28,
    kw: [6.0, 6.0, 6.0],
    md: 18.0,
  },
  {
    way: 3,
    ref: 'Spare',
    poles: 'TPN',
    device: 'MCCB 40 A',
    duty: '25 kA',
    cable: '-',
    ecc: '-',
    length: 0,
    kw: [0, 0, 0],
    md: 0,
  },
];

/** Simulation & Report: final check list (FR-33). */
export const SAMPLE_CHECKLIST = [
  {
    kind: 'Failure',
    code: 'C2',
    tag: 'F3-1-2',
    text: 'Voltage drop 2.64 % above the DB limit 2.50 %',
  },
  {
    kind: 'Warning',
    code: 'E1901',
    tag: 'SMDB-3',
    text: 'Demand factor not confirmed - 1.0 used, result Provisional',
  },
  {
    kind: 'Not calculated',
    code: 'C4',
    tag: 'All cables',
    text: 'Let-through not selected on Page 1',
  },
  { kind: 'Override', code: '', tag: 'F3-1-1', text: 'Cable size locked at 10 mm2 by S. Patel' },
];
