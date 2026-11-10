import type { BoardSchedule, MeterCounts, ScheduleRow } from '@neuromep/shared';

/**
 * kWh meters of an outgoing way (1-Ph / 3-Ph / LV/HV) typed in the preview: optional, for ways
 * with no meter placed on the plan (user decision 10 Nov 2026: meters are never required).
 */
export interface WayMeters {
  ph1: number | null;
  ph3: number | null;
  ct: number | null;
}

/** Type of meter of a board (rating of the incomer), chosen in the preview (optional). */
export interface BoardMeters {
  type: '' | 'upto-60a-1ph' | 'upto-125a-3ph' | 'lv-ct';
  ctRatio: string;
  ways: Record<string, WayMeters>;
}

export const METER_TYPES: { value: Exclude<BoardMeters['type'], ''>; label: string }[] = [
  { value: 'upto-60a-1ph', label: 'Up to 60 A (1 phase)' },
  { value: 'upto-125a-3ph', label: 'Up to 125 A (3 phase)' },
  { value: 'lv-ct', label: 'LV CT metering' },
];

export const emptyMeters = (): BoardMeters => ({ type: '', ctRatio: '', ways: {} });
const NO_METERS: WayMeters = { ph1: null, ph3: null, ct: null };

/**
 * Meter columns of a row (1-Ph, 3-Ph, LV/HV): the meters placed on the plan for the component it
 * feeds (10 Nov 2026), else what was typed in the preview; null = left empty.
 */
export function meterCells(
  r: Pick<ScheduleRow, 'meters'>,
  typed: WayMeters | undefined,
): [number | null, number | null, number | null] {
  if (r.meters) return [r.meters.ph1, r.meters.ph3, r.meters.lvhv];
  return [typed?.ph1 ?? null, typed?.ph3 ?? null, typed?.ct ?? null];
}

const placed = (m: MeterCounts) =>
  `From the meters on the plan: ${m.ph1} x 1-Ph, ${m.ph3} x 3-Ph, ${m.lvhv} x LV/HV`;

const num = (v: number | null, d = 0) => (v === null ? '-' : v.toFixed(d));
const kw = (n: number) => n.toFixed(2);

function MeterInput(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      className="meter-input"
      placeholder="-"
      title="Optional: no meter is placed on the plan for this way"
      aria-label={props.label}
      inputMode="numeric"
      value={props.value ?? ''}
      onChange={(e) => {
        const t = e.target.value.trim();
        const n = Number(t);
        props.onChange(t === '' || !Number.isInteger(n) || n < 0 ? null : n);
      }}
    />
  );
}

/**
 * A board schedule in the company format (Figma screen 5, Section 14). Read-only except the
 * optional meter inputs (ways with no meter on the plan) and the type of meter.
 */
export function ScheduleSheet(props: {
  schedule: BoardSchedule;
  meters: BoardMeters;
  onMeters: (m: BoardMeters) => void;
  logo: string | null;
  completionDate: string;
  client: string;
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
  const setWay = (way: string, patch: Partial<WayMeters>) =>
    props.onMeters({
      ...m,
      ways: { ...m.ways, [way]: { ...(m.ways[way] ?? NO_METERS), ...patch } },
    });

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
        <tr className="strong">
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
        {s.incomers.map((r) => (
          <tr key={r.feeder} className="strong">
            <td className="left">{r.feeder}</td>
            <td>-</td>
            {row(r, true)}
            {meterCells(r, undefined).map((v, k) => (
              <td key={k} title={r.meters ? placed(r.meters) : undefined}>
                {v ?? ''}
              </td>
            ))}
            <td colSpan={2} className="left">
              {r.remarks}
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
          const v = m.ways[w.wayNo] ?? NO_METERS;
          return (
            <tr key={w.wayNo}>
              <td className="left">{w.feeder}</td>
              <td>{w.wayNo}</td>
              {row(w)}
              {w.meters ? (
                meterCells(w, undefined).map((v, k) => (
                  <td key={k} className="meter-placed" title={placed(w.meters!)}>
                    {v}
                  </td>
                ))
              ) : (
                <>
                  <td>
                    <MeterInput
                      label={`${w.wayNo} 1-phase meters`}
                      value={v.ph1}
                      onChange={(ph1) => setWay(w.wayNo, { ph1 })}
                    />
                  </td>
                  <td>
                    <MeterInput
                      label={`${w.wayNo} 3-phase meters`}
                      value={v.ph3}
                      onChange={(ph3) => setWay(w.wayNo, { ph3 })}
                    />
                  </td>
                  <td>
                    <MeterInput
                      label={`${w.wayNo} LV/HV meters`}
                      value={v.ct}
                      onChange={(ct) => setWay(w.wayNo, { ct })}
                    />
                  </td>
                </>
              )}
              <td colSpan={2} className="left">
                {w.remarks}
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
          <td colSpan={5}>TOTAL</td>
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
            <label className="meter-type">
              Type of Meter (rating of incomer):{' '}
              <select
                aria-label={`${s.tag} type of meter`}
                value={m.type}
                onChange={(e) =>
                  props.onMeters({ ...m, type: e.target.value as BoardMeters['type'] })
                }
              >
                <option value="">-</option>
                {METER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {m.type === 'lv-ct' && (
              <label className="meter-type">
                {' '}
                CT ratio:{' '}
                <input
                  aria-label={`${s.tag} CT ratio`}
                  placeholder="e.g. 200/5 A"
                  value={m.ctRatio}
                  onChange={(e) => props.onMeters({ ...m, ctRatio: e.target.value })}
                />
              </label>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
