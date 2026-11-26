import {
  CableConstructionSchema,
  LAYING_DEPTHS_M,
  SEPARATIONS,
  TRAY_COUNTS,
  type CableConstruction,
} from '@neuromep/shared';
import { useState } from 'react';
import { Modal, NumberInput } from '../../components/fields';

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

interface Installation {
  trays: number | null;
  depthM: number | null;
  separation: string | null;
  groupedCircuits: number | null;
}

/**
 * Cable construction, chosen while drawing (D-05). The project default is TBC in the rule pack
 * (12.2), so nothing is pre-selected the first time; the choice is then remembered for the
 * project. Trays, depth of laying, separation and grouping (12.3) are optional: empty = TBC for
 * the engine. Size, runs and the earth conductor are never chosen here: Cable Size calculates
 * them (D-04).
 */
export function ConstructionDialog(props: {
  initial: CableConstruction | null;
  title?: string;
  onCancel: () => void;
  onConfirm: (c: CableConstruction) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>(() => ({ ...props.initial }));
  const [install, setInstall] = useState<Installation>(() => ({
    trays: props.initial?.trays ?? null,
    depthM: props.initial?.depthM ?? null,
    separation: props.initial?.separation ?? null,
    groupedCircuits: props.initial?.groupedCircuits ?? null,
  }));
  const buried = draft.method === 'D-direct' || draft.method === 'D-duct';
  const onTray = draft.method === 'J';
  const separations = draft.method ? SEPARATIONS[draft.method as CableConstruction['method']] : [];
  const parsed = CableConstructionSchema.safeParse({
    ...props.initial,
    ...draft,
    ...install,
    // Trays apply to tray (J) only, depth of laying to buried and duct cables only.
    trays: onTray ? install.trays : null,
    depthM: buried ? install.depthM : null,
    // A separation from another method does not apply.
    separation: separations.includes(install.separation ?? '') ? install.separation : null,
  });
  const complete = FIELDS.every(([f]) => draft[f]);
  const issue = !parsed.success ? parsed.error.issues[0] : undefined;
  const problem = complete && issue ? describeIssue(issue) : null;

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
      <h3 className="construction-subhead">Installation (optional - empty = TBC)</h3>
      <div className="construction-grid">
        {onTray && (
          <label className="construction-row">
            <span>No. of trays</span>
            <OptionSelect
              value={install.trays}
              options={TRAY_COUNTS}
              format={String}
              onChange={(trays) => setInstall((i) => ({ ...i, trays }))}
            />
          </label>
        )}
        <label className="construction-row">
          <span>Grouped circuits</span>
          <NumberInput
            value={install.groupedCircuits}
            onChange={(groupedCircuits) => setInstall((i) => ({ ...i, groupedCircuits }))}
            placeholder="TBC"
          />
        </label>
        {separations.length > 0 && (
          <label className="construction-row">
            <span>Separation</span>
            <select
              className="select"
              value={install.separation ?? ''}
              onChange={(e) => setInstall((i) => ({ ...i, separation: e.target.value || null }))}
            >
              <option value="">TBC</option>
              {separations.map((s) => (
                <option key={s} value={s}>
                  {s === 'touching' ? 'Touching' : buried ? `${s} m` : s}
                </option>
              ))}
            </select>
          </label>
        )}
        {buried && (
          <label className="construction-row">
            <span>Depth of laying (m)</span>
            <OptionSelect
              value={install.depthM}
              options={LAYING_DEPTHS_M}
              format={(d) => d.toFixed(2).replace(/0$/, '')}
              onChange={(depthM) => setInstall((i) => ({ ...i, depthM }))}
            />
          </label>
        )}
      </div>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}

const FIELD_LABELS: Record<string, string> = {
  trays: 'Trays',
  groupedCircuits: 'Grouped circuits',
  depthM: 'Depth of laying',
};

/** A schema problem in plain words: "Trays: must be a whole number of at least 1". */
function describeIssue(issue: { path: PropertyKey[]; message: string; code: string }): string {
  const field = FIELD_LABELS[String(issue.path[0])];
  if (!field) return issue.message;
  return issue.code === 'invalid_type'
    ? `${field}: enter a whole number.`
    : `${field}: must be ${field === 'Depth of laying' ? 'greater than 0 m' : 'a whole number of at least 1'}.`;
}

/**
 * A dropdown of fixed numbers with TBC first (components sheet: trays 1-3, depth 0.6-2.5 m). A
 * value stored earlier that is not in the list is still shown, so it is not lost silently.
 */
function OptionSelect(props: {
  value: number | null;
  options: readonly number[];
  format: (n: number) => string;
  onChange: (n: number | null) => void;
}) {
  const list =
    props.value !== null && !props.options.includes(props.value)
      ? [...props.options, props.value].sort((a, b) => a - b)
      : props.options;
  return (
    <select
      className="select"
      value={props.value === null ? '' : String(props.value)}
      onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">TBC</option>
      {list.map((n) => (
        <option key={n} value={String(n)}>
          {props.format(n)}
        </option>
      ))}
    </select>
  );
}
