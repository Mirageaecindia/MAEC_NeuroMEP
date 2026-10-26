/**
 * Sample content for the Schematic and Output layouts (WBS 1.2.1, Figma screens 4 and 5). Not
 * calculated: replaced by the network model, engine results and exports in WBS 1.5.3 and 1.7.
 */

export const SAMPLE_TRANSFORMERS = ['T001', 'T002', 'T003', 'T004', 'T005'];

/** Single-line diagram sample: transformer -> LV panel -> SMDBs with outgoing ways. */
export const SAMPLE_SLD = {
  transformer: { tag: 'TRANSFORMER-1', rating: '1500 kVA, 11/0.4 kV' },
  panel: { tag: 'LV PANEL-1', incomer: 'ACB 2500 A, 4P, 65 kA' },
  boards: [
    { tag: 'SMDB-P4-B2-L10-APT-01', breaker: 'MCCB 350 A', ways: 12 },
    { tag: 'SMDB-P4-B2-L11-APT-02', breaker: 'MCCB 250 A', ways: 12 },
  ],
};

export const REPORTS = [
  'Completed Schedule',
  'First Level Schedule',
  'Second Level Schedule',
  'Floor Level Schedule',
  'Generator Load Analysis',
] as const;
export const SCHEDULE_TYPES = [
  'DB Schedule',
  'SMDB Schedule',
  'MDB Schedule',
  'MCC Schedule',
] as const;

/** SMDB schedule in the company format (Figma screen 5, Section 14). */
export const SAMPLE_SCHEDULE = {
  project: 'DUBAI CREEK GARDENS',
  board: 'SMDB-P4-B2-L10-APT-01',
  location: 'ELECTRICAL ROOM - B2-L10',
  client: 'MLD',
  incomer: {
    breaker: 350,
    duty: 50,
    cores: 'T 4C',
    type: 'XLPE',
    size: 300,
    ecc: 150,
    length: 143,
    kw: [57.48, 46.51, 51.11],
    tcl: 155.1,
    md: 100.81,
  },
  ways: [
    ['DB-P4-B1-2BR-L10-01', '1RYB', 16, 16, 31, [4.96, 4.07, 4.49], 13.53, 8.79],
    ['DB-P4-B1-2BR-L10-02', '2RYB', 25, 16, 44, [4.96, 4.07, 4.49], 13.53, 8.79],
    ['DB-P4-B1-3BR-L10-03', '3RYB', 35, 25, 53, [6.47, 4.8, 5.73], 16.99, 11.05],
    ['DB-P4-B1-3BR-L10-04', '4RYB', 35, 25, 65, [6.47, 4.8, 5.73], 16.99, 11.05],
    ['DB-P4-B1-1BR-L10-05', '5RYB', 25, 16, 50, [3.95, 3.31, 3.44], 10.7, 6.95],
    ['DB-P4-B1-1BR-L10-06', '6RYB', 25, 16, 57, [3.95, 3.31, 3.44], 10.7, 6.95],
  ] as const,
  totals: { kw: [57.475, 46.513, 51.108], tcl: 155.1, md: 100.81, demandFactor: 0.65 },
};
