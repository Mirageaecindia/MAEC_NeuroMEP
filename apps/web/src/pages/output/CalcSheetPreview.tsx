import { CALC_COLUMNS, CHECK_STATES, type CalcSheet } from '@neuromep/shared';
import { calcSteps, calcText } from './calcSheetFiles';

type BreakerChoice = 'MCCB' | 'ACB';
const BREAKER_TYPES: BreakerChoice[] = ['MCCB', 'ACB'];

/**
 * Preview of the calculation sheet (WBS 1.7.3): a row per cable, busbar feeder, riser. Read-only
 * except the Breaker type of each feeder (A-34, 27 Nov 2026): a dropdown MCCB / ACB showing
 * the default logic's type; another choice is kept, shown orange and flagged W2004.
 */
export function CalcSheetPreview({
  sheet,
  onBreakerType,
}: {
  sheet: CalcSheet;
  /** Given when the user may edit the electrical layer; null = back to the default. */
  onBreakerType?: (cableId: string, type: BreakerChoice | null) => void;
}) {
  return (
    <div className="calc-sheet" aria-label="Calculation sheet">
      <p className="calc-sheet-title">
        <strong>CALCULATION SHEET - PROJECT : {sheet.project}</strong> · Rule pack {sheet.rulePack}
      </p>
      <NotSizedSummary sheet={sheet} />
      <div className="calc-sheet-scroll">
        <table>
          <thead>
            <tr>
              {calcSteps().map((s) => (
                <th key={s.step} colSpan={s.span}>
                  {s.step}
                </th>
              ))}
            </tr>
            <tr>
              {CALC_COLUMNS.map((c) => (
                <th key={c.key} title={c.hint}>
                  {c.label}
                  {c.unit && <span className="calc-unit"> ({c.unit})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length === 0 && (
              <tr>
                <td colSpan={CALC_COLUMNS.length}>No feeders in this project.</td>
              </tr>
            )}
            {sheet.rows.map((r, i) => (
              <tr key={`${String(r.ref)}-${i}`}>
                {CALC_COLUMNS.map((c) => {
                  const text = calcText(c, r[c.key]);
                  if (c.key === 'device' && typeof r.cableId === 'string') {
                    const chosen = (r['device:chosen'] as BreakerChoice | null) ?? null;
                    const shown = (chosen ?? r.device ?? null) as BreakerChoice | null;
                    // The default logic's type: stored when the engineer chose another, else the
                    // last result's own type (a result from before the choice).
                    const def = ((r['device:default'] as BreakerChoice | null) ??
                      r.device ??
                      null) as BreakerChoice | null;
                    const changed = chosen !== null && def !== null && chosen !== def;
                    return (
                      <td
                        key={c.key}
                        className={changed ? 'calc-changed' : undefined}
                        title={
                          changed
                            ? `Changed from the default ${def} (W2004): checked as ${chosen}, never moved up automatically. Choose ${def} to go back to the default.`
                            : 'Default breaker type: MCCB below 800 A, ACB from 800 A, PFC bank MCCB. Choose another type if needed (it will be flagged).'
                        }
                      >
                        {onBreakerType ? (
                          <select
                            className="calc-select"
                            aria-label={`${String(r.ref)} breaker type`}
                            value={shown ?? ''}
                            onChange={(e) => {
                              const v = e.target.value as BreakerChoice;
                              onBreakerType(r.cableId as string, v === def ? null : v);
                            }}
                          >
                            {shown === null && <option value="">-</option>}
                            {BREAKER_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          (shown ?? '-')
                        )}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.key}
                      title={
                        c.hint
                          ? `${c.hint}\nResult: ${text}${r[`${c.key}:detail`] ? ` - ${String(r[`${c.key}:detail`])}` : ''}\n${CHECK_STATES}`
                          : undefined
                      }
                      className={
                        /^C\d$/.test(c.key)
                          ? `calc-${text}`
                          : c.key === 'note'
                            ? 'calc-note'
                            : c.key.endsWith('Formula')
                              ? 'calc-formula'
                              : undefined
                      }
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const list = (tags: string[], max = 12) =>
  tags.length > max
    ? `${tags.slice(0, max).join(', ')} and ${tags.length - max} more`
    : tags.join(', ');

/**
 * Why rows have blank figures (user report 15 Nov 2026): one missing value low in the network
 * blocks every feeder above it, so the causes are listed by the component to fix.
 */
function NotSizedSummary({ sheet }: { sheet: CalcSheet }) {
  const n = sheet.notSized;
  if (
    !n.missingPf.length &&
    !n.missingEfficiency.length &&
    !n.awaitingLoad.length &&
    !n.otherBlocked
  ) {
    return null;
  }
  return (
    <div className="calc-not-sized" role="note" aria-label="Why rows are not sized">
      <strong>Rows with blank figures - what to fix:</strong>
      <ul>
        {n.missingPf.length > 0 && (
          <li>
            <strong>Power factor missing</strong> on {list(n.missingPf)}. Every feeder above them is
            blocked (E2003): their power factor is unknown, so Ib, the breaker and the cable cannot
            be worked out. Enter the power factor on the load, or a default for its load type in
            Import File &gt; Load Power Factor.
          </li>
        )}
        {n.missingEfficiency.length > 0 && (
          <li>
            <strong>Motor efficiency missing</strong> on {list(n.missingEfficiency)} (a starter is
            set). Every feeder above them is blocked (E2003): enter the efficiency on the equipment.
          </li>
        )}
        {n.awaitingLoad.length > 0 && (
          <li>
            <strong>No load entered</strong> on {list(n.awaitingLoad)}: nothing to size until their
            loads are entered (Awaiting load).
          </li>
        )}
        {n.otherBlocked > 0 && (
          <li>
            {n.otherBlocked} other blocked row{n.otherBlocked === 1 ? '' : 's'}: the reason is in
            the Why not sized column.
          </li>
        )}
      </ul>
    </div>
  );
}
