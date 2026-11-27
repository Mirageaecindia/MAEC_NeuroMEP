import type { BoardSchedule, MeterCounts, ScheduleRow } from '@neuromep/shared';
import type { BoardMeterTotals } from './meterTotals';

/**
 * What the engineer types in the schedule preview: the remarks only (26 Nov 2026). Meters are not
 * typed here (user decision 27 Nov 2026): the meter columns show the Meter components placed on
 * the floor plans, and the type of meter is the fixed reference line of the briefing format.
 */
export interface BoardMeters {
  /**
   * Remarks typed in the preview (user request 26 Nov 2026), by row: `in:<n>` for incomer n, the
   * way number for a way. A row not here keeps the system remark (ELCB, starter, tap-off ...).
   */
  remarks?: Record<string, string>;
}

/** The remark of a row: what the engineer typed, else the system remark. */
export const remarkOf = (m: BoardMeters | undefined, key: string, system: string) =>
  m?.remarks?.[key] ?? system;

/** The type-of-meter line of every schedule, as printed in the briefing (pages 2 - 4). */
export const METER_REFERENCE =
  'Type of Meter (Rating of Incomer): (1) Upto 60A (1 Phase)   (2) Upto 125A (3 Phase)   (3) LV CT ____/____A  /  HV CT ____/____A  (* 200/5Amps CT Metering)';

export const emptyMeters = (): BoardMeters => ({});

/**
 * Meter columns of a row (1-Ph, 3-Ph, LV/HV): the Meter components placed on the floor plans for
 * the component it feeds (10 Nov 2026); null = none placed.
 */
export function meterCells(
  r: Pick<ScheduleRow, 'meters'>,
): [number | null, number | null, number | null] {
  if (r.meters) return [r.meters.ph1, r.meters.ph3, r.meters.lvhv];
  return [null, null, null];
}

const placed = (m: MeterCounts) =>
  `From the meters on the plan: ${m.ph1} x 1-Ph, ${m.ph3} x 3-Ph, ${m.lvhv} x LV/HV`;

const num = (v: number | null, d = 0) => (v === null ? '-' : v.toFixed(d));
const kw = (n: number) => n.toFixed(2);

/**
 * A board schedule in the company format (Figma screen 5, Section 14). Read-only except the
 * remarks; meters come from the floor plans (27 Nov 2026).
 */
export function ScheduleSheet(props: {
  schedule: BoardSchedule;
  meters: BoardMeters;
  onMeters: (m: BoardMeters) => void;
  logo: string | null;
  completionDate: string;
  client: string;
  /** Meter totals of this board (accumulated from the boards below, 26 Nov 2026). */
  totals?: BoardMeterTotals;
}) {
  const { schedule: s, meters: m } = props;
  const row = (r: ScheduleRow, strong = false) => (
    <>
      <td>{r.poles}</td>
      <td>{num(r.breakerA)}</td>
      <td>{num(r.faultDutyKa)}</td>
      <td>{r.cores}</td>
      <td>{r.type}</td>
      <td>{num(r.sizeMm2)}</td>
      <td>{num(r.eccMm2)}</td>
      <td>{num(r.lengthM)}</td>
      <td>{kw(r.kw.R)}</td>
      <td>{kw(r.kw.Y)}</td>
      <td>{kw(r.kw.B)}</td>
      <td className={strong ? 'strong' : undefined}>{kw(r.tclKw)}</td>
      <td className={strong ? 'strong' : undefined}>{kw(r.mdKw)}</td>
    </>
  );
  const setRemark = (key: string, text: string) =>
    props.onMeters({ ...m, remarks: { ...m.remarks, [key]: text } });

  return (
    <table className="schedule-sheet" aria-label={`Schedule ${s.tag}`}>
      <tbody>
        <tr>
          <td colSpan={8} className="left strong">
            PROJECT : {s.project}
            <br />
            PLANNED COMPLETION DATE : {props.completionDate || '—'}
            <br />
            <br />
            <span className="sheet-board">{s.description ?? s.tag}</span>
          </td>
          <td colSpan={7} className="strong">
            DETAILS OF CONNECTED LOAD, MAX. DEMAND &amp; kWHR METERING
          </td>
          <td colSpan={5}>
            <div className="logo">
              {props.logo ? <img src={props.logo} alt={`${props.client} logo`} /> : props.client}
            </div>
            LOCATION OF {s.tag}: {s.location || '—'}
          </td>
        </tr>
        {/* Column heads frozen while the sheet scrolls (user request 15 Nov 2026). */}
        <tr className="strong sheet-head">
          <td>CIRCUIT / FEEDER</td>
          <td>WAY NO</td>
          <td>SP/TP</td>
          <td>ACB/MCCB (A)</td>
          <td>FAULT DUTY kA</td>
          <td>NO. OF CORES</td>
          <td>TYPE</td>
          <td>SIZE mm²</td>
          <td>ECC mm²</td>
          <td>LENGTH (m)</td>
          <td>R-PH kW</td>
          <td>Y-PH kW</td>
          <td>B-PH kW</td>
          <td>TCL kW</td>
          <td>MD kW</td>
          <td>1-PH</td>
          <td>3-PH</td>
          <td>LV/HV</td>
          <td colSpan={2}>REMARKS</td>
        </tr>
        {s.incomers.map((r, i) => (
          <tr key={r.feeder} className="strong">
            <td className="left">{r.feeder}</td>
            <td>-</td>
            {row(r, true)}
            {meterCells(r).map((v, k) => (
              <td key={k} title={r.meters ? placed(r.meters) : undefined}>
                {v ?? ''}
              </td>
            ))}
            <td colSpan={2} className="left">
              <RemarkInput
                label={`${r.feeder} remarks`}
                value={remarkOf(m, `in:${i}`, r.remarks)}
                onChange={(t) => setRemark(`in:${i}`, t)}
              />
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={20} className="left strong">
            OUTGOING WAYS:
          </td>
        </tr>
        {s.ways.length === 0 && (
          <tr>
            <td colSpan={20} className="left muted">
              No outgoing feeders drawn from {s.tag} yet.
            </td>
          </tr>
        )}
        {s.ways.map((w) => {
          const acc = props.totals?.accumulated[w.wayNo];
          return (
            <tr key={w.wayNo}>
              <td className="left">{w.feeder}</td>
              <td>{w.wayNo}</td>
              {row(w)}
              {acc
                ? acc.cells.map((n, k) => (
                    <td
                      key={k}
                      className="meter-placed"
                      title={`Total meters of ${acc.board} and the boards it feeds`}
                    >
                      {n}
                    </td>
                  ))
                : meterCells(w).map((v, k) => (
                    <td
                      key={k}
                      className={w.meters ? 'meter-placed' : undefined}
                      title={w.meters ? placed(w.meters) : 'No meter placed on the floor plan'}
                    >
                      {v ?? ''}
                    </td>
                  ))}
              <td colSpan={2} className="left">
                <RemarkInput
                  label={`${w.wayNo} remarks`}
                  value={remarkOf(m, w.wayNo, w.remarks)}
                  onChange={(t) => setRemark(w.wayNo, t)}
                />
              </td>
            </tr>
          );
        })}
        <tr className="strong">
          <td colSpan={5} className="left">
            {s.tag} CONNECTED TO: {s.connectedTo ?? '—'}
            <br />
            TRANSFORMER: {s.transformer ?? '—'}
          </td>
          <td colSpan={5}>TOTAL CONNECTED LOAD PER PHASE</td>
          <td>{kw(s.totals.kw.R)}</td>
          <td>{kw(s.totals.kw.Y)}</td>
          <td>{kw(s.totals.kw.B)}</td>
          <td>{kw(s.totals.tclKw)}</td>
          <td>{kw(s.totals.mdKw)}</td>
          {(props.totals?.total ?? [0, 0, 0]).map((n, k) => (
            <td key={k} title="Meters on the incomer and every way, boards below included">
              {n}
            </td>
          ))}
          <td colSpan={2}>TOTAL</td>
        </tr>
        <tr>
          <td colSpan={10} className="left strong">
            DEMAND FACTOR: {s.demandFactor === null ? '—' : s.demandFactor.toFixed(2)} · MAX.
            DEMAND: {kw(s.totals.mdKw)} kW
          </td>
          <td colSpan={10} className="left strong">
            * OVERALL TOTAL CONNECTED / INSTALLED LOAD (TCL): {kw(s.totals.tclKw)} kW
          </td>
        </tr>
        <tr>
          <td colSpan={20} className="left">
            {METER_REFERENCE}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Remarks of a row, editable (26 Nov 2026): starts with the system remark; goes into the files. */
function RemarkInput(props: { label: string; value: string; onChange: (t: string) => void }) {
  return (
    <input
      className="remark-input"
      aria-label={props.label}
      value={props.value}
      placeholder="Remarks"
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
