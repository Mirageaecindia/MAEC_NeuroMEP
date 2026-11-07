import {
  copyComponents,
  floorComponents,
  isFlagged,
  typicalSet,
  type Cable,
  type Discipline,
  type Element,
  type Floor,
  type Project,
} from '@neuromep/shared';
import { useState } from 'react';
import { Modal } from '../../components/fields';

/**
 * Bar above the floor plan (user request 7 Nov 2026): what is selected and what can be done with
 * it - Rotate 90°, Copy, Paste, Delete - and Replicate floor. Keyboard: Shift / Ctrl + click or
 * Shift + drag selects several, Ctrl + A all of your layer, R rotates, Ctrl + C / Ctrl + V copy
 * and paste, Delete removes.
 */
export function SelectionBar(props: {
  count: number;
  clipboard: number;
  canEdit: boolean;
  onRotate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onReplicate: () => void;
}) {
  const none = props.count === 0;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection">
      <span className="muted">
        {none
          ? 'Shift + click or Shift + drag to select several'
          : `${props.count} component${props.count === 1 ? '' : 's'} selected`}
      </span>
      <button className="btn btn-sm" disabled={none || !props.canEdit} onClick={props.onRotate}>
        ⟳ Rotate 90°
      </button>
      <button className="btn btn-sm" disabled={none || !props.canEdit} onClick={props.onCopy}>
        Copy
      </button>
      <button
        className="btn btn-sm"
        disabled={props.clipboard === 0 || !props.canEdit}
        onClick={props.onPaste}
      >
        Paste{props.clipboard > 0 ? ` (${props.clipboard})` : ''}
      </button>
      <button className="btn btn-sm" disabled={none || !props.canEdit} onClick={props.onDelete}>
        Delete
      </button>
      <button className="btn btn-sm" disabled={!props.canEdit} onClick={props.onReplicate}>
        Replicate floor…
      </button>
    </div>
  );
}

type Choice = 'add' | 'replace' | 'skip';

/** What Replicate floor does: the copies and the components it removes first. */
export interface ReplicatePlan {
  elements: Element[];
  cables: Cable[];
  replaceIds: string[];
  floors: number;
}

/**
 * Replicate floor: copies the components of your layers on this floor (with the feeders between
 * them) to the floors ticked. A target that already has components of your layers asks what to
 * do: add alongside, replace them, or skip that floor (user decision 7 Nov 2026).
 */
export function replicate(
  project: Project,
  source: Floor,
  layers: readonly Discipline[],
  targets: { floorId: string; choice: Choice }[],
  newId: () => string,
): ReplicatePlan {
  const ids = floorComponents(project, source.id, layers).map((e) => e.id);
  let model = project.model;
  const result: ReplicatePlan = { elements: [], cables: [], replaceIds: [], floors: 0 };
  for (const t of targets) {
    if (t.choice === 'skip') continue;
    if (t.choice === 'replace') {
      const gone = floorComponents({ model }, t.floorId, layers).map((e) => e.id);
      result.replaceIds.push(...gone);
      const set = new Set(gone);
      model = {
        ...model,
        elements: model.elements.filter((e) => !set.has(e.id)),
        cables: model.cables.filter((c) => !set.has(c.from.elementId) && !set.has(c.to.elementId)),
      };
    }
    // Copied from the original floor; tags and feeder tags also avoid the copies made so far.
    const copy = copyComponents(
      { building: project.building, model: { ...model, elements: [...model.elements] } },
      { ids, targetFloorId: t.floorId, newId },
    );
    model = {
      ...model,
      elements: [...model.elements, ...copy.elements],
      cables: [...model.cables, ...copy.cables],
    };
    result.elements.push(...copy.elements);
    result.cables.push(...copy.cables);
    result.floors += 1;
  }
  return result;
}

export function ReplicateDialog(props: {
  project: Project;
  source: Floor;
  layers: readonly Discipline[];
  onCancel: () => void;
  onConfirm: (targets: { floorId: string; choice: Choice }[]) => void;
}) {
  const { project, source, layers } = props;
  const count = floorComponents(project, source.id, layers).length;
  const others = [...project.building.floors].reverse().filter((f) => f.id !== source.id);
  const blocked = (f: Floor) =>
    !f.plan?.calibration
      ? 'No calibrated plan'
      : layers.some((d) => isFlagged(project.model.floorFlags, f.id, d))
        ? 'Flagged done (locked)'
        : null;
  const existing = (f: Floor) => floorComponents(project, f.id, layers).length;
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice | ''>>({});
  const toggle = (id: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const typical = typicalSet(project.building).filter((f) => f.id !== source.id && !blocked(f));
  const unanswered = [...ticked].some((id) => {
    const f = others.find((x) => x.id === id)!;
    return existing(f) > 0 && !choices[id];
  });

  return (
    <Modal
      title={`Replicate ${source.name}`}
      onClose={props.onCancel}
      actions={
        <>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={ticked.size === 0 || unanswered || count === 0}
            onClick={() =>
              props.onConfirm(
                others
                  .filter((f) => ticked.has(f.id))
                  .map((f) => ({
                    floorId: f.id,
                    choice: existing(f) > 0 ? (choices[f.id] as Choice) : 'add',
                  })),
              )
            }
          >
            Replicate to {ticked.size} floor{ticked.size === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p>
        Copies the {count} component{count === 1 ? '' : 's'} of your layer
        {layers.length === 1 ? '' : 's'} on {source.name}, with the feeders between them, to the
        floors you tick - same positions, new tags. Risers and Cable Size results are not copied.
      </p>
      {typical.length > 0 && (
        <button
          className="btn btn-sm"
          onClick={() => setTicked(new Set([...ticked, ...typical.map((f) => f.id)]))}
        >
          Tick all typical floors ({typical.length})
        </button>
      )}
      <ul className="replicate-floors" aria-label="Floors to replicate to">
        {others.map((f) => {
          const reason = blocked(f);
          const n = existing(f);
          return (
            <li key={f.id}>
              <label>
                <input
                  type="checkbox"
                  checked={ticked.has(f.id)}
                  disabled={!!reason}
                  onChange={(e) => toggle(f.id, e.target.checked)}
                />{' '}
                {f.name}
                {reason && <span className="muted"> - {reason}</span>}
              </label>
              {ticked.has(f.id) && n > 0 && (
                <select
                  aria-label={`${f.name}: it has ${n} components`}
                  value={choices[f.id] ?? ''}
                  onChange={(e) => setChoices({ ...choices, [f.id]: e.target.value as Choice })}
                >
                  <option value="" disabled>
                    Has {n} component{n === 1 ? '' : 's'} - choose
                  </option>
                  <option value="add">Add alongside them</option>
                  <option value="replace">Replace them</option>
                  <option value="skip">Skip this floor</option>
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
