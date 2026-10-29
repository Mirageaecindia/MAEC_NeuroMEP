import type { LoadImportPlan } from '@neuromep/shared';
import { Modal } from '../../components/fields';

const kw = (v: number) => `${v.toFixed(2)} kW`;

/**
 * Preview of a DB load upload (FR-35): matched DBs with their total before and after, rows that
 * match no DB (E1503) and rows that could not be read. Nothing changes until Import.
 */
export function LoadImportDialog(props: {
  fileName: string;
  plan: LoadImportPlan;
  problems: { row: number; message: string }[];
  onCancel: () => void;
  onImport: () => void;
}) {
  const changed = props.plan.matched.filter((m) => m.changed);
  return (
    <Modal
      title="Import DB loads"
      onClose={props.onCancel}
      actions={
        <>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={changed.length === 0}
            onClick={props.onImport}
          >
            Import {changed.length} DB{changed.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="muted">
        {props.fileName}: {props.plan.matched.length} matched, {changed.length} with new loads. The
        loads of a matched DB are replaced; they stay editable and the import is written to the
        audit log.
      </p>
      {changed.length > 0 && (
        <table className="loads-table" aria-label="Matched DBs">
          <thead>
            <tr>
              <th>DB</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((m) => (
              <tr key={m.element.id}>
                <td>{m.element.tag}</td>
                <td>{kw(m.beforeKw)}</td>
                <td>{kw(m.afterKw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.plan.unmatched.length > 0 && (
        <div className="banner banner-warning">
          <strong>Not matched (E1503):</strong>{' '}
          {props.plan.unmatched.map((u) => `row ${u.row} "${u.tag}"`).join(', ')} - no DB with this
          tag in the project.
        </div>
      )}
      {props.problems.length > 0 && (
        <div className="banner banner-error">
          <strong>Not read:</strong>
          <ul>
            {props.problems.map((p) => (
              <li key={p.row}>
                Row {p.row}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
