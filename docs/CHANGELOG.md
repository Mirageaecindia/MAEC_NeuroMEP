# NeuroMEP Changelog

Record every change to the design document, CLAUDE.md decisions or reference data here (newest first).

| Date | Version | Change | Affects |
|---|---|---|---|
| 2026-10-22 | Doc v0.8 | Code aligned with v0.8: Working Directory removed (D-18); slide load-type labels, TBC demand-factor banner and engine helpers (D-19); Dubai rule pack per 12.2 (PFC target 0.95, cmax/cmin, disconnection times); CableSizer flags cite V-09 / V-14 / V-15; calibration snaps to vector line endpoints with "zoom in" guidance. | Page 1, rule packs |
| 2026-10-22 | Doc v0.8 | Design doc replaced by the verified v0.7 freeze candidate (Word) converted to Markdown, merged with: D-13 wording, project access rules, FR-02 import by Technical Lead, Page 1 validation ranges, TBC demand factors (D-19: banner, engine 1.0 + Provisional), Working Directory removed (D-18), slide load-type labels, Revit as future plan kind. Section numbers changed (calc spec now 10, data dictionary 12, open items/decisions 18). CLAUDE.md: D-15 to D-19, #TASK / E-code convention, V-12 note (CableSizer ampacity results never Final). | Whole project |
| 2026-10-22 | Doc v0.7 | Prompt 02 built: Login, project picker, Page 1 (cards 1-7), PDF viewer with two-point / drawing-scale calibration, MongoDB persistence with optimistic locking, GridFS plans, autosave, project JSON import/export. Dubai rule pack v1.0.0 added (TBC values null). No design-doc values changed. | Login, picker, Page 1, api |
| 2026-10-22 | Doc v0.7 | D-13 project picker; Altitude optional (not used in Phase 1, OI-26); only Electrical engineer required. Tooling fixed (npm workspaces, Vitest, MongoDB driver + Zod, ESLint + Prettier, Node 24 LTS). CableSizer runtime tables generated in packages/rulepacks (source JSON unchanged; Appendix E rows flagged for OI-07). | Page 1, project picker, rule packs |
| 2026-10-22 | Doc v0.6 | D-14 tech stack decided (closes OI-27): TypeScript monorepo (apps/web, apps/api, packages/engine, shared, rulepacks), MongoDB Atlas, PDFs in object storage/GridFS, optimistic locking, Revit add-in later. Section 13 and CLAUDE.md updated. | Whole project |
| 2026-10-22 | Doc v0.5 | Page 1 gap review against the current kickoff screen; Section 10.1 gains NEW rows for GF datum level, floor code/name, plan file, plan status, two-point calibration and drawing-scale alternative. | Page 1, data model |
| 2026-10-22 | Doc v0.4 | Design document added to repo as Markdown; CLAUDE.md created; CableSizer lookup tables added under docs/reference. | Whole project |
| 2026-10-21 | Doc v0.4 | Page 1 inputs reduced to the Project Set-up slide + floor levels/heights; calculation defaults moved to rule pack (10.1A). | Page 1 |
| 2026-10-21 | Doc v0.3 | Calculation engine defined as a background service with no page (FR-51). | Engine, all pages |
| 2026-10-21 | Doc v0.2 | Live in-canvas calculation, Provisional/Final status, "Sized by", FR-10 plan replacement with re-calibration and alignment. | Pages 2–4, engine |
| 2026-10-21 | Doc v0.1 | Initial draft. | — |
