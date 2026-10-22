# Prompt 2 — Build the Login page and Page 1 (Project Set-up & Import Floor Plan)

Read `CLAUDE.md` and the design document sections listed below before starting:
Section 2 (roles), 4 Module A & B (FR-01 to FR-10), 5 (NFRs), 7 "Page 1", 10.1 and 10.1A (fields and defaults), 14 (assumptions), 15 (open items OI-01, 02, 05, 27, 28).

I am attaching the current UI screenshots (Login, Import Floor Plan). Keep the existing visual style (layout, colours, typography, card style, left navigation, top bar with user and Sign Out). Change only what this prompt asks for.

Work in this order and show me a short plan before coding: data model → rule pack → login → project picker → Page 1 sections → floor-plan viewer & calibration → save/load → tests.

---

## Part A — Login page

### Keep from the current screen
- Header: "Next-Generation Connected MEP Architecture", headline "Design. Validate. Deliver. Intelligent Building Systems.", the NeuroMEP description line.
- Left card "End-to-End Engineering Workflow" with five numbered steps; right card "Engineer Portal Sign In".

### Changes
1. **Align the five workflow steps with the actual page names** (the current card says "Modeling Lab" and "Visual Validation", which do not match the left navigation):
   - 01 Import Floor Plan — Set up the project, upload floor-plan PDFs and calibrate scale.
   - 02 Floor Modeling — Place electrical components and draw connections; cables are sized live.
   - 03 Building Modeling — Stack floors in 3D, define risers and connect to transformer and generator.
   - 04 Architecture — Review the single-line diagram and panel schedules; lock or override sizes.
   - 05 Simulation & Report — Run generator scenarios, clear warnings and export schedules.
2. **Remove the "Demo Credentials" line from production builds.** Show it only when a development flag is on.
3. Sign-in form: email (validated format), password (masked, show/hide toggle), "Sign In to Engineering Workspace" button. Enter submits. Disable the button and show a spinner while submitting. Show a plain-language error under the form for wrong credentials or a network failure ("Email or password is incorrect" — do not reveal which). Add a "Forgot password?" link that shows "Contact your administrator" for now.
4. **Authentication behind an interface** (`AuthProvider` with `signIn`, `signOut`, `getCurrentUser`), because the final provider (MAEC One unified login, OI-28) is not decided. Implement a development provider with seeded users for each role in Section 2: Technical Lead, Electrical Engineer, Mechanical Engineer, PHE Engineer, Checker, System Administrator.
5. Session: keep the user signed in across page reloads; Sign Out returns to Login; protected routes redirect to Login when no session.

## Part B — Project picker (new, small)
After login the user needs somewhere to choose a project. This screen is not yet in the design document — build it minimally and tell me so I can add it to the doc:
- List of projects the user can access (name, client, design stage, revision, last modified).
- "New Project" (Technical Lead only) → opens Page 1 empty.
- "Import Project (.json)" → opens Page 1 filled from the file.
- Click a project → opens its last page.

## Part C — Page 1: Project Set-up & Import Floor Plan

Page title: "Project Set-up & Import Floor Plan". Group the page into numbered cards. Only the Technical Lead can edit; other roles see it read-only.

### Card 1 — Project Details (design doc 10.1)
| Field | Control | Rule |
|---|---|---|
| Project Name | text | required |
| Location | text | required |
| Client Name | text | required |
| Plot ref | text | required |
| Design Stage | dropdown: CD, SD, DD, TD, IFC (show full names as hints: Concept, Schematic, Design Development, Tender Design, Issued for Construction) | required |
| Revision | text | required |
| Project Category | dropdown: Residential, Hotel, Mixed-use, Office, Mall, Hospital, School, Industrial, Aircraft Hangars, Others | required |
| Plot load allocation | number + unit toggle (kW / kVA) | required, > 0 |

### Card 2 — Site Conditions
| Field | Unit | Default (from rule pack) | Range |
|---|---|---|---|
| Ambient air temperature | °C | Dubai 50 | 0–60 |
| Ambient soil temperature | °C | Dubai 35 | 0–50 |
| Soil thermal resistivity | °C·m/W | Dubai 2.0 | 0.5–3.0 |
| Altitude | m | empty | 0–5000 |

Show a small "region default" tag next to a value that still equals the rule-pack default.

### Card 3 — Calculation Set-up
- **Region**: dropdown. Only "Dubai" is selectable; "Abu Dhabi" and "Others" are visible but disabled with the tooltip "Rule pack not available yet".
- Selecting the region loads the rule pack and pre-fills site defaults and demand factors (only fields the user has not edited).
- **Upstream short-circuit capacity (MVA)**: required number, placeholder "e.g. 350".
- **Calculations** check-boxes, all ticked by default: Current Carrying Capacity, Voltage Drop, Short-circuit, Let-through Energy, Earth Fault Loop Impedance. Unticking shows the note "This check will still be calculated and reported as Not verified".
- **Demand factors – by load type**: editable table, 12 rows with codes 1–12 (Lighting, Power, AC, Heater, Laundry, Kitchen, Hand Dryer, Pumps, Fire Pumps, Special Equipment, Lifts & Equipment, Spare). Values 0–1 (allow % display). **The real values are not known yet (OI-01): load them from the rule pack, where they are `null`, and show each empty cell with a "TBC" badge. Do not invent numbers.**
- **Demand factors – by category (Dubai)**: Residential, Landlord, Office, Retail; same TBC handling.
- **Calculation defaults** (collapsed panel, read-only for everyone except the Technical Lead, design doc 10.1A): supply voltage/frequency, default load power factor, default depth of laying, target power factor, cable length allowance, transformer loading limit, default cable construction, voltage-drop limits per level. Values come from the rule pack; TBC values shown as TBC. Any override by the Technical Lead is marked "overridden" and logged.

### Card 4 — Floors & Elevations (FR-05, OI-05)
- Inputs: No. of basements, Ground floor (always 1), No. of podium levels, No. of typical floors, Mechanical floor 1/2/3 reference (optional, chosen from the generated floor list).
- "Generate floor registry" builds the ordered list: B{n}…B1, GF, P1…Pn, then typical floors 1…n. Mechanical floors are tagged on the chosen rows.
- Registry table columns: Order, Floor code, Floor name (editable), Type, Finished floor level (m), Floor-to-floor height (m), Plan status.
- Enter GF level (default 0.00) and a floor-to-floor height per row (a "fill all" action helps). Levels above GF are calculated cumulatively from the heights; basement levels are negative. Height range 2.5–10 m.
- Changing the counts after the registry exists must not silently delete floors that already have a plan: ask for confirmation and list what will be removed.

### Card 5 — Working Directory & Discipline Assignment (keep existing)
- Working directory (path + Browse).
- Electrical / Mechanical / PHE engineer assignment: searchable multi-select of users, shown as chips (fix the current chip text overlap). Required: at least one Electrical engineer.

### Card 6 — Floor Plans & Scale Calibration (FR-08, FR-09, FR-10)
- Upload a PDF per floor: either select a row in the registry and click Upload, or drop the file on the row. Accept PDF only; show the file name and upload time on the row.
- **Viewer** (the existing "CAD Blueprint Workspace" area): render the selected floor's PDF as vector, with zoom in/out, fit-to-view and pan (keep the existing Shift + right-click pan and the zoom indicator).
- **Plan status per floor:** "No plan" → "Uncalibrated" → "Calibrated".
- **Scale calibration tool:**
  1. Click "Calibrate scale".
  2. Click point A and point B on a known dimension (for example the distance between two grid lines).
  3. Enter the real distance in metres.
  4. The app stores metres-per-drawing-unit for that floor and sets status "Calibrated".
  - Optional "Verify": measure a second known distance and show the measured value so the user can confirm.
  - Alternative input: drawing scale (e.g. 1:100) and sheet size — mark it "less reliable" in the UI.
  - Store calibration in PDF page coordinates (not screen pixels) so zooming or panning never changes it.
- **Replace plan:** replacing a calibrated floor's PDF resets its status to "Uncalibrated" and asks for re-calibration. Alignment to the old plan and flagging of components outside the new extents (FR-10) will be needed once components exist on Page 2 — build the replace flow now and leave a clearly marked extension point for alignment.

### Card 7 — Import Saved Project (.json) (keep existing)
- Validates `schemaVersion`; shows a clear error for an unsupported or corrupt file; asks for confirmation before replacing unsaved changes.

### Page behaviour
- **Next →** is enabled only when: all required fields are valid, the registry is generated with levels and heights, and at least one floor is Calibrated. When disabled, hovering shows the list of what is missing, and clicking scrolls to the first problem.
- Inline validation messages under each field; never block typing.
- **Save Project** button plus autosave (on change, debounced, and when leaving the page); unsaved-changes warning on navigation away.
- **Fix the current layout bug** where the "Altitude (meters)" label overlaps the Plot load allocation input.
- The right-hand area of the top bar keeps the user name, role and Sign Out.

## Part D — Data model and rule pack

1. Define a typed `Project` model (with `schemaVersion` and `rulePackId` + `rulePackVersion`) containing: details, site conditions, calculation set-up (region, upstream MVA, enabled checks, demand factors by load type and by category, default overrides), floors (with plan reference and calibration: point A, point B in PDF units, real distance, metres per unit, method, timestamp), working directory, discipline assignments, and an audit log of changes to demand factors and defaults.
2. Create the Dubai rule pack as a versioned data file (e.g. `rulepacks/dubai/v1.json`), **not hard-coded in components**, containing:
   - site defaults (air 50 °C, soil 35 °C, resistivity 2.0);
   - supply 400/230 V, 50 Hz; default load pf 0.85; target pf 0.92;
   - voltage-drop limits: MDB 2.0 %, SMDB 2.0 %, Busduct 2.0 %, MCC 2.0 %, DB 2.5 %, Motor 4.0 %, Final circuits 4.0 %;
   - demand factors for the 12 load types and 4 categories as `null` (TBC);
   - default depth of laying, cable length allowance, transformer loading limit, default cable construction as `null` with the interim defaults from design doc Section 15 recorded as `interimDefault` (depth TBC, allowance 10 %, loading limit 80 %).
3. Project file export/import (.json) round-trips the full model.
4. Keep the model in a shape the future calculation engine can consume directly (the engine is a separate module built later; do not build it now).

## Out of scope for this task
Floor Modeling canvas, component library, cable drawing, the calculation engine, Building Modeling, Architecture, Simulation & Report.

## Tests (required)
- Field validation rules and the Next-button gating.
- Floor registry generation (counts → ordered list, codes, mechanical tagging) and cumulative level calculation including basements.
- Calibration maths (two points + distance → metres per unit) and its independence from zoom level.
- Rule-pack loading: defaults applied only to untouched fields; TBC values stay `null`.
- Project JSON export → import round trip; rejection of a wrong `schemaVersion`.
- Auth: sign-in success/failure, protected-route redirect, role-based read-only Page 1.

## When you finish
1. Run all tests and report results.
2. Give me screenshots (or a short description) of Login, Project picker and Page 1 in each state: empty, partly filled with errors, complete with a calibrated floor.
3. Update `CLAUDE.md` (any new decisions, e.g. the project picker) and add a line to `docs/CHANGELOG.md`.
4. List anything you had to assume, and anything the design document should now include.
