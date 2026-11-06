# Engineer cross-check of engine results (WBS 1.7.5)

For: the Senior Electrical Engineer. Prepared 6 Nov 2026 (engine 0.1.0, rule pack Dubai v1.0.0).

NeuroMEP has sized four small test buildings. Please recalculate the **featured feeders** by hand,
in your own way, and compare. Each difference you find is logged in the design document's
verification log (Section 11) and fixed, or explained, before the demo.

All inputs are **test data**, chosen to exercise each calculation path. They are not design values.

## What is in this folder

| File | What it is |
|---|---|
| `NeuroMEP_CrossCheck_Worksheet.xlsx` | **Start here.** One sheet per case. Each feeder lists every NeuroMEP figure, with a yellow column for your hand value. The result shows OK or CHECK. |
| `CC-nn_*_CalculationSheet.xlsx` | The calculation sheet NeuroMEP produces for each case: one row per cable, busbar feeder and riser, laid out in the CableSizer steps. |
| `CC-nn_*.json` | The same case as a project file, to open on the server (see below). |

## Pass criteria (AT-03)

- **Selections must be identical:** breaker rating, type and poles; cable size and runs; ECC; busbar rating; the "sized by" check; each check's outcome.
- **Numbers within ±0.5 %:** Ib, factors, Iz, voltage drops, fault currents, Zs.

The worksheet applies both rules for you. Please write a remark against every **CHECK**: your method, the table value you used, and which result you believe is right.

## The four cases

| Case | Building | Featured feeders (recalculate in full) | What it exercises |
|---|---|---|---|
| CC-01 | Office tower, 1000 kVA | TX-1 > LV-1, SMDB-1F > DB-1F-P, Riser 1 | Non-Emaar office demand 0.8 at the LV panel; transformer uk from the catalogue; Gersan riser with three tap-offs, k = (n + 1) / 2n; fault level through the riser |
| CC-02 | Residential with standby, 1500 kVA + 500 kVA generator | G-1 > ATS-1, ESMDB-1 > ISO-FP | Generator through an ATS; fault level from the generator (X"d 14 %); fire pump 30 kW star-delta at efficiency 0.92; fire-rated cable (C8, C9) |
| CC-03 | Retail with pumps, 1600 kVA | LV-1 > MCC-1, LV-1 > SMDB-R | Emaar demand; cable buried direct at 0.8 m (K1 at 40 °C ground, soil 2.0 K.m/W, depth); PVC cable in a duct, 0.45 m apart; pumps on isolators |
| CC-04 | Car park and plant, 1000 kVA | SMDB-CP > DB-CP2, MDB-1 > SMDB-CH | Manual demand factors; long runs sized by voltage drop; single-phase DB at 230 V over 155 m; 300 kW plant on parallel runs |

## How NeuroMEP calculates (agreed rules you will need)

- **Cable length** = routed length + 5 m. There is no percentage allowance (manager, 3 Nov 2026). The worksheet shows each length.
- **Ib** comes from the demand the feeder carries (D-06), not from the rating of the source. So a 1000 kVA transformer feeding 90 kW gets a 125 A incomer in CC-01.
- **Demand:**
  - Dubai methods apply the category factor once, at the LV panel / MDB.
  - Emaar also applies 0.8 at SMDBs.
  - The Manual method applies the load-type factors once at each board.
- **Power factor** per load type (Lighting 0.85, Power / AC 0.8, Heater 1.0). The power factor entered on a DB applies to all its loads.
- **Derating factors** between table steps take the more conservative step, with no interpolation.
- **Ground temperature** is 40 °C and air is 50 °C.
- **Short circuit** follows the CableSizer v1.1 method:
  - c = 1.
  - Upstream network: X = 0.995 Z, R = 0.1 X.
  - Cable R and X from the CableSizer formulas.
  - Ik" min uses hot conductor resistance.
- **ECC:** a separate Cu/PVC conductor per run, from the CableSizer CPC table.
- **Riser voltage drop** uses k = (n + 1) / 2n. Boards below a riser start from the riser's real drop.

## What you will see that is by design

- **C4 and C5 show "N.C." with code E2402.** They need breaker let-through and trip data (OI-03, no catalogue yet). The cable's own withstand and Zs are worked out and shown in the trace.
- **C7 shows "N.C."** until a board's Icw / Ipk are entered.
- **Status is Provisional** for these two reasons only. Risers and tap-off boxes, which don't wait for breaker data, are Final.

## Opening a case on the server (optional)

1. Sign in as the Technical Lead. Open **Import File > Open > Open project file (.json)** and choose `CC-nn_*.json`. It opens as a new project.
2. On Import File, assign yourself as **Electrical engineer**, then press **Next** through the pages.
3. Look at the case in three places:
   - **Building:** risers and the Cable Size Calculator.
   - **Schematic:** the single-line diagram.
   - **Output:** the Calculation Sheet and the schedules.

   The floors have no plan PDFs. The right panel on Floor Setup shows each feeder's full calculation trace: inputs, table values and formulas.

## Questions found while preparing the pack

The engine blocks these items rather than guessing (V-14). Please answer them with your cross-check.

1. **OI-36: earth conductor for 400 mm².** CableSizer's CPC table for Cu/XLPE phase conductors with a PVC earth conductor lists 300, 370, 480 and 500 mm², but not 400 mm². Until now NeuroMEP left the ECC empty and still passed the cable. It now blocks such a cable with E2101. What ECC should a 400 mm² cable get? (The XLPE/XLPE row gives 240 mm².)
2. **OI-37: grouping factor for 2-core cables on trays.** CableSizer's tray grouping table (GROUPJ) has rows for 1-core and 3/4-core cables only. A single-phase DB fed by a 2-core cable on a tray is therefore blocked with E2102. Should 2-core cables use the multicore (3/4-core) row? CC-04 uses a 3-core cable for its single-phase DB in the meantime.

## Returning your results

Fill in the worksheet and send it back. The Summary sheet counts OK and CHECK per case.

If the engine changes, the developer regenerates these files with `npm run crosscheck -w @neuromep/web`. A test fails if they are out of date.
