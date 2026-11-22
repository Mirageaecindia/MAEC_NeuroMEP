# NeuroMEP → Revit exchange (draft 0.1.0)

For the Revit team building the "Import from NeuroMEP" add-in (design doc Section 16, stage 2; #TASK-33).

NeuroMEP writes one JSON package per project. It holds every component the engineer placed on the floor plans, every feeder with its route, the risers, and the last Cable Size results. The add-in reads it to place the company's electrical families at the right level and position, and to fill their parameters.

**Draft.** Families, shared parameters and Revit versions are still open (OI-35). Expect changes once you confirm what you need.

## Files

| File | What it is |
|---|---|
| `samples/<sample>.json` | Exchange package of a sample building, modelled and sized in NeuroMEP. |
| `samples/<sample>_project.json` | The NeuroMEP project it came from (open with Import File > Open project file). |
| `samples/<sample>_<floor>_check.pdf` | The floor plan with every component and feeder drawn from the JSON alone (see Placement check). Made locally, not in git. |
| `../Floor_plan_inputs/` | The floor-plan PDFs the samples were modelled on. |
| `placement_check.py` | Draws a package back onto its plan PDFs. |

## The two samples (DCH-F14)

| Sample | Sheet | What is on it |
|---|---|---|
| `DCH-F14_L01_Podium` | `49-DCH-F14-MRG-DRW-PDM-L01-EEP-2006-A.pdf`: 1st floor (podium deck), A1 at 1:200 | Electrical room: SMDB-L1-LL-01 on the landlord busbar riser BUSBAR-6 (BB1-T-LL01), LCP-L1-LL-01, DB-L1-LL-01, ELCP-L1-LL-01 (emergency lighting, FLS, fire-rated feeder) and EDB-L1-LL-01 (essential) fed between floors from EMDB-GF-01 behind the generator's ATS; DB-L1-GYM at its symbol, fed along the drawn tray; 3 meters. |
| `DCH-F14_L02_Typical` | `50-DCH-F14-MRG-DRW-TWR-L02-ELE-2102-A.pdf`: 2nd floor (typical tier 1, L03-L19), A1 at 1:100 printed reduced to letter size | SMDB-T-L2-AP in the electrical room on the apartment busbar riser BUSBAR-1 (BB1-T-AP1); DB-201 to DB-210 at their symbols in the apartments, each fed along the corridor and core trays; 10 meters (one per apartment). |

Both have the Ground Floor supply (TX-GF-01 1500 kVA, LV-GF-01, PFC-GF-01; sample 1 also GEN-GF-01, ATS-GF-01, EMDB-GF-01). No GF plan was shared, so those components have positions in metres and no PDF point. Tags are the drawings' own. Loads, kVA and lengths are sample data.

Both sheets are rotated 90° (`pageRotationDeg: 90`). Sheet 50 is a reduced print: its calibration (0.106187 m per pt) comes from the title block (A1, 1:100) and the page size, and should be confirmed against a dimension. Each floor lists two grid crossings with their PDF points (`alignment.referencePoints`); fill in their Revit coordinates to place the floor exactly.

Results are Provisional only because of W2402: the let-through and earth-fault checks wait for the breaker catalogue (OI-03). There are no failing checks.

## Package contents

| Key | Content |
|---|---|
| `format`, `version`, `draft` | `neuromep-revit-exchange`, `0.1.0`, and what is still open. |
| `source` | Engine and rule-pack version used for the results. |
| `units` | m, pt, kW, kVAr, A, kA, mm², %; rotation in degrees clockwise as seen on the plan. |
| `project` | Name, client, location, plot, design stage, revision. |
| `floors[]` | `id`, `code` (B1, GF, 1 …), `name`, `order`; `plan` = PDF file name, page size in points, page rotation and calibration; `alignment.referencePoints` (see Coordinates). |
| `components[]` | One per placed component. See the components table. |
| `feeders[]` | One per cable or busbar feeder. See the feeders table. |
| `risers[]` | Busbar risers: length, source, tap-offs, busbar result. |
| `summary` | Counts, and results by status. |

Each component has:

| Key | Content |
|---|---|
| `neuromepId`, `tag` | Identity; `tag` is the engineer's tag, e.g. `SMDB-GF-01`. |
| `kind`, `kindLabel` | Map to a Revit family: transformer, generator, ups, ats, lv-panel, mdb, emdb, acb-panel, smdb, esmdb, mcc, emcc, db, isolator, connection-unit, pfc-bank, meter, equipment. |
| `floorId` | The floor it is placed on. |
| `placement` | `model` and `pdf` points, `rotationDeg`, `symbolScale`. |
| `properties` | Every engineering value entered, e.g. kVA, poles, IP rating, earth leakage, loads, meter type. |
| `load` | Connected load per phase, total connected, maximum demand, power factor, current. |
| `pfc` | PFC banks only: kVAr in total and per demand category. |
| `fedFrom`, `linkedTo` | Which feeder or riser supplies it; for equipment and meters, the component they are linked to. |
| `result` | Result of its incoming feeder: breaker, fault level, voltage drop, checks. |
| `revit.uniqueId` | Empty for the add-in to fill, so a re-import updates elements instead of duplicating them. |

Each feeder has:

| Key | Content |
|---|---|
| `tag`, `circuitRef` | Tag and outgoing way on the source board, e.g. `1RYB`. |
| `from`, `to` | The two components it connects. |
| `route` | Corners on the plan in `model` and `pdf` points. Feeders between floors (`betweenFloors: true`) have no route, only a typed length. |
| `length` | Routed length, the 5 m addition, total. |
| `construction` or `busbar` | Cable construction (cores, conductor, insulation, armour, installation method) or busbar specification. |
| `description` | e.g. `1 x 4C 95 mm² Cu/XLPE/SWA/PVC + 1C 50 mm² ECC`. |
| `result` | Status, breaker type / rating / poles / breaking capacity, cable runs / cores / size / ECC, Ib / In / Iz, voltage drop (feeder and total), fault level max / min, checks C1–C9 with state and detail. |

A `result` with `outOfDate: true` means the model changed after the last Cable Size run. Sizes may then be wrong, so the add-in should warn and not write them.

## Coordinates

- **`pdf`**: page 1 of the floor-plan PDF, in points (1/72 in). Origin is the bottom-left corner of the page, x to the right, y up. This is the PDF's own (unrotated) space.
- **`model`**: metres on the floor = `pdf × metresPerPoint` (`floors[].plan.calibration`). Same origin and axes. This is what NeuroMEP stores.
- **Page rotation:** `plan.pageRotationDeg` is the PDF page's rotation, the angle the sheet is shown turned by. Coordinates are not rotated. A sheet with rotation 90 is shown landscape but its points are in the portrait page space.
- **To Revit:** a Revit plan view is also x right / y up. Per floor: `revit = rotate(model, θ) + offset`. θ and the offset come from two `alignment.referencePoints`: the same two points, such as grid crossings, given both in `pdf` and in Revit coordinates. Without reference points, put the plan origin at the Revit origin with no rotation, then move the whole floor by hand.
- **Calibration:** metres per point comes from the engineer's two-point calibration (`pointA`, `pointB`, `realDistanceM`). Check it against the drawing scale: on a 1:100 sheet, 1 pt = 0.03528 m; on a 1:200 sheet, 0.07056 m.
- **Level:** the floor's Revit level. Match it by `floors[].code` / `name`.

## Placement check

```sh
# Draw a package back onto its plans (needs: pip install pymupdf)
python -I placement_check.py samples/<sample>.json ../Floor_plan_inputs
```

The check reads only the JSON. It draws each component (circle, tag, breaker rating) and each feeder route (tag, size) on a copy of the plan. Every marker must sit where the component was placed in NeuroMEP. After import, the Revit families should line up with this sheet once the floor is aligned.

## How the samples are made

`apps/web/src/revit/sampleBuilder.ts` models each sample the way an engineer does in Floor Setup: the plan is calibrated, components are placed, feeders are drawn along corners and loads are entered. NeuroMEP's own engine then runs Cable Size on the whole project, and the package is written with `revitExchange` (`packages/shared/src/model/revitExchange.ts`). Loads and settings in the samples are test data, not design values.
