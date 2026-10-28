# NeuroMEP — Project Memory for Claude Code

This file is read at the start of every session. Keep it short and current.
When something here changes, update this file in the same task and add a line to `docs/CHANGELOG.md`.

## What NeuroMEP is
A web application for MEP (Mechanical, Electrical, Plumbing/PHE) design engineers.
Engineers upload architectural floor-plan PDFs, drag components onto each floor, connect
them by drawing cables (like Cisco Packet Tracer), press **Cable Size** to size and validate
every breaker and cable, then produce fixed-format panel schedules that contractors build from.
It replaces manual drawing plus the CableSizer v1.1 Excel workbook.

## Source of truth
- **Design document (baseline):** `docs/NeuroMEP_SRS_SDD.md` = **v0.3 freeze candidate (25 Oct 2026)**, frozen as baseline under WBS 1.1.1, plus approved amendments **A-01** and **A-02** listed in its Section 0. The original Word file is in `docs/Design doc and WBS/`.
  - Section 4: #TASK codes and error-code convention. Section 5: FRs. Section 7: architecture (Figures 7.1–7.4, floor-plan handling). Section 8: collaboration. Section 9: pages and "changes to earlier pages".
  - Section 10: calculation specification (verified); Section 11: verification log (V-nn); [ENG] = awaits Senior Electrical Engineer.
  - Section 12: data dictionary (12.1 Page 1, 12.2 rule-pack defaults, 12.3 equipment fields, 12.5 tooltips). Section 18: open items and decisions. Appendix D: errors engineers meet.
  - **Never invent a value for an open item.** Use the stated interim default or a clearly labelled placeholder.
- **UI design (Figma, received 27 Oct 2026):** `NeuroMEP UI/*.png` — 14 screens: Login, then 5 pages as top tabs (All Projects, Import File, Floor Setup with Building tab, Schematic, Output). **Follow these screens strictly.** They replace all earlier UI screenshots and the WBS 1.2.1 layout previews. Conflicts with the design document are resolved by amendments A-03 to A-14 (design doc Section 0): Figma wins for frontend features; the calculations of Section 10 never change. Ask the user about anything new.
- **Project schedule (WBS):** `docs/Design doc and WBS/NeuroMEP_Project_Gantt_Schedule (1).xlsx` — 26 Oct to 10 Nov 2026. **Develop in WBS order** (1.1 → 1.8); each commit names its WBS item and #TASK code.
- **Reference data:**
  - `docs/reference/cablesizer_lookup_rules.json` — source record of the CableSizer lookup tables. Never edit it.
  - `packages/rulepacks/cablesizer/lookup-tables.json` — typed runtime form (`npm run convert:cablesizer -w @neuromep/rulepacks`), tested against every source rule (WBS 1.5.4). Known legacy errors flagged "awaiting engineer sign-off (OI-07)", not corrected.
  - **Archived starting point only (V-12):** a result that used these CableSizer ampacity tables is never Final until verified Ducab / BS 7671 tables replace them.
- **Change history:** `docs/CHANGELOG.md`.
- If the design doc and this file disagree, the design doc wins; flag the conflict to the user.

## Phase 1 scope
Electrical LV distribution only: supply (EB utility/RMU, transformer, generator via ATS, UPS) → LV Panel/MDB/EMDB → busbar risers / tap-offs → SMDB / MCC → **incoming feeder of each DB**. The DB is a terminal node with entered load. Mechanical/PHE components exist but only supply electrical data.

## Pages (Figma design, A-03)
Login → five top tabs: **All Projects** (project cards with status) → **Import File** (project set-up form + calculation set-up + discipline assignment) → **Floor Setup** (component library left, plan canvas, right panel: transformer capacity & connected load, engineering properties, Cable Size; **Building** toolbar button switches to the Building tab: riser diagram + Building Summary) → **Schematic** (single-line diagram per transformer, Download) → **Output** (Report Library: schedules, preview, Download).
- Shared toolbar on every page; which buttons are enabled depends on the page (see the screenshots). Bot and Smart-AI are shown but inactive (A-09).
- Plans: toolbar Open uploads the PDF of the floor in the floor picker; first display of an uncalibrated plan shows a calibration prompt; placing components blocked until calibrated (A-04).
- Floors: No of Floors (Ground + N) and No of Basements; no floor heights; riser lengths typed in the Building tab; cable length = routed length x scale + 1 m per cable (A-05).
- Cable Size: right-panel button (floor) and Building-tab Cable Size Calculator (building), enabled only after the transformer is connected to the risers (A-07).
- Floor status per discipline: pill = in progress, flag = saved and locked (only the Lead reopens), X = not opened (A-08).
- Component library = the Figma items, all enabled incl. Cable and Lighting; legend symbols (SVG + CMP code) kept in a server-side symbol catalogue for drag-and-drop, drafts marked for approval (A-11, WBS 1.3.1).
- Tabs open in order: later tabs greyed until Next; earlier tabs always reopenable; the project stores the furthest page reached (A-12).
- Building tab lists floors top-down, Ground then basements at the bottom (A-13); Building Summary "Demand Factors" reopens the 12 load-type factors, a change marks sizes out of date (A-14).
- Going back and changing an earlier page asks for confirmation listing what is affected (Section 9).

## #TASK and error codes (Section 4, D-17)
- Permanent codes `#TASK-01` … `#TASK-34`; use them in commit messages, test names, log lines and error codes. Never reuse or renumber.
- **Error code** `E` + task (2 digits) + sequence (2 digits). Catalogue: `packages/shared/errors` (message, severity Blocks/Warning, action). Appendix D lists the 22 engineer-facing codes; developer-only codes are added to the catalogue too. Check codes C1–C12 (10.12) are not errors.
- **Log line:** `[timestamp] [level] [#TASK-nn] [Ennnn] message {projectId, floorId, elementTag, userId, rulePackVersion}`.

## Key decisions (Section 18) and amendments
- D-01/02 Phase 1 ends at the DB incoming feeder; schedules generated by NeuroMEP, never uploaded.
- D-03/05 Demand factors on Page 1, overridable per panel; cable construction chosen while drawing.
- D-04/12 Sizes calculated by a background engine **when the user presses Cable Size** (and before export); Provisional/Final status and "Out of date" marking; no calculation page; users may lock values.
- D-06/07/08 Ib per cable from the demand it carries; all failing checks reported; checks not ticked are not calculated and shown "Not calculated - not selected on Page 1". **A-06: Current Carrying Capacity and Voltage Drop always on**; Short-circuit, Let-through, Earth-fault loop optional.
- D-09/10/11 Dubai rule pack v1; normal + standby scenarios; CableSizer outputs are not a test oracle.
- D-13/14 Project picker after login; MERN + TypeScript monorepo, MongoDB, Netcup VPS.
- D-15 Verified rules of Section 10 replace CableSizer rules. D-16 Real-time collaboration (Section 8). D-17 #TASK / E-codes.
- D-20 / D-21 superseded in the UI by A-03 (Figma page structure) and A-07 (Cable Size triggers); sizing stays on demand.
- **A-01** Only the Technical Lead creates or imports projects (amends FR-02).
- **A-03..A-14** (27 Oct, Figma design and follow-up answers): see design doc Section 0 and the Pages section above. A-10: Altitude, floor height, Mechanical and PHE engineers optional; demand factors TBC; 12.1 fields not in Figma are not shown (voltage / frequency from the rule pack).
- **Open (manager to confirm):** riser / transformer cost in AED.
- **A-02** Prototype plans: PDF on server disk; PDF only, single page, ≤ 20 MB; PDF.js renders in the browser; cache keeps the open floor + previous one; one plan interface so a tile converter can be added later (amends FR-07 / Section 7). Built in WBS 1.2.7: `DiskPlanStorage` at `PLANS_DIR` (default `<DATA_DIR>/plans`), server checks E0601–E0604 with pdf.js, plans from the earlier GridFS store moved to disk at start-up.
- User accounts (prototype, 26 Oct; built in WBS 1.2.2): JSON user file (`USERS_FILE`, scrypt hashes from `npm run hash-password -w @neuromep/api`) — no users collection; MAEC One replaces it later via the AuthProvider interface. Sessions: random token in an httpOnly, SameSite=Strict cookie (Secure in production), SHA-256 stored in `sessions` (TTL, 12 h), Sign Out deletes it; 5 failed sign-ins per email (20 per address) in 15 min → E0103.
- Project access (26 Oct, unchanged): Technical Lead, Checker and System Administrator see all projects; engineers see projects they created or are assigned to.
- TBC demand factors: E1901 "Demand factor not confirmed" (Warning) — 1.0 is used and the result is Provisional. Load-type labels as Appendix B.

## Stack (D-14, Section 7)
- npm workspaces: `apps/web` (React + Vite), `apps/api` (Node + Express), `packages/engine` (pure TS; web worker + api), `packages/shared` (Zod schemas, types, Page 1 rules, error catalogue), `packages/rulepacks` (Dubai pack, CableSizer tables), `revit-addin/` (future).
- Section 7 also names Zustand, Konva, three.js, Socket.IO, ExcelJS — add each with the WBS item that needs it.
- MongoDB replica set, official driver; collections `projects`, `floors`, `elements`, `rulepacks`, `auditLog`, `exports`, `sessions`. Plan files on disk (A-02). Optimistic locking via `version`.
- Hosting: Netcup VPS (Nginx + TLS, PM2, MongoDB, nightly backup); staging demo on 10 Nov (WBS 1.8.3).
- Tooling: Node 24 LTS; ESLint (+ security rules) + Prettier; Vitest, mongodb-memory-server, Playwright (WBS 1.5.2); CI on every push with tests, code analysis and dependency audit (WBS 1.1.3).
- Internal packages expose a `source` export condition (dev/tests use TS source; `build` emits `dist/`).
- A floor's `plan` is a discriminated union (`kind: 'pdf'`; `'revit'` later, #TASK-33). Calibration stored in PDF page units; the model is stored in metres.
- Dev: `npm run dev` starts an in-process MongoDB replica set when `MONGODB_URI` is unset. Dev users (`apps/api/config/users.dev.json`) `lead@ / electrical@ / electrical2@ / mechanical@ / phe@ / checker@ / admin@neuromep.dev`, password `neuromep-dev`.

## Architecture rules
- Layers 01–06 (Section 7, Figure 7.2). The engine is an isolated package with pure functions, no UI/DB imports, unit-tested (engine coverage ≥ 90 %, Appendix C vectors).
- The engine runs off the screen thread (Web Worker); the live load table uses aggregation only (10.2 step 2).
- A missing or out-of-range table value never becomes 0 or 1 — the element is blocked with a code (V-14). TBC demand factors are the stated exception (E1901).
- A project records its rule-pack version. Export files never overwrite (`_v1`, `_v2`).

## Working rules
- Follow the WBS order; if the design doc or WBS is unclear, ask before building.
- Use the stack in D-14. If a choice is not obvious (e.g. a library), propose it and wait for approval.
- Keep terminology from the glossary (Appendix A). Every shell command shown to the user gets a one-line comment.
- Before finishing a task: run tests, update this file if any decision changed, add a CHANGELOG line.
