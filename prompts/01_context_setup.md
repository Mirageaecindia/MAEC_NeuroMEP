# Prompt 1 — Context set-up (paste this first, before any build work)

You are joining the NeuroMEP project. Do not write or change any code in this task.

1. Read these files completely:
   - `CLAUDE.md` (project memory — stable facts, decisions, working rules)
   - `docs/NeuroMEP_SRS_SDD.md` (design document; version in its header)
   - `docs/CHANGELOG.md`
   - Skim `docs/reference/cablesizer_lookup_rules.json` to understand its structure (functions → rules of `when` conditions → `value`). You do not need to read every rule.
2. Inspect the existing repository: framework, language, folder structure, routing, state management, styling approach, how the existing Login and Import Floor Plan screens are built, and whether any tests exist.
3. Reply with:
   - A summary of the product in your own words (max 10 lines).
   - The five pages and what each one is for.
   - How the calculation engine relates to the pages (it is a background service, not a page).
   - The current stack you found and anything that conflicts with the design document.
   - A list of anything in the design document you find unclear or contradictory, with section numbers.
4. Wait for my confirmation before starting any build task.

Rules for the whole project:
- Treat `docs/NeuroMEP_SRS_SDD.md` as the source of truth. When I say "design doc updated", re-read it and `docs/CHANGELOG.md` before continuing.
- Never invent values for open items (OI-xx); use the interim default in Section 15 or a clearly labelled "TBC" placeholder.
- When a decision changes during our work, update `CLAUDE.md` and add a line to `docs/CHANGELOG.md` in the same task.
