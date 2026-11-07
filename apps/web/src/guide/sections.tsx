import type { ReactNode } from 'react';
import { CalcButton } from './CalcButton';
import {
  BusbarTable,
  ChecksTable,
  ComponentTable,
  DemandMethodTable,
  DeviceTables,
  ErrorTable,
  FeedMatrix,
  LoadTypeTable,
  RulePackDefaults,
  SiteDefaults,
  SourceDataTable,
} from './reference';

/**
 * The NeuroMEP user guide (user request 7 Nov 2026): every page, component, rule and calculation,
 * written for engineers and for readers outside the electrical field. Facts come from the design
 * document, the decisions in CLAUDE.md and the code; the tables in reference.tsx are generated.
 */

export interface GuideSection {
  id: string;
  group: string;
  title: string;
  body: ReactNode;
}

const Note = ({ children }: { children: ReactNode }) => <p className="guide-note">{children}</p>;
const Rule = ({ children }: { children: ReactNode }) => <p className="guide-rule">{children}</p>;
const Term = ({ children }: { children: ReactNode }) => <strong>{children}</strong>;

export const SECTIONS: GuideSection[] = [
  // ===== Getting started ======================================================================
  {
    id: 'what-is-neuromep',
    group: 'Getting started',
    title: 'What NeuroMEP is',
    body: (
      <>
        <p>
          NeuroMEP is a web application for MEP (Mechanical, Electrical, Plumbing / PHE) design
          engineers. It replaces drawing the electrical network by hand and sizing it in the
          CableSizer Excel workbook.
        </p>
        <p>In NeuroMEP you:</p>
        <ol>
          <li>upload the architectural floor plans (PDF) of a building;</li>
          <li>place the electrical equipment on each floor (transformers, panels, boards...);</li>
          <li>connect them with feeders (cables), like drawing a network diagram;</li>
          <li>enter the loads of the distribution boards;</li>
          <li>
            press <Term>Cable Size</Term>: NeuroMEP chooses every breaker and cable and checks them
            against the rules (current, voltage drop, short circuit, minimum sizes...);
          </li>
          <li>download the single-line diagram, panel schedules and calculation sheets.</li>
        </ol>
        <h3>What Phase 1 covers</h3>
        <p>
          The <Term>low-voltage (LV) distribution</Term> of a building: from the supply (utility,
          transformer, generator through an ATS, UPS) through the main panels (LV Panel / MDB),
          busbar risers and sub-main boards (SMDB / MCC) down to{' '}
          <Term>the cable feeding each distribution board (DB)</Term>. A DB is the end of the
          network: you enter its total load; its final circuits (sockets, lights) are not designed
          in Phase 1. Mechanical and PHE equipment only provide their electrical data.
        </p>
        <Note>
          The calculations follow the rules verified in the design document (Section 10) and the
          CableSizer v1.1 tables the engineers use today, with the Dubai (DEWA) rule pack.
        </Note>
      </>
    ),
  },
  {
    id: 'how-it-works',
    group: 'Getting started',
    title: 'How it works - the workflow',
    body: (
      <>
        <p>A project goes through five pages, shown as tabs along the top:</p>
        <ol>
          <li>
            <Term>All Projects</Term> - pick a project (or the Technical Lead creates one).
          </li>
          <li>
            <Term>Import File</Term> - the Technical Lead fills in the project set-up: details, site
            conditions, calculation set-up (region, demand method, checks...), number of floors,
            floor plan PDFs and who works on the project.
          </li>
          <li>
            <Term>Floor Setup</Term> - for each floor: open and calibrate the plan, place the
            components, draw the feeders, enter the loads. The <Term>Building</Term> button switches
            to the Building tab: the risers that carry power between floors, the network checks, the{' '}
            <Term>Cable Size Calculator</Term> for the whole building and the riser cost.
          </li>
          <li>
            <Term>Schematic</Term> - the single-line diagram of each transformer, drawn from your
            model; download it as PDF.
          </li>
          <li>
            <Term>Output</Term> - panel schedules, busbar schedules, the calculation sheet and the
            generator load analysis; preview and download as Excel or PDF.
          </li>
        </ol>
        <p>
          Tabs open in order: a later tab stays grey until you press <Term>Next</Term> on the page
          before. Earlier tabs can always be reopened. If you change something on an earlier page
          that affects later work, NeuroMEP asks you to confirm and lists what is affected.
        </p>
        <h3>How power flows in the model</h3>
        <p>
          Power always flows <Term>downstream</Term>, from a source to the loads:
        </p>
        <pre className="guide-flow">
          {`Utility (EB / RMU) ─► Transformer ─► LV Panel / MDB ─┬─► Riser (busbar) ─► tap-off box ─► SMDB / MCC / DB   (other floors)
                                                     ├─► SMDB ─► DB, isolator, connection unit
                                                     ├─► MCC ─► isolator ··· pump / fan  (equipment, linked by Fed from)
                                                     ├─► DB   (end of the Phase 1 network: enter its load)
                                                     └─► ATS normal input ─┐
                              Generator / UPS ─► ATS standby input ─┴─► ATS ─► essential / FLS board ─► ...`}
        </pre>
        <p>
          Normally each component has one supply (a main panel two incomers). Loads add up going{' '}
          <Term>upstream</Term>: each feeder carries the demand of everything below it, and that
          demand decides its breaker and cable.
        </p>
      </>
    ),
  },
  {
    id: 'roles',
    group: 'Getting started',
    title: 'Who can do what',
    body: (
      <>
        <table className="guide-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Can</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Technical Lead</th>
              <td>
                Create and import projects; fill in Import File; edit every layer; reopen a floor
                flagged done; change demand factors and calculation set-up.
              </td>
            </tr>
            <tr>
              <th scope="row">Electrical engineer</th>
              <td>
                On projects they are assigned to: the electrical layer (boards, feeders, loads,
                risers), Cable Size, the generator load analysis; upload and calibrate floor plans.
              </td>
            </tr>
            <tr>
              <th scope="row">Mechanical / PHE engineer</th>
              <td>
                Their own layer: Mechanical Equipment / PHE Equipment and its electrical data;
                upload and calibrate plans.
              </td>
            </tr>
            <tr>
              <th scope="row">Checker, System Administrator</th>
              <td>See every project (read only for the model).</td>
            </tr>
          </tbody>
        </table>
        <p>
          Engineers see only the projects they created or are assigned to (Import File,
          &quot;Discipline Engineer Assignments&quot;). Each layer is protected on the server: a
          change to another discipline&apos;s components is refused (E1002); Project Set-up changes
          by anyone but the Lead are refused (E0301).
        </p>
      </>
    ),
  },
  {
    id: 'screen',
    group: 'Getting started',
    title: 'The screen and the toolbar',
    body: (
      <>
        <p>The toolbar is the same on every page; buttons that do nothing on a page are grey.</p>
        <table className="guide-table">
          <tbody>
            <tr>
              <th scope="row">Open</th>
              <td>
                Floor Setup: upload the floor plan PDF of the floor in the floor picker, import DB
                loads from Excel, or download the load template. Import File: open a project file
                (.json) as a new project, or download this project as a file.
              </td>
            </tr>
            <tr>
              <th scope="row">Save / Sync</th>
              <td>
                Save stores your changes. NeuroMEP saves only when you click Save: a blue
                &quot;Unsaved changes&quot; line shows there is something to save, and leaving the
                project asks first (Save and leave / Leave without saving / Stay). Moving between
                the tabs of a project keeps your changes without saving them. Sync loads the latest
                saved project with everyone&apos;s changes; with unsaved changes it asks you to save
                first, so it never throws your work away.
              </td>
            </tr>
            <tr>
              <th scope="row">Floor picker</th>
              <td>Chooses the floor shown on Floor Setup and Schematic.</td>
            </tr>
            <tr>
              <th scope="row">Clear</th>
              <td>Removes the components of your layer from the current floor (asks first).</td>
            </tr>
            <tr>
              <th scope="row">Undo / Redo</th>
              <td>Steps back and forward through your edits.</td>
            </tr>
            <tr>
              <th scope="row">Zoom In / Zoom Out / Reset</th>
              <td>Zoom the floor plan; Reset fits it to the screen.</td>
            </tr>
            <tr>
              <th scope="row">Bot / Smart - AI</th>
              <td>Shown for the future; not active in this release.</td>
            </tr>
            <tr>
              <th scope="row">Building</th>
              <td>Floor Setup: switches to the Building tab and back.</td>
            </tr>
            <tr>
              <th scope="row">Status</th>
              <td>
                Floor status per discipline: a pill = in progress, a flag = done and locked, an X =
                not started. From the Status dialog you flag a floor done for your layer.
              </td>
            </tr>
            <tr>
              <th scope="row">Back / Next</th>
              <td>Move between the tabs; Next opens the following tab.</td>
            </tr>
            <tr>
              <th scope="row">Help</th>
              <td>Opens this guide at the section for the page you are on.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Messages appear at the top of the page. Each problem carries a code such as E1801 - see{' '}
          <a href="#errors">Errors and warnings</a> for every code and what to do.
        </p>
      </>
    ),
  },

  // ===== Pages ===============================================================================
  {
    id: 'login',
    group: 'Pages',
    title: 'Login and All Projects',
    body: (
      <>
        <p>
          Sign in with your email and password. After 5 wrong passwords for one email (or 20 from
          one computer) within 15 minutes, sign-in is locked for 15 minutes (E0103). A session lasts
          12 hours; Sign Out ends it.
        </p>
        <p>
          <Term>All Projects</Term> shows a card per project with its status. Click a card to open
          the project on the page you last worked on. Only the Technical Lead can create a new
          project or import one from a file.
        </p>
        <p>
          The Technical Lead deletes a project with the bin icon on its card and confirms by typing
          the project&apos;s name. Deleting removes it for everyone - floors, plans, components,
          feeders, risers and results - and cannot be undone, so download it first if it may be
          needed again. A copy (a project file imported again, or Save as new project) never takes
          an existing name: it becomes name_duplicated, then name_duplicated_2, with its own id.
        </p>
      </>
    ),
  },
  {
    id: 'import-file',
    group: 'Pages',
    title: 'Import File - project set-up',
    body: (
      <>
        <p>
          Filled in by the Technical Lead before modelling starts. Next is enabled only when every
          required field is valid; the page lists what is missing.
        </p>
        <h3>Project details</h3>
        <p>
          Name, location, client, plot reference, design stage, project category and the{' '}
          <Term>plot load allocation</Term> (kVA or kW from the utility - the building&apos;s
          maximum demand is compared with it, E2802).
        </p>
        <h3>Site conditions</h3>
        <p>
          Ambient air and ground temperatures and soil thermal resistivity, used to derate cables.
          Rule-pack defaults (Dubai):
        </p>
        <SiteDefaults />
        <h3>Calculation set-up</h3>
        <ul>
          <li>
            <Term>Region</Term> - loads the rule pack (Dubai v1): voltages, breaker ratings, DEWA
            minimum sizes, limits.
          </li>
          <li>
            <Term>Upstream short-circuit capacity (MVA)</Term> - the strength of the utility supply
            at the transformer&apos;s primary; it sets the maximum fault currents.
          </li>
          <li>
            <Term>Demand method</Term> - Dubai Non-Emaar (default), Dubai Emaar, or Manual. See{' '}
            <a href="#calc-demand">Demand</a>.
          </li>
          <li>
            <Term>Busbar Manufacturer</Term> - Gersan, Powerbar or Schneider; their ratings and
            impedances size the risers and busbar feeders.
          </li>
          <li>
            <Term>Transformer Loading - Limit to 80 %</Term> - warns when a transformer is loaded
            above 80 % instead of 100 %.
          </li>
          <li>
            <Term>Load Power Factor</Term> - the power factor of each load type (rule-pack values,
            the Lead may change them).
          </li>
          <li>
            <Term>Demand factors</Term> - per load type and per demand category (Manual method), and
            the SMDB level factor.
          </li>
          <li>
            <Term>Checks</Term> - Current Carrying Capacity and Voltage Drop are always on;
            Short-circuit, Let-through energy and Earth-fault loop can be ticked. A check not ticked
            shows &quot;Not calculated - not selected on Page 1&quot;.
          </li>
        </ul>
        <h3>Floors and plans</h3>
        <p>
          Under <Term>No of Floors</Term> enter the No of Basements, GF (ground levels: 1 gives
          &quot;Ground Floor&quot;, 2 gives &quot;Ground Floor 1&quot; and &quot;Ground Floor
          2&quot;), the No of Podium levels and the No of Typical floors (required). They create the
          floor list from the lowest basement up. Upload the plan PDF of each floor here or later on
          Floor Setup: one page, up to 20 MB (E0601 - E0604).
        </p>
        <ul>
          <li>
            <Term>Typical floors</Term> are identical floors: upload one plan on Floor Setup and
            choose &quot;All typical floors&quot; to use it on every one of them; calibrating it
            once calibrates them all. Then use Replicate floor to copy the components.
          </li>
          <li>
            <Term>Mechanical floor refs</Term> (optional) choose which floors above ground are
            mechanical floors (e.g. the 10th and 20th): one row to start, + Add mechanical floor for
            more, x to remove one. They stay in the floor list but leave the typical set, so they
            keep their own plan.
          </li>
        </ul>
        <h3>Discipline assignment</h3>
        <p>
          Assign at least one Electrical engineer; Mechanical and PHE engineers are optional. Only
          assigned engineers see and edit the project.
        </p>
        <Rule>
          Changing a calculation input after modelling has started asks for confirmation, lists what
          is affected, and marks the Cable Size results Out of date.
        </Rule>
      </>
    ),
  },
  {
    id: 'floor-setup',
    group: 'Pages',
    title: 'Floor Setup - plans, components, feeders and loads',
    body: (
      <>
        <h3>1. Open and calibrate the plan</h3>
        <ol>
          <li>Choose the floor in the floor picker.</li>
          <li>
            <Term>Open &gt; Floor plan (PDF)</Term> uploads its plan (one page, up to 20 MB).
          </li>
          <li>
            The first time a plan is shown, NeuroMEP asks you to <Term>calibrate</Term> it: click
            two points whose real distance you know and type that distance in metres. Or use the
            drawing scale (e.g. 1:100 on A1) - marked less reliable.
          </li>
        </ol>
        <Rule>
          Components cannot be placed and feeders cannot be drawn until the plan is calibrated
          (E0701): every cable length is measured on the plan with this scale.
        </Rule>
        <h3>2. Place components</h3>
        <p>
          The <Term>Component Library</Term> on the left lists every item (see{' '}
          <a href="#components">Components</a>). Drag an item onto the plan, or click it and then
          click the plan. Each component gets an automatic tag (e.g. SMDB-1F) that you can change -
          tags are unique. Drag a component to move it, drag a corner of the selected symbol to
          resize it, press Delete to remove it. Press Escape to leave a tool.
        </p>
        <h3>Select, rotate, copy and replicate</h3>
        <ul>
          <li>
            <Term>Change type</Term>: the Name dropdown of the Engineering Property turns a
            component into another type (e.g. EMDB to ESMDB, MDB to SMDB) without deleting its
            feeders. Loads and the properties the new type also has are kept, and the tag prefix
            follows (EMDB-... becomes ESMDB-...). There is no EMDB / ESMDB / EMCC item in the
            library: place an MDB / SMDB / MCC and change its type.
          </li>
          <li>
            <Term>Isolator labels</Term>: under its tag an isolator or connection unit shows its
            rating and poles (&quot;63 A TP&quot;, &quot;- A&quot; until Cable Size), the equipment
            it feeds and the board feeding it.
          </li>
          <li>
            <Term>Select several</Term>: Shift or Ctrl + click adds a component; Shift + drag on the
            empty plan draws a box; Ctrl + A selects all components of your layer on the floor.
            Dragging one of them moves the whole selection, feeders included.
          </li>
          <li>
            <Term>Rotate</Term>: select a component and drag the round rotate handle off its
            top-right corner to any angle (the angle shows while you drag; hold Shift for 15°
            steps). R or Rotate 90° in the bar above the plan turns a selection 90°; Rotation (°) in
            the Engineering Property takes an exact angle. Rotation only changes the drawing, never
            a calculation.
          </li>
          <li>
            <Term>Copy / Paste</Term>: Ctrl + C, then Ctrl + V on this floor (2 m away) or on
            another floor chosen in the floor picker - at the same place on the sheet, worked out
            with that floor&apos;s own calibration, so the copies sit where they were drawn even
            when the plans were calibrated differently. Copies keep every property and load and get
            the next free tags of that floor (DB-GF-01 on floor 5 becomes DB-5-01). Feeders between
            copied components are copied; a feeder to a board outside the copy is not, so connect
            the copy&apos;s supply again.
          </li>
          <li>
            <Term>Replicate floor…</Term> copies all components of your layer on this floor to the
            floors you tick (only floors with a calibrated plan; &quot;Tick all typical floors&quot;
            ticks the typical set), at the same place on each sheet. A floor that already has
            components asks: add alongside, replace them, or skip that floor. Risers and Cable Size
            results are not copied: connect the copies to their riser in the Building tab and press
            Cable Size.
          </li>
        </ul>
        <h3>3. Draw feeders</h3>
        <ol>
          <li>
            Click <Term>Feeder</Term> in the library. The first time, choose the cable construction
            (cores, conductor, insulation, armour, installation method, grouping...); it is used for
            the next feeders until you change it.
          </li>
          <li>Click the component the feeder starts from (the board that supplies).</li>
          <li>
            Click on the plan to add bends (the route is drawn with right angles); Backspace removes
            the last bend.
          </li>
          <li>Click the component it feeds. The feeder gets a tag, a way number and a length.</li>
        </ol>
        <Rule>
          Any component may feed any other - you decide; the Engineering Property shows the usual
          connections and notes an unusual one (see <a href="#hierarchy">Usual connections</a>).
          Only a loop is refused (E1401). Feeders are drawn on one floor; power goes between floors
          through risers (Building tab).
        </Rule>
        <p>
          Select a feeder to change it in the right panel: Cable or Busbar feeder, construction, and{' '}
          <Term>locks</Term> - a locked size, number of runs or ECC is only checked, never changed
          by Cable Size.
        </p>
        <h3>4. Engineering Property and loads</h3>
        <p>
          Select a component to see its <Term>Engineering Property</Term> on the right: tag,
          description, location and the fields of its type (kVA of a transformer, power factor and
          demand category of a DB, load category, earth leakage...).
        </p>
        <ul>
          <li>
            <Term>DB loads</Term>: open the loads of a DB and add lines - kW on L1 / L2 / L3, or
            area (m²) x W/m² on one phase or three - each with a load type. A DB without load is
            reported (E1501) and its feeder waits (&quot;Awaiting load&quot;).
          </li>
          <li>
            <Term>Import loads from Excel</Term>: Open &gt; Download the DB load template, fill it,
            then Open &gt; DB loads from Excel. NeuroMEP shows what will change before importing.
          </li>
          <li>
            <Term>Isolators / connection units</Term> stand for one piece of equipment: enter its
            load on them, or let mechanical / PHE equipment linked to them bring its load.
          </li>
          <li>
            <Term>Mechanical / PHE equipment</Term>: rated kW, phases, power factor, starter,
            efficiency, load type, FLS; choose its isolator in <Term>Fed from</Term> (a dashed line
            on the plan). Not linked: warning E1803.
          </li>
        </ul>
        <h3>5. The right panel</h3>
        <p>
          It shows the transformer capacity and connected load, the live load table (connected load
          and maximum demand as you type), warnings for the floor (loading, fire-rated feeders,
          unlinked equipment), and after Cable Size the result of the selected item: size, ECC,
          breaker, Ib / In / Iz, voltage drops, fault currents, checks and the full calculation
          trace. Hover over a component or feeder for a summary.
        </p>
        <p>
          In the capacity box, Connected, Demand and Loaded count only loads that reach a
          transformer or generator; load entered on components with no supply yet is listed apart
          (&quot;Not connected yet&quot;). Allowable is the installed transformer kVA x the loading
          limit - the transformers&apos; capacity, shown even before any load is connected.
        </p>
        <h3>6. Cable Size and floor status</h3>
        <p>
          <Term>Cable Size</Term> in the right panel sizes the selected component or feeder, or the
          whole floor when nothing is selected. It is enabled once a riser leads back to a
          transformer (see the Building tab). Any later change marks results{' '}
          <Term>Out of date</Term> (grey) until you press Cable Size again.
        </p>
        <p>
          When your layer of a floor is finished, flag it done in the <Term>Status</Term> dialog:
          the floor is saved and locked for everyone (E1003) until the Technical Lead reopens it. A
          floor cannot be flagged while one of its components has no supply (E1801) or equipment is
          unlinked (E1803).
        </p>
      </>
    ),
  },
  {
    id: 'building-tab',
    group: 'Pages',
    title: 'Building tab - risers, network check, Cable Size Calculator, cost',
    body: (
      <>
        <p>
          Press <Term>Building</Term> on Floor Setup. The left side draws the building: floors from
          the top down to the ground floor, basements at the bottom, the risers on the left and the
          boards of each floor on the right.
        </p>
        <p>
          The Technical Lead can rename a floor: click its name, type the new one, press Enter
          (Escape cancels). Only the name changes; the floor&apos;s tags keep its code (GF, 1, 2
          ...).
        </p>
        <h3>Placing a riser</h3>
        <ol>
          <li>
            In <Term>Riser Design</Term> type the riser&apos;s length (m) - and width - for Riser 1
            (up to three risers). The riser appears in the diagram.
          </li>
          <li>
            Click the riser, then click the component that feeds it on any floor - usually the
            transformer, an LV panel or an MDB. Every component is drawn on its floor: main panels
            and transformers in blue, boards fed by a feeder greyed (hover for what feeds them), a
            riser source outlined in red. Click the riser twice to remove its source; Escape
            cancels. The source box is drawn under the riser; &quot;no supply&quot; when that source
            has no feeder itself.
          </li>
          <li>
            Click a board (usually an SMDB, MCC or DB) on a floor to connect it to a riser tap-off;
            each click moves it to the next riser, then off. A board may have a riser and a feeder
            as well; its Engineering Property then notes the two supplies.
          </li>
        </ol>
        <Rule>
          The riser&apos;s length is what you type (floors have no heights). Its busbar rating comes
          from the project&apos;s Busbar Manufacturer; each tap-off box gets its own breaker.
        </Rule>
        <h3>Network check</h3>
        <p>
          Above the diagram, <Term>Normal</Term> lists every break in the supply chain (E1801: which
          component has no supply, what it cuts off, and the fix), floors without boards (E1802),
          unlinked equipment (E1803) and fire-rated feeder flags (E2701 / E2702).{' '}
          <Term>Standby</Term> shows what the generator supplies.
        </p>
        <h3>Building Summary</h3>
        <ul>
          <li>Floor status per discipline (pill / flag / X).</li>
          <li>
            <Term>Cable Size Calculator</Term> sizes the whole project. It is enabled only when a
            riser leads back to a transformer (the riser is fed from the transformer, or from a
            panel that has a feeder from the transformer); otherwise the reason is shown.
          </li>
          <li>
            <Term>Cost</Term> - the riser cost in AED after the calculator runs; &quot;-&quot; with
            the reasons when a riser has no busbar rating yet.
          </li>
          <li>
            <Term>Save</Term> keeps the results; <Term>Cancel</Term> undoes the Building-tab
            changes; <Term>Demand Factors</Term> reopens the 12 load-type factors (a change marks
            sizes Out of date).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'schematic',
    group: 'Pages',
    title: 'Schematic - single-line diagram',
    body: (
      <p>
        Draws a single-line diagram per transformer from your model as a tree: the transformer at
        the top, every board under the board or riser that feeds it (e.g. Tx &gt; EMDB &gt; ESMDB
        &gt; EDB), the way, breaker and size of the feeder into each board from the last Cable Size
        run, and any other supply of a board - a generator, a second incomer, a riser - drawn as
        &quot;also fed from&quot; beside it. Tick the transformers to show (or All Transformer) and
        press <Term>Download</Term> for a PDF, a page per transformer, named{' '}
        <code>&lt;project&gt;_SLD_v&lt;n&gt;.pdf</code>. Downloads never overwrite: each gets the
        next version number.
      </p>
    ),
  },
  {
    id: 'output',
    group: 'Pages',
    title: 'Output - schedules, calculation sheet, generator analysis',
    body: (
      <>
        <p>
          The <Term>Report Library</Term> on the left chooses what to preview and download:
        </p>
        <ul>
          <li>
            <Term>First Level</Term> (LV Panel / MDB / EMDB / ACB, with the busbar schedules of the
            risers), <Term>Second Level</Term> (SMDB / MCC), <Term>Floor Level</Term> (DBs),{' '}
            <Term>Completed</Term> (all). <Term>Schedule Type</Term> narrows to one board type.
          </li>
          <li>
            <Term>Calculation Sheet</Term> - one row per cable, busbar feeder and riser with every
            calculation step (load, breaker, installation, It / K factors / Iz, ECC, voltage drop,
            short circuit, checks).
          </li>
          <li>
            <Term>Generator Load Analysis</Term> - the one editable report: demand factors per load
            for the three cases (see <a href="#calc-generator">Generator</a>).
          </li>
        </ul>
        <p>
          Choose the <Term>Format</Term> (Excel or PDF) and press <Term>Download</Term>. NeuroMEP
          first runs Cable Size on the whole project. Schedules need a logo, the planned completion
          date, kWh meters per way and the type of meter (asked in the preview each time); the
          generator analysis asks for its title block.
        </p>
        <Rule>
          Schedules are blocked (E3101) while a row is out of date, not calculated, blocked or has a
          failing check - contractors build from them. The calculation sheet is never blocked: it
          records blocked and failing rows as they are.
        </Rule>
        <p>
          File names carry a version: <code>_v1</code>, <code>_v2</code>... - a download never
          overwrites an earlier one.
        </p>
      </>
    ),
  },

  // ===== Components and connections ============================================================
  {
    id: 'components',
    group: 'Components and connections',
    title: 'Components',
    body: (
      <>
        <p>
          Every item of the Component Library, its layer, its legend code (CMP) and what it is for:
        </p>
        <ComponentTable />
        <h3>Load categories</h3>
        <ul>
          <li>
            <Term>Normal</Term> - on the transformer only.
          </li>
          <li>
            <Term>Essential</Term> - must also run on the generator (needs a generator upstream,
            C8).
          </li>
          <li>
            <Term>Critical</Term> - needs a UPS and a generator upstream (C8).
          </li>
          <li>
            <Term>FLS (fire &amp; life safety)</Term> - fire pumps, emergency lighting... Needs a
            generator; every cable from it to the generator should be fire-rated (C9, E2701).
            Setting FLS ticks Fire rated; a new Fire Pumps load makes the item FLS (both can be
            changed).
          </li>
        </ul>
        <h3>Load types and their power factors</h3>
        <LoadTypeTable />
      </>
    ),
  },
  {
    id: 'hierarchy',
    group: 'Components and connections',
    title: 'Usual connections - what normally feeds what',
    body: (
      <>
        <p>
          NeuroMEP does not restrict connections: the electrical engineer decides what feeds what
          (A-20). The table shows the usual connections of the LV hierarchy as guidance; the
          Engineering Property of a component lists what usually feeds it and what it usually feeds,
          and notes a connection that differs - it never blocks one.
        </p>
        <FeedMatrix />
        <ul>
          <li>
            <Term>Feeder direction</Term>: a feeder runs from the component you click first (the
            supply) to the one you click second.
          </li>
          <li>
            <Term>Supplies</Term>: usually one per component, two incomers on an LV panel / MDB.
            More are allowed; each feeder into a component is sized for that component&apos;s whole
            load, and the card notes it.
          </li>
          <li>
            <Term>ATS</Term>: the first feeder into an ATS is its normal input, the second its
            standby input.
          </li>
          <li>
            <Term>Ways</Term>: above 18 outgoing ways the card notes it; there is no maximum.
          </li>
          <li>
            <Term>No loops</Term> - the one connection refused (E1401): a component cannot feed
            something that already feeds it, because Cable Size works the load out from the sources
            down and cannot calculate a circle.
          </li>
          <li>
            Mechanical / PHE equipment is not cabled: it is linked to its isolator or connection
            unit through Fed from.
          </li>
          <li>
            Between floors, power goes through a <Term>riser</Term> (Building tab): any component
            can feed a riser (usually a transformer, LV panel or MDB) and any component can take a
            tap-off (usually an SMDB, MCC or DB).
          </li>
        </ul>
        <p>
          A component with no path back to a source is reported as E1801 in the Building tab, with
          the place where the chain breaks and the fix.
        </p>
      </>
    ),
  },
  {
    id: 'feeders',
    group: 'Components and connections',
    title: 'Feeders - cables and busbar feeders',
    body: (
      <>
        <p>A feeder is a cable (default) or a busbar feeder, chosen in its properties.</p>
        <h3>Cable construction</h3>
        <ul>
          <li>Cores: 1C, 2C, 3C, 4C (single-core cables take AWA armour or none).</li>
          <li>Conductor: copper (Cu) or aluminium (Al).</li>
          <li>
            Insulation: PVC, XLPE, or FR (fire-rated, FP600 type - uses the XLPE values on trays).
          </li>
          <li>Armour: SWA, AWA or none; sheath PVC or LSZH; voltage grade.</li>
          <li>
            Installation method: <Term>B</Term> conduit / trunking, <Term>J</Term> cable tray,{' '}
            <Term>D direct</Term> buried in the ground, <Term>D duct</Term> buried in a duct.
          </li>
          <li>
            Grouping: number of circuits run together, trays, spacing (touching, one or two cable
            diameters on trays; metres when buried) and depth when buried. These set the derating
            factors; a missing value blocks the cable (E2102) - NeuroMEP never guesses.
          </li>
        </ul>
        <h3>Busbar feeder</h3>
        <p>
          A busbar trunking run from a transformer or main panel (TPN+E 600 / 1000 V). Choose
          conductor, IP rating and fire rating; NeuroMEP chooses the rating from the project&apos;s
          busbar manufacturer and checks its voltage drop and withstand.
        </p>
        <h3>Size, runs and ECC</h3>
        <p>
          Cable Size chooses the conductor size (mm²), the number of parallel runs and the earth
          conductor (ECC). Lock any of them in the feeder&apos;s properties to keep your value - it
          is then only checked.
        </p>
      </>
    ),
  },

  // ===== Calculations ===========================================================================
  {
    id: 'calc-overview',
    group: 'Calculations',
    title: 'How Cable Size works',
    body: (
      <>
        <p>
          Sizes are calculated only when you press <Term>Cable Size</Term> (right panel: selected
          item or floor; Building tab: whole project) and before every export. The engine runs in
          the background, in your browser. For each feeder, in this order:
        </p>
        <ol>
          <li>
            <a href="#calc-length">Length</a> from the plan.
          </li>
          <li>
            <a href="#calc-demand">Demand</a> it carries (loads below it x demand factors).
          </li>
          <li>
            <a href="#calc-ib">Design current Ib</a>.
          </li>
          <li>
            <a href="#calc-breaker">Breaker</a> rating In and type.
          </li>
          <li>
            Start at the <a href="#calc-c6">DEWA minimum size</a> for that breaker.
          </li>
          <li>
            <a href="#calc-c1">C1 current-carrying capacity</a> and{' '}
            <a href="#calc-c2">C2 voltage drop</a>: if one fails, move to the next standard size; at
            the largest size, add a parallel run. Sizes go up only; a feeder waits while a feeder
            above it is still changing, so it is not oversized for an upstream drop about to shrink.
            After 50 passes without a stable answer: E2601.
          </li>
          <li>
            <a href="#calc-short-circuit">C3 short circuit</a> (a breaker failing it gets a higher
            breaking capacity, never a bigger cable), C4 / C5 protection, C6 minimum, C7 board
            withstand, C8 / C9 safety and <a href="#calc-ecc">the ECC</a>.
          </li>
        </ol>
        <h3>Result status</h3>
        <table className="guide-table">
          <tbody>
            <tr>
              <th scope="row">Final</th>
              <td>
                Connected to a source, demand factors confirmed and every ticked check complete.
              </td>
            </tr>
            <tr>
              <th scope="row">Provisional</th>
              <td>
                Sized, but something is still open - e.g. demand factors TBC (E1901), device data
                required for C4 / C5 (E2402), upstream not connected.
              </td>
            </tr>
            <tr>
              <th scope="row">Blocked</th>
              <td>
                A value is missing or outside the tables; never filled in with 0 or 1. The code says
                what is missing.
              </td>
            </tr>
            <tr>
              <th scope="row">Awaiting load</th>
              <td>No load entered below it yet.</td>
            </tr>
            <tr>
              <th scope="row">Out of date</th>
              <td>Something changed since the last run: press Cable Size again.</td>
            </tr>
          </tbody>
        </table>
        <p>
          <Term>Sized by</Term> tells which rule set the size: C6 (the minimum was enough), C1
          (current) or C2 (voltage drop).
        </p>
        <p>
          Every result keeps its full trace: inputs, the table values used and each formula with its
          numbers. See it in the right panel, or in the Calculation Sheet on Output.
        </p>
      </>
    ),
  },
  {
    id: 'calc-length',
    group: 'Calculations',
    title: 'Cable length',
    body: (
      <>
        <p>
          The length of a cable is its <Term>route on the plan</Term> converted to metres with the
          floor&apos;s calibration, <Term>plus 5 m</Term> (rule pack) for the ends and vertical
          drops. A riser&apos;s length is the one typed in Riser Design.
        </p>
        <CalcButton example="length" />
      </>
    ),
  },
  {
    id: 'calc-demand',
    group: 'Calculations',
    title: 'Connected load, demand factors and maximum demand',
    body: (
      <>
        <p>
          <Term>Connected load</Term> = everything entered below a point.{' '}
          <Term>Maximum demand (MD)</Term> = connected load x demand factors: not every load runs at
          full power at the same time. Each feeder is sized for the MD it carries.
        </p>
        <h3>Dubai methods (default)</h3>
        <p>
          The category factor is applied <Term>once</Term>, at the LV Panel / MDB / EMDB / ACB, to
          the connected load of each demand category (a load&apos;s category is that of its DB or
          load point). SMDBs apply the SMDB-level factor. Everything else carries 100 %.
        </p>
        <DemandMethodTable />
        <h3>Manual method</h3>
        <p>
          The 12 load-type factors typed on Import File are applied once per board. A factor not
          confirmed yet (TBC) counts as 1.0 and the result stays Provisional (E1901).
        </p>
        <CalcButton example="demand" />
      </>
    ),
  },
  {
    id: 'calc-ib',
    group: 'Calculations',
    title: 'Design current Ib',
    body: (
      <>
        <ul>
          <li>
            <Term>Balanced three-phase</Term> (same kW on L1, L2, L3): Ib = P x 1000 / (√3 x 400 x
            pf).
          </li>
          <li>
            <Term>Single-phase or unbalanced</Term>: Ib = largest phase kW x 1000 / (230 x pf); the
            neutral current is worked out too.
          </li>
          <li>
            <Term>Motor-driven equipment</Term>: input kW = rated kW / efficiency, then as above.
            The same applies to a motor typed on an isolator or connection unit: choose its Starter
            and enter its Efficiency (required with a starter, E2003).
          </li>
        </ul>
        <p>
          pf is the power factor of the load: the DB&apos;s own value when entered, else the
          load-type value, else the default load power factor. A missing power factor or efficiency
          blocks the feeder (E2003) - it is never assumed.
        </p>
        <CalcButton example="ib-three" />
        <CalcButton example="ib-single" />
        <CalcButton example="ib-equipment" />
      </>
    ),
  },
  {
    id: 'calc-breaker',
    group: 'Calculations',
    title: 'Breaker rating and type',
    body: (
      <>
        <p>
          In = the lowest standard rating at or above Ib. MCB up to 63 A, MCCB up to 630 A, ACB from
          800 A (interim limits until the breaker catalogue, OI-03). The breaking capacity (Icu) is
          the lowest of the type that withstands the fault level (C3).
        </p>
        <CalcButton example="breaker" />
      </>
    ),
  },
  {
    id: 'calc-c1',
    group: 'Calculations',
    title: 'C1 Current-carrying capacity',
    body: (
      <>
        <p>
          A cable heats up with current; its rating depends on how it is installed. Iz = It x K1 x
          K2 x Kr x K3 x runs must be at least In:
        </p>
        <ul>
          <li>
            <Term>It</Term> - tabulated rating for the size, construction and method (CableSizer /
            Ducab tables).
          </li>
          <li>
            <Term>K1</Term> - temperature (air for trays and conduit, ground when buried).
          </li>
          <li>
            <Term>K2</Term> - grouping with other circuits.
          </li>
          <li>
            <Term>Kr</Term> - soil thermal resistivity, <Term>K3</Term> - depth (buried cables).
          </li>
        </ul>
        <p>
          Between table steps the more conservative step is used. Values outside the tables block
          the cable (E2101 / E2102).
        </p>
        <CalcButton example="c1" />
      </>
    ),
  },
  {
    id: 'calc-c2',
    group: 'Calculations',
    title: 'C2 Voltage drop',
    body: (
      <>
        <p>
          Every cable loses some voltage. The drop is added up from the transformer to each board,
          and the total must stay within the limit of the board fed: MDB / SMDB / MCC / busduct 2 %,
          DB 2.5 %, motors 4 %.
        </p>
        <CalcButton example="c2" />
      </>
    ),
  },
  {
    id: 'calc-c6',
    group: 'Calculations',
    title: 'C6 Minimum size and the earth conductor (ECC)',
    body: (
      <>
        <p>
          DEWA sets a minimum cable for each breaker rating; Cable Size starts from it, so a cable
          is never smaller.
        </p>
        <p id="calc-ecc">
          The <Term>earth conductor (ECC)</Term> is a separate Cu / PVC conductor per run, from the
          CableSizer CPC table for the phase size. A size the table does not list blocks the cable
          (E2101).
        </p>
        <CalcButton example="c6" />
      </>
    ),
  },
  {
    id: 'calc-short-circuit',
    group: 'Calculations',
    title: 'C3 Short circuit, C7 board withstand',
    body: (
      <>
        <p>
          A fault lets a very high current flow until the breaker opens. NeuroMEP works out the
          maximum fault current <Term>Ik&quot; max</Term> at every breaker (it must break it - C3)
          and the minimum <Term>Ik&quot; min</Term> at the far end (for protection). The impedance
          of the utility, transformer, generator, cables and busbars limits it. Motors at the main
          LV panel add their own contribution.
        </p>
        <p>
          <Term>C7</Term>: a board&apos;s short-time withstand Icw and peak Ipk (entered on the
          board) must be at least the fault level there.
        </p>
        <CalcButton example="short-circuit" />
      </>
    ),
  },
  {
    id: 'calc-protection',
    group: 'Calculations',
    title: 'C4 Let-through energy and C5 earth-fault loop',
    body: (
      <>
        <p>
          <Term>C4</Term>: the energy let through by the breaker during a fault (I²t) must not
          exceed what the cable withstands, k²S² (k from the insulation, S the size). NeuroMEP works
          out k²S² and how long the cable withstands the fault.
        </p>
        <p>
          <Term>C5</Term>: during an earth fault the loop impedance Zs (source + phase conductor +
          earth conductor / armour, at fault temperature) must be low enough for the breaker to trip
          in time: Zs &lt;= 0.95 x 230 / Ia. Behind an earth-leakage device (ELCB) it is not
          required. An ELS (earth leakage sensing) with an alarm only signals, it does not trip, so
          C5 is still checked behind it.
        </p>
        <Note>
          Both need the breaker&apos;s let-through and trip data, which come with the breaker
          catalogue (OI-03). Until then they end in &quot;Device data required&quot; (E2402) and the
          result stays Provisional; the cable side is shown in the trace.
        </Note>
      </>
    ),
  },
  {
    id: 'calc-riser',
    group: 'Calculations',
    title: 'Risers and riser cost',
    body: (
      <>
        <p>
          A riser is a busbar trunking running up the building. It carries the demand of the boards
          on its tap-offs; its rating comes from the project&apos;s busbar manufacturer. Because the
          load is spread along it, its voltage drop uses k = (n + 1) / 2n for n tap-offs. The boards
          below take the riser&apos;s real drop.
        </p>
        <CalcButton example="riser" />
        <h3>Cost</h3>
        <p>
          Each riser costs its busbar rating (A) x 2.2 AED, one price per riser whatever its length.
          Transformers and busbar feeders are not included.
        </p>
        <CalcButton example="cost" />
      </>
    ),
  },
  {
    id: 'calc-loading',
    group: 'Calculations',
    title: 'Transformer loading and plot load',
    body: (
      <>
        <p>
          Each transformer&apos;s maximum demand (kVA) is compared with its rating x the loading
          limit (100 %, or 80 % when ticked on Import File) - warning E2801. The maximum demand of
          the whole project (each load once) is compared with the plot load allocation - E2802.
        </p>
        <CalcButton example="loading" />
      </>
    ),
  },
  {
    id: 'calc-generator',
    group: 'Calculations',
    title: 'Generator load analysis',
    body: (
      <>
        <p>
          On Output, each generator gets a sheet of every load it supplies, panel by panel, with
          three demand factors you can edit: Normal, Case 1 power failure, Case 2 fire. Starting
          values are 1.0 for normal and power failure; for fire 1.0 on FLS loads and 0 on the
          others. Values you have not edited are highlighted.
        </p>
        <CalcButton example="generator" />
      </>
    ),
  },
  {
    id: 'calc-safety',
    group: 'Calculations',
    title: 'C8 / C9 safety rules and fire-rated cables',
    body: (
      <ul>
        <li>
          <Term>C8</Term>: an essential or FLS load needs a generator upstream; a critical load a
          UPS and a generator.
        </li>
        <li>
          <Term>C9 / E2701</Term>: every feeder on the path from an FLS load to the generator should
          be fire-rated (warning; you may still choose otherwise).
        </li>
        <li>
          <Term>E2702</Term>: a fire-rated feeder with no FLS load below it (warning - possibly an
          unnecessary cost).
        </li>
        <li>
          An isolator feeding FLS equipment counts as FLS. NeuroMEP never changes a cable by itself
          - it only flags.
        </li>
      </ul>
    ),
  },

  // ===== Reference ===============================================================================
  {
    id: 'checks',
    group: 'Reference',
    title: 'Check codes C1 - C12',
    body: <ChecksTable />,
  },
  {
    id: 'errors',
    group: 'Reference',
    title: 'Errors and warnings',
    body: (
      <>
        <p>
          Every code NeuroMEP can show. &quot;Blocks&quot; stops the item from being sized or
          exported until fixed; &quot;Warning&quot; lets you continue.
        </p>
        <ErrorTable />
      </>
    ),
  },
  {
    id: 'mistakes',
    group: 'Reference',
    title: 'Common mistakes and how to fix them',
    body: (
      <table className="guide-table">
        <thead>
          <tr>
            <th>What you see</th>
            <th>Why</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cable Size / Cable Size Calculator is grey</td>
            <td>No riser leads back to a transformer (A-07).</td>
            <td>
              Building tab: type a riser length, click the riser, then click the transformer or a
              panel fed from it.
            </td>
          </tr>
          <tr>
            <td>Cannot place components (E0701)</td>
            <td>The plan is not calibrated.</td>
            <td>Calibrate it with two points and a known distance.</td>
          </tr>
          <tr>
            <td>A feeder is refused (E1401)</td>
            <td>It would make a loop: the component already feeds the one you started from.</td>
            <td>
              Feed it from a board that is not below it; see{' '}
              <a href="#hierarchy">Usual connections</a>.
            </td>
          </tr>
          <tr>
            <td>E1801 in the Building tab</td>
            <td>A component or riser has no path to a source.</td>
            <td>Follow the fix given in the message; usually a missing feeder or riser source.</td>
          </tr>
          <tr>
            <td>&quot;Awaiting load&quot;</td>
            <td>No load entered on the DBs below.</td>
            <td>Enter the DB loads (or import them from Excel).</td>
          </tr>
          <tr>
            <td>Blocked with E2102</td>
            <td>Grouping, trays, spacing or depth missing, or a combination not in the tables.</td>
            <td>
              Complete the feeder&apos;s construction; change the installation if outside the
              tables.
            </td>
          </tr>
          <tr>
            <td>Blocked with E2003</td>
            <td>Power factor or motor efficiency missing.</td>
            <td>Enter it on the DB or equipment.</td>
          </tr>
          <tr>
            <td>Results grey &quot;Out of date&quot;</td>
            <td>Something changed after the last run.</td>
            <td>Press Cable Size again.</td>
          </tr>
          <tr>
            <td>Schedules will not download (E3101)</td>
            <td>A row is out of date, blocked or failing a check.</td>
            <td>Fix the items listed, then download again.</td>
          </tr>
          <tr>
            <td>Riser cost shows &quot;-&quot;</td>
            <td>A riser has no busbar rating: no manufacturer, load or length.</td>
            <td>The reasons are listed under the cost.</td>
          </tr>
          <tr>
            <td>Someone else saved (E0802)</td>
            <td>
              Someone saved the project after you opened it. Your changes are still in your tab.
            </td>
            <td>
              Choose in the red banner: Save my version (overwrite) makes your tab the latest
              version; Save as new project (Technical Lead) keeps both; Download my copy saves your
              tab to a .json file; Reload discards your changes and loads theirs.
            </td>
          </tr>
          <tr>
            <td>Cannot edit a floor (E1003)</td>
            <td>It is flagged done for that layer.</td>
            <td>Ask the Technical Lead to reopen it.</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: 'rule-pack',
    group: 'Reference',
    title: 'Rule pack values (Dubai v1)',
    body: (
      <>
        <p>
          The values NeuroMEP uses. The Technical Lead may override some on Import File; TBC means
          not given yet.
        </p>
        <RulePackDefaults />
        <h3>Breakers and cable sizes</h3>
        <DeviceTables />
        <h3>Transformers and generators</h3>
        <SourceDataTable />
        <h3>Busbars</h3>
        <BusbarTable />
      </>
    ),
  },
  {
    id: 'limitations',
    group: 'Reference',
    title: 'Limitations of this release',
    body: (
      <ul>
        <li>
          DB final circuits (sockets, lights) are not designed - Phase 1 ends at the DB feeder.
        </li>
        <li>
          C4 / C5 wait for the breaker catalogue (E2402); breaker Im, curves and I²t are not
          available (OI-03).
        </li>
        <li>C10 (harmonics) and C11 (motor starting dip) are not calculated yet.</li>
        <li>
          Blocked until data is given: aluminium cables from 25 mm² (voltage drop), fire-rated cable
          in conduit or buried, 2-core cables on trays (OI-37), the 400 mm² earth conductor with a
          PVC ECC (OI-36), busbars below 800 A or aluminium, riser C7.
        </li>
        <li>The fault duty of a riser tap-off box breaker is not calculated yet.</li>
        <li>The Bot and Smart-AI buttons are not active; Revit exchange comes in a later phase.</li>
        <li>Mechanical and PHE checks across separate files come in Phase 2.</li>
      </ul>
    ),
  },
  {
    id: 'glossary',
    group: 'Reference',
    title: 'Glossary',
    body: (
      <dl className="guide-glossary">
        {(
          [
            [
              'ACB / MCCB / MCB',
              'Air / moulded-case / miniature circuit breaker - by size, largest to smallest.',
            ],
            [
              'ATS',
              'Automatic Transfer Switch - moves the load to the generator on power failure.',
            ],
            [
              'Busbar / busduct / riser',
              'Copper or aluminium bars in a casing carrying large currents; a riser runs up the building with tap-offs per floor.',
            ],
            ['DB / SMDB / MDB', 'Distribution board / sub-main / main distribution board.'],
            [
              'DEWA',
              'Dubai Electricity and Water Authority - its regulations set minimum sizes and limits.',
            ],
            ['Demand factor', 'The share of the connected load expected to run at the same time.'],
            ['ECC / CPC', 'Earth continuity / circuit protective conductor - the earth wire.'],
            ['FLS', 'Fire and life safety (fire pumps, emergency lighting...).'],
            ['Ib', 'Design current - the current the circuit carries.'],
            ['In', 'Breaker rating.'],
            ['Iz', 'Current the cable can carry where it is installed.'],
            [
              'Icu / Icm / Icw / Ipk',
              'Breaking, making, short-time withstand and peak withstand of a device or board.',
            ],
            ['Ik" / ip', 'Initial symmetrical short-circuit current / its peak.'],
            ['kVA / kW / pf', 'Apparent power / real power / power factor = kW / kVA.'],
            ['MD / TCL', 'Maximum demand / total connected load.'],
            ['Runs', 'Cables in parallel making up one feeder.'],
            ['SPN / TPN', 'Single-phase and neutral / three-phase and neutral.'],
            ['Tap-off box', 'A unit plugged into a riser with a breaker feeding one board.'],
            ['uk / ur', 'Transformer impedance / resistance voltage (%).'],
            ['Vd', 'Voltage drop.'],
          ] as const
        ).map(([t, d]) => (
          <div key={t}>
            <dt>{t}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    ),
  },
];
