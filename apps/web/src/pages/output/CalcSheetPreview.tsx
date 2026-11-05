import { CALC_COLUMNS, type CalcSheet } from '@neuromep/shared';
import { calcSteps, calcText } from './calcSheetFiles';

/** Read-only preview of the calculation sheet (WBS 1.7.3): a row per cable, busbar feeder, riser. */
export function CalcSheetPreview({ sheet }: { sheet: CalcSheet }) {
  return (
    <div className="calc-sheet" aria-label="Calculation sheet">
      <p className="calc-sheet-title">
        <strong>CALCULATION SHEET - PROJECT : {sheet.project}</strong> · Rule pack {sheet.rulePack}
      </p>
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
                <th key={c.key}>
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
                    <td key={c.key} className={/^C\d$/.test(c.key) ? `calc-${text}` : undefined}>
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
