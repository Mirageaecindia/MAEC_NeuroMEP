import { LOAD_TYPE_LABELS, PAGE1_LIMITS, type LoadTypeCode } from '@neuromep/shared';
import { useState } from 'react';
import { useUser } from '../../auth/AuthContext';
import { Modal, NumberInput } from '../../components/fields';
import { newAudit } from '../../workspace/formProps';
import { useWorkspace } from '../../workspace/ProjectWorkspace';
import { LOAD_TYPE_GRID } from '../import/ImportFileForm';

const { min, max } = PAGE1_LIMITS.demandFactor;
const outOfRange = (v: number | null) => v !== null && !(v >= min && v <= max);

/**
 * Building Summary "Demand Factors" (A-14): the 12 load-type demand factors of Import File, opened
 * again to change them after a Cable Size run. A change marks the sizes out of date (`onChanged`).
 */
export function DemandFactorsDialog(props: { onClose: () => void; onChanged: () => void }) {
  const { editor, project } = useWorkspace();
  const user = useUser();
  const current = project.calculation.demandFactors.byLoadType;
  const [draft, setDraft] = useState<Record<LoadTypeCode, number | null>>(
    () =>
      Object.fromEntries(LOAD_TYPE_GRID.map((c) => [c, current[c].value])) as Record<
        LoadTypeCode,
        number | null
      >,
  );
  const invalid = LOAD_TYPE_GRID.some((c) => outOfRange(draft[c]));
  const changed = LOAD_TYPE_GRID.filter((c) => draft[c] !== current[c].value);

  function save() {
    for (const code of changed) {
      editor.dispatch({
        type: 'demandFactor',
        table: 'byLoadType',
        key: code,
        value: draft[code],
        audit: newAudit(user),
      });
    }
    if (changed.length > 0) props.onChanged();
    props.onClose();
  }

  return (
    <Modal
      title="Demand Factors"
      onClose={props.onClose}
      actions={
        <>
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={editor.readOnly || invalid} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="muted">
        Demand factors by load type, as entered on Import File (empty = TBC, 1.0 is used and the
        result stays Provisional, E1901). Changing a factor marks the cable sizes out of date: run
        the Cable Size Calculator again.
      </p>
      <div className="df-dialog-grid">
        {LOAD_TYPE_GRID.map((code) => (
          <label key={code} className="df-dialog-row">
            <span>{LOAD_TYPE_LABELS[code]}</span>
            <NumberInput
              className="pill-input df-input"
              ariaLabel={`${LOAD_TYPE_LABELS[code]} demand factor`}
              value={draft[code]}
              placeholder="TBC"
              disabled={editor.readOnly}
              invalid={outOfRange(draft[code])}
              onChange={(v) => setDraft((d) => ({ ...d, [code]: v }))}
            />
          </label>
        ))}
      </div>
      {invalid && (
        <p className="field-error" role="alert">
          A demand factor must be between {min} and {max}.
        </p>
      )}
    </Modal>
  );
}
