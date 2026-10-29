import {
  LOAD_TYPE_LABELS,
  LoadLineSchema,
  LoadTypeCodeSchema,
  lineKw,
  type LoadLine,
  type LoadTypeCode,
} from '@neuromep/shared';
import { useState } from 'react';
import { Modal, NumberInput } from '../../components/fields';

type Row =
  | {
      method: 'kw';
      loadType: LoadTypeCode;
      kwL1: number | null;
      kwL2: number | null;
      kwL3: number | null;
    }
  | {
      method: 'area';
      loadType: LoadTypeCode;
      areaM2: number | null;
      wPerM2: number | null;
      phases: 'L1' | 'L2' | 'L3' | '3P';
    };

const kw = (v: number) => `${v.toFixed(2)} kW`;

/**
 * Loads of a DB, or manual loads of a panel's unconnected ways (FR-17, 10.3): one line per load
 * type, kW per phase or area x W/m2 on a phase (or spread over three). Connected values only;
 * demand factors are applied by the load table and the engine.
 */
export function LoadsDialog(props: {
  title: string;
  lines: LoadLine[];
  onCancel: () => void;
  onSave: (lines: LoadLine[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => props.lines.map((l) => ({ ...l })));
  const parsed = rows.map((r) => LoadLineSchema.safeParse(r));
  const invalid = parsed.findIndex((p) => !p.success);
  const totals = parsed.reduce(
    (s, p) => (p.success ? s + Object.values(lineKw(p.data)).reduce((a, b) => a + b, 0) : s),
    0,
  );
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? ({ ...r, ...patch } as Row) : r)));

  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      actions={
        <>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={invalid >= 0}
            onClick={() => props.onSave(parsed.flatMap((p) => (p.success ? [p.data] : [])))}
          >
            Save loads
          </button>
        </>
      }
    >
      <table className="loads-table">
        <thead>
          <tr>
            <th>Load type</th>
            <th>Entered as</th>
            <th colSpan={3}>Values</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select
                  className="select"
                  aria-label={`Load type ${i + 1}`}
                  value={r.loadType}
                  onChange={(e) => set(i, { loadType: e.target.value as LoadTypeCode })}
                >
                  {LoadTypeCodeSchema.options.map((c) => (
                    <option key={c} value={c}>
                      {LOAD_TYPE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="select"
                  aria-label={`Entered as ${i + 1}`}
                  value={r.method}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, j) =>
                        j !== i
                          ? x
                          : e.target.value === 'kw'
                            ? {
                                method: 'kw',
                                loadType: x.loadType,
                                kwL1: null,
                                kwL2: null,
                                kwL3: null,
                              }
                            : {
                                method: 'area',
                                loadType: x.loadType,
                                areaM2: null,
                                wPerM2: null,
                                phases: '3P',
                              },
                      ),
                    )
                  }
                >
                  <option value="kw">kW per phase</option>
                  <option value="area">Area x W/m²</option>
                </select>
              </td>
              {r.method === 'kw' ? (
                (['kwL1', 'kwL2', 'kwL3'] as const).map((k, n) => (
                  <td key={k}>
                    <NumberInput
                      className="pill-input"
                      ariaLabel={`L${n + 1} kW ${i + 1}`}
                      placeholder={`L${n + 1} kW`}
                      value={r[k]}
                      onChange={(v) => set(i, { [k]: v })}
                    />
                  </td>
                ))
              ) : (
                <>
                  <td>
                    <NumberInput
                      className="pill-input"
                      ariaLabel={`Area m² ${i + 1}`}
                      placeholder="m²"
                      value={r.areaM2}
                      onChange={(v) => set(i, { areaM2: v })}
                    />
                  </td>
                  <td>
                    <NumberInput
                      className="pill-input"
                      ariaLabel={`W/m² ${i + 1}`}
                      placeholder="W/m²"
                      value={r.wPerM2}
                      onChange={(v) => set(i, { wPerM2: v })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Phase ${i + 1}`}
                      value={r.phases}
                      onChange={(e) =>
                        set(i, { phases: e.target.value as 'L1' | 'L2' | 'L3' | '3P' })
                      }
                    >
                      {['3P', 'L1', 'L2', 'L3'].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                </>
              )}
              <td>
                <button
                  className="btn-link"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button
          className="btn btn-sm"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { method: 'kw', loadType: '1', kwL1: null, kwL2: null, kwL3: null },
            ])
          }
        >
          Add load line
        </button>{' '}
        <span className="muted">Connected load: {kw(totals)}</span>
      </p>
      {invalid >= 0 && (
        <p className="field-error" role="alert">
          Line {invalid + 1}: enter every value (kW, m² and W/m² cannot be negative) (E1502).
        </p>
      )}
    </Modal>
  );
}
