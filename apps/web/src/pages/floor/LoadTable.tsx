import {
  LOAD_TYPE_LABELS,
  type Element,
  type LoadSummary,
  type LoadTypeCode,
} from '@neuromep/shared';

const f1 = (v: number) => v.toFixed(1);

/**
 * Right-side load table (FR-18, 10.2 step 2): the components of the floor, or those below the
 * selected board, with kW per phase, power factor and current at maximum demand, and the
 * connected and maximum-demand totals. Updated on every change, without Cable Size.
 */
export function LoadTable(props: {
  title: string;
  rows: { element: Element; summary: LoadSummary }[];
  total: { connectedKw: number; maxDemandKw: number };
  tbcFactors: boolean;
  categoriesPending: boolean;
}) {
  return (
    <section className="load-table" aria-label="Load table">
      <h3>{props.title}</h3>
      {props.rows.length === 0 ? (
        <p className="muted">No components with load yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>L1</th>
              <th>L2</th>
              <th>L3</th>
              <th>pf</th>
              <th>A</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map(({ element, summary: s }) => (
              <tr
                key={element.id}
                title={
                  Object.keys(s.byType)
                    .map((c) => LOAD_TYPE_LABELS[c as LoadTypeCode])
                    .join(', ') || 'No load'
                }
              >
                <td>{element.tag}</td>
                <td>{f1(s.connected.L1)}</td>
                <td>{f1(s.connected.L2)}</td>
                <td>{f1(s.connected.L3)}</td>
                <td>{s.pf === null ? '-' : s.pf.toFixed(2)}</td>
                <td>{s.currentA === null ? '-' : f1(s.currentA)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="load-totals">
        Connected <strong>{f1(props.total.connectedKw)} kW</strong> · Max demand{' '}
        <strong>{f1(props.total.maxDemandKw)} kW</strong>
      </p>
      {(props.tbcFactors || props.categoriesPending) && (
        <p className="field-hint">
          Provisional
          {props.tbcFactors && ' - demand factors TBC, 1.0 used (E1901)'}
          {props.categoriesPending && ' - OI-02 open: category factors not applied'}
        </p>
      )}
    </section>
  );
}
