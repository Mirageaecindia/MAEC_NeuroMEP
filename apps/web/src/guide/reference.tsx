import { getRulePack } from '@neuromep/rulepacks';
import {
  CHECK_LABELS,
  CheckCodeSchema,
  DEMAND_CATEGORY_LABELS,
  ERROR_CATALOGUE,
  isPlaceable,
  LIBRARY_ITEMS,
  LOAD_TYPE_LABELS,
  usuallyFeeds,
  type ElementKind,
} from '@neuromep/shared';

/**
 * Reference tables of the user guide, generated from the code itself (library, topology rules,
 * error catalogue, rule pack) so the guide never disagrees with the app.
 */

const pack = getRulePack('dubai', '1.0.0');

/** What each library item is for (plain words; the guide's component reference). */
const PURPOSE: Record<string, { what: string; where: string }> = {
  'eb-utility': {
    what: 'The utility (DEWA) supply at medium voltage. It sits above the transformer; its strength is the upstream fault level entered on Import File.',
    where: 'Floor Setup, usually the ground floor or substation.',
  },
  rmu: {
    what: 'Ring Main Unit - the medium-voltage switchgear of the utility supply. Treated as the utility supply (EB) above the transformer.',
    where: 'Floor Setup, substation.',
  },
  transformer: {
    what: 'Steps the 11 kV supply down to 400 / 230 V; the main source of the LV network. Enter kVA and primary voltage (uk / ur optional - catalogue values are used).',
    where: 'Floor Setup, substation floor.',
  },
  generator: {
    what: 'Standby source for essential and fire & life-safety loads. Feeds the standby input of an ATS (or a main panel directly). Enter its kVA.',
    where: 'Floor Setup, plant room / roof.',
  },
  ats: {
    what: 'Automatic Transfer Switch: two inputs - normal (from the transformer or a main panel) and standby (from a generator or UPS). On a power failure it moves the load to the standby source.',
    where: 'Floor Setup, between the sources and the essential board.',
  },
  'lv-panel': {
    what: 'Main LV switchboard (level 2), fed from a transformer, ATS or generator; up to two incomers. Feeds risers, sub-main boards, MCCs, DBs and isolators. Dubai demand factors are applied here.',
    where: 'Floor Setup, LV room.',
  },
  acb: {
    what: 'ACB panel - a main LV panel with air circuit breakers; same rules as the LV Panel / MDB.',
    where: 'Floor Setup, LV room.',
  },
  mdb: {
    what: 'Main Distribution Board (level 2) - same rules as the LV Panel.',
    where: 'Floor Setup, LV room.',
  },
  smdb: {
    what: 'Sub-Main Distribution Board (level 4), fed from a main panel or a riser tap-off; feeds DBs, isolators and connection units on its floor.',
    where: 'Floor Setup, electrical room of a floor.',
  },
  mcc: {
    what: 'Motor Control Centre (level 4) for pumps, fans and other motors; fed from a main panel or a riser tap-off.',
    where: 'Floor Setup, plant room.',
  },
  db: {
    what: 'Distribution Board - the end of the Phase 1 network. You enter its load (kW per phase or W/m²); NeuroMEP sizes the cable and breaker feeding it, not its final circuits.',
    where: 'Floor Setup, every floor.',
  },
  lighting: {
    what: 'A lighting distribution board (a DB described as Lighting, tag LDB).',
    where: 'Floor Setup, every floor.',
  },
  cable: {
    what: 'The Feeder tool: draws a cable (or busbar feeder) from a board to the component it feeds.',
    where: 'Floor Setup, on one floor.',
  },
  'isolator-sp': {
    what: "Single-phase isolator for one piece of equipment. It carries that equipment's load (typed on it, or from linked mechanical / PHE equipment).",
    where: 'Floor Setup, next to the equipment.',
  },
  'isolator-tp': {
    what: 'Three-phase isolator for one piece of equipment (pumps, AHUs, chillers...). Carries its load like the single-phase isolator.',
    where: 'Floor Setup, next to the equipment.',
  },
  'connection-unit': {
    what: 'Fused connection unit for a small single item of equipment; carries its load.',
    where: 'Floor Setup, next to the equipment.',
  },
  'mechanical-equipment': {
    what: 'Placed by the mechanical engineer: nameplate kW, phases, power factor, efficiency, starter, load type, FLS. Linked to its isolator or connection unit through Fed from (no cable).',
    where: 'Floor Setup, mechanical layer.',
  },
  'phe-equipment': {
    what: 'Placed by the PHE engineer (pumps, water heaters...): same fields as mechanical equipment, linked through Fed from.',
    where: 'Floor Setup, PHE layer.',
  },
};

export function ComponentTable() {
  return (
    <table className="guide-table">
      <thead>
        <tr>
          <th>Component</th>
          <th>Layer</th>
          <th>Legend code</th>
          <th>What it is / why it is used</th>
          <th>Where</th>
        </tr>
      </thead>
      <tbody>
        {LIBRARY_ITEMS.map((item) => (
          <tr key={item.key}>
            <th scope="row">{item.label}</th>
            <td>{item.discipline}</td>
            <td>{isPlaceable(item) ? (item.cmpCode ?? 'none yet') : 'tool'}</td>
            <td>{PURPOSE[item.key]?.what ?? '-'}</td>
            <td>{PURPOSE[item.key]?.where ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Rows and columns of the feed matrix: what may feed what (Section 3). */
const MATRIX: { kind: ElementKind; label: string }[] = [
  { kind: 'eb-utility', label: 'EB / RMU' },
  { kind: 'transformer', label: 'Transformer' },
  { kind: 'generator', label: 'Generator' },
  { kind: 'ats', label: 'ATS' },
  { kind: 'lv-panel', label: 'LV Panel / MDB / ACB' },
  { kind: 'busbar', label: 'Riser (busbar)' },
  { kind: 'tap-off-box', label: 'Tap-off box' },
  { kind: 'smdb', label: 'SMDB' },
  { kind: 'mcc', label: 'MCC' },
  { kind: 'db', label: 'DB / Lighting' },
  { kind: 'isolator', label: 'Isolator / Connection unit' },
];

/** The usual connections (Section 3, guidance only - A-20): a tick where the row usually feeds the column. */
export function FeedMatrix() {
  return (
    <div className="guide-scroll">
      <table className="guide-table matrix">
        <thead>
          <tr>
            <th>Usually feeds →</th>
            {MATRIX.map((c) => (
              <th key={c.kind}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX.map((r) => (
            <tr key={r.kind}>
              <th scope="row">{r.label}</th>
              {MATRIX.map((c) => {
                const ok =
                  usuallyFeeds(r.kind, c.kind) ||
                  (c.kind === 'ats' && ['transformer', 'lv-panel', 'generator'].includes(r.kind));
                return (
                  <td key={c.kind} className={ok ? 'yes' : 'no'}>
                    {ok ? '✓' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHECK_TEXT: Record<string, { when: string; status: string }> = {
  C1: { when: 'Iz (corrected cable rating) is below the breaker rating In.', status: 'Calculated' },
  C2: {
    when: 'The cumulative voltage drop exceeds the limit of the board fed.',
    status: 'Calculated',
  },
  C3: {
    when: 'Ik" max exceeds the breaker Icu, or the peak ip exceeds Icm.',
    status: 'Calculated when Short-circuit is ticked',
  },
  C4: {
    when: 'The let-through energy I²t exceeds what the cable withstands (k²S²).',
    status: 'Cable side worked out; needs breaker data (E2402, OI-03)',
  },
  C5: {
    when: 'The earth-fault loop Zs is too high for the breaker to disconnect in time.',
    status: 'Zs worked out; needs breaker data (E2402, OI-03)',
  },
  C6: { when: 'Size x runs is below the DEWA minimum for the breaker.', status: 'Calculated' },
  C7: {
    when: "A board's Icw / Ipk is below the fault level.",
    status: 'Calculated when Icw / Ipk are entered',
  },
  C8: {
    when: 'An essential / FLS load has no generator on its path (critical: no UPS + generator).',
    status: 'Calculated',
  },
  C9: {
    when: 'A cable on the path from an FLS load to the generator is not fire-rated (warning).',
    status: 'Calculated',
  },
  C10: {
    when: 'High third-harmonic content without neutral derating (warning).',
    status: 'Not calculated in this release',
  },
  C11: {
    when: 'Motor / fire-pump starting voltage dip above the limit (warning).',
    status: 'Not calculated in this release',
  },
  C12: {
    when: 'Transformer / generator above its loading limit, or a board with more than 18 ways (warning).',
    status: 'Shown as E2801 / E2802 and the ways warning',
  },
};

export function ChecksTable() {
  return (
    <table className="guide-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Check</th>
          <th>Fails when</th>
          <th>In this release</th>
        </tr>
      </thead>
      <tbody>
        {CheckCodeSchema.options.map((c) => (
          <tr key={c}>
            <th scope="row">{c}</th>
            <td>{CHECK_LABELS[c]}</td>
            <td>{CHECK_TEXT[c]?.when}</td>
            <td>{CHECK_TEXT[c]?.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every error code of the catalogue: message, effect, cause and what to do. */
export function ErrorTable() {
  return (
    <div className="guide-scroll">
      <table className="guide-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Message</th>
            <th>Effect</th>
            <th>Why it happens</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          {ERROR_CATALOGUE.map((e) => (
            <tr key={e.code} id={`error-${e.code}`}>
              <th scope="row">{e.code}</th>
              <td>{e.message}</td>
              <td className={`effect-${e.effect}`}>
                {e.effect === 'blocks' ? 'Blocks' : e.effect === 'warning' ? 'Warning' : 'Error'}
              </td>
              <td>{e.cause}</td>
              <td>{e.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined ? 'TBC' : String(v));

/** The rule pack's calculation defaults, grouped as on Import File. */
export function RulePackDefaults() {
  const groups = new Map<string, typeof pack.calculationDefaults>();
  for (const d of pack.calculationDefaults) {
    const g = d.group ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }
  return (
    <table className="guide-table">
      <tbody>
        {[...groups].map(([group, rows]) => [
          <tr key={group} className="group-row">
            <th colSpan={2}>{group}</th>
          </tr>,
          ...rows.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td>
                {show(d.value)} {d.value === null ? '' : (d.unit ?? '')}
              </td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

export function SiteDefaults() {
  const s = pack.siteDefaults;
  return (
    <ul>
      <li>Ambient air: {s.ambientAirC} °C</li>
      <li>Ambient ground (soil): {s.ambientSoilC} °C</li>
      <li>Soil thermal resistivity: {s.soilResistivity} K.m/W</li>
    </ul>
  );
}

export function DemandMethodTable() {
  const methods = pack.demandMethods;
  const cats = Object.keys(DEMAND_CATEGORY_LABELS) as (keyof typeof DEMAND_CATEGORY_LABELS)[];
  return (
    <table className="guide-table">
      <thead>
        <tr>
          <th>Method</th>
          {cats.map((c) => (
            <th key={c}>{DEMAND_CATEGORY_LABELS[c]}</th>
          ))}
          <th>SMDB level</th>
        </tr>
      </thead>
      <tbody>
        {(['dubai-non-emaar', 'dubai-emaar'] as const).map((m) => (
          <tr key={m}>
            <th scope="row">{m === 'dubai-emaar' ? 'Dubai - Emaar' : 'Dubai - Non-Emaar'}</th>
            {cats.map((c) => (
              <td key={c}>{show(methods[m].byCategory[c])}</td>
            ))}
            <td>{show(methods[m].secondLevel)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LoadTypeTable() {
  return (
    <table className="guide-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Load type</th>
          <th>Power factor (rule pack)</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(LOAD_TYPE_LABELS).map(([code, label]) => {
          const pf = pack.calculationDefaults.find((d) => d.key === `loadPowerFactor.${code}`);
          return (
            <tr key={code}>
              <td>{code}</td>
              <td>{label}</td>
              <td>{pf?.value ?? 'default load power factor'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DeviceTables() {
  const d = pack.devices;
  return (
    <>
      <p>
        <strong>Standard breaker ratings (A):</strong> {d.breakerRatingsA.join(', ')}
      </p>
      <p>
        <strong>Standard cable sizes (mm²):</strong> {d.cableSizesMm2.join(', ')}
      </p>
      <table className="guide-table">
        <thead>
          <tr>
            <th>Breaker type</th>
            <th>Up to</th>
            <th>Fault ratings Icu (kA)</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {d.breakerTypes.map((t) => (
            <tr key={t.type}>
              <th scope="row">{t.type}</th>
              <td>{t.maxRatingA} A</td>
              <td>{t.faultRatingsKa.join(', ')}</td>
              <td>{t.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>DEWA minimum cable per breaker (C6)</h4>
      <div className="guide-scroll">
        <table className="guide-table compact">
          <thead>
            <tr>
              <th>Breaker (A)</th>
              {d.dewaMinimumCable.rows.map((r) => (
                <th key={r.breakerA}>{r.breakerA}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Minimum cable</th>
              {d.dewaMinimumCable.rows.map((r) => (
                <td key={r.breakerA}>{r.runs > 1 ? `${r.runs}x${r.sizeMm2}` : r.sizeMm2}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">{d.dewaMinimumCable.note}</p>
    </>
  );
}

export function BusbarTable() {
  const makers = pack.busbars.makers;
  return (
    <div className="guide-scroll">
      <table className="guide-table compact">
        <thead>
          <tr>
            <th>Manufacturer</th>
            <th>Rating (A)</th>
            <th>R20 (mOhm/m)</th>
            <th>X (mOhm/m)</th>
            <th>Icw (kA)</th>
            <th>Ipk (kA)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(makers).flatMap(([maker, rows]) =>
            rows.map((r) => (
              <tr key={`${maker}-${r.ratingA}`}>
                <td>{maker}</td>
                <td>{r.ratingA}</td>
                <td>{r.r20MohmM}</td>
                <td>{r.xMohmM}</td>
                <td>{show(r.icwKa)}</td>
                <td>{show(r.ipkKa)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SourceDataTable() {
  const s = pack.sourceData;
  return (
    <>
      <table className="guide-table compact">
        <thead>
          <tr>
            <th>Transformer primary up to</th>
            <th>Rating up to</th>
            <th>uk (%)</th>
          </tr>
        </thead>
        <tbody>
          {s.transformerUkPct.flatMap((t) =>
            t.rows.map((r) => (
              <tr key={`${t.maxPrimaryKv}-${r.maxKva}`}>
                <td>{t.maxPrimaryKv} kV</td>
                <td>{r.maxKva} kVA</td>
                <td>{r.ukPct}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <table className="guide-table compact">
        <thead>
          <tr>
            <th>Generator up to</th>
            <th>X"d typical range (%)</th>
          </tr>
        </thead>
        <tbody>
          {s.generatorXdPct.map((g) => (
            <tr key={g.maxKva}>
              <td>{g.maxKva} kVA</td>
              <td>
                {g.low} - {g.high}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
