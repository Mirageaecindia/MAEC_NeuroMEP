import { CableConstructionSchema, type CableConstruction } from '@neuromep/shared';
import { useState } from 'react';
import { Modal } from '../../components/fields';

type Field = 'cores' | 'conductor' | 'insulation' | 'armour' | 'sheath' | 'voltageGrade' | 'method';

const FIELDS: [Field, string][] = [
  ['cores', 'Cores'],
  ['conductor', 'Conductor'],
  ['insulation', 'Insulation'],
  ['armour', 'Armour'],
  ['sheath', 'Sheath'],
  ['voltageGrade', 'Voltage grade'],
  ['method', 'Installation method'],
];
const OPTIONS = CableConstructionSchema.shape;

/**
 * Cable construction, chosen while drawing (D-05). The project default is TBC in the rule pack
 * (12.2), so nothing is pre-selected the first time; the choice is then remembered for the
 * project. Grouping, trays and depth are added with WBS 1.3.3. Size, runs and the earth conductor
 * are never chosen here: Cable Size calculates them (D-04).
 */
export function ConstructionDialog(props: {
  initial: CableConstruction | null;
  title?: string;
  onCancel: () => void;
  onConfirm: (c: CableConstruction) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>(() => ({ ...props.initial }));
  const parsed = CableConstructionSchema.safeParse({
    ...props.initial,
    trays: props.initial?.trays ?? null,
    depthM: props.initial?.depthM ?? null,
    separation: props.initial?.separation ?? null,
    groupedCircuits: props.initial?.groupedCircuits ?? null,
    ...draft,
  });
  const complete = FIELDS.every(([f]) => draft[f]);
  const problem = complete && !parsed.success ? parsed.error.issues[0]?.message : null;

  return (
    <Modal
      title={props.title ?? 'Cable construction'}
      onClose={props.onCancel}
      actions={
        <>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!parsed.success}
            onClick={() => parsed.success && props.onConfirm(parsed.data)}
          >
            Use this construction
          </button>
        </>
      }
    >
      <p className="muted">
        The project default construction is TBC (12.2): choose the construction of the cables you
        draw. Size, runs and earth conductor are calculated by Cable Size.
      </p>
      <div className="construction-grid">
        {FIELDS.map(([field, label]) => (
          <label key={field} className="construction-row">
            <span>{label}</span>
            <select
              className="select"
              value={draft[field] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
            >
              <option value="" disabled>
                Choose…
              </option>
              {OPTIONS[field].options.map((o: string) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}
