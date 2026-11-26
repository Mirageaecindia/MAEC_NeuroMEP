import { CALC_COLUMNS, CHECK_STATES, type CalcSheet } from '@neuromep/shared';
import { calcSteps, calcText } from './calcSheetFiles';

/** Read-only preview of the calculation sheet (WBS 1.7.3): a row per cable, busbar feeder, riser. */
export function CalcSheetPreview({ sheet }: { sheet: CalcSheet }) {
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
