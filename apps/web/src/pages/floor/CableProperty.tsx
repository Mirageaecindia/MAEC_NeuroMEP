import { cableLength, type Cable, type Element } from '@neuromep/shared';
import { useState } from 'react';

const m = (v: number) => `${v.toFixed(2)} m`;

/**
 * Engineering Property of a selected cable (FR-15): tag, ends, circuit reference, construction
 * and the length the engine will use - routed + 1 m vertical (A-05) + the 12.2 allowance.
 */
export function CableProperty(props: {
  cable: Cable;
  elements: readonly Element[];
  /** Length allowance (%) and whether it is the interim value of an open item (OI-17). */
  allowance: { pct: number; interim: boolean } | null;
  editable: boolean;
  takenTags: string[];
  onChange: (patch: { tag: string }) => void;
  onEditConstruction: () => void;
  onDelete: () => void;
}) {
  const { cable } = props;
  const [tag, setTag] = useState(cable.tag);
  const taken = new Set(props.takenTags.map((t) => t.toLowerCase()));
  const tagError = !tag.trim()
    ? 'Enter a tag.'
    : taken.has(tag.trim().toLowerCase())
      ? 'Another cable already has this tag.'
      : null;
  const end = (id: string, port: string) => {
    const e = props.elements.find((x) => x.id === id);
    return `${e?.tag ?? '?'}${port === 'normal' || port === 'standby' ? ` (${port})` : ''}`;
  };
  const length = cableLength(cable, props.allowance?.pct ?? 0);
  const c = cable.construction;

  return (
    <section className="property-card" aria-label="Engineering Property">
      <h3>Engineering Property</h3>
      <dl>
        <dt>Name :</dt>
        <dd>Cable</dd>
        <dt>
          <label htmlFor="cable-tag">Tag :</label>
        </dt>
        <dd>
          <input
            id="cable-tag"
            className="pill-input"
            value={tag}
            disabled={!props.editable}
            aria-invalid={tagError !== null}
            onChange={(e) => setTag(e.target.value)}
            onBlur={() => {
              if (tagError) setTag(cable.tag);
              else if (tag.trim() !== cable.tag) props.onChange({ tag: tag.trim() });
            }}
          />
          {tagError && <span className="field-error">{tagError}</span>}
        </dd>
        <dt>From :</dt>
        <dd>{end(cable.from.elementId, cable.from.port)}</dd>
        <dt>To :</dt>
        <dd>{end(cable.to.elementId, cable.to.port)}</dd>
        <dt>Circuit :</dt>
        <dd>{cable.circuitRef}</dd>
        <dt>Construction :</dt>
        <dd>
          {c.cores} {c.conductor}/{c.insulation}/{c.armour}/{c.sheath}, {c.voltageGrade}, method{' '}
          {c.method}
          {installation(c) && <span className="muted">{installation(c)}</span>}
          {props.editable && (
            <button className="btn-link" onClick={props.onEditConstruction}>
              Change
            </button>
          )}
        </dd>
        <dt>Length :</dt>
        <dd>
          <span>
            <strong>
              {props.allowance
                ? m(length.totalM)
                : `${m(length.routedM + length.verticalM)} + allowance TBC`}
            </strong>
          </span>
          <span className="muted">
            routed {m(length.routedM)} + vertical {m(length.verticalM)}
            {props.allowance &&
              ` + ${props.allowance.pct} %${props.allowance.interim ? ' (interim, OI-17)' : ''} ${m(length.allowanceM)}`}
          </span>
        </dd>
        <dt>Size :</dt>
        <dd className="muted">Calculated by Cable Size</dd>
      </dl>
      {props.editable && (
        <button className="btn btn-sm btn-danger-outline" onClick={props.onDelete}>
          Delete cable
        </button>
      )}
    </section>
  );
}

/** Installation details that were entered (12.3); TBC ones are left out. */
function installation(c: Cable['construction']): string {
  return [
    c.trays !== null && `${c.trays} tray${c.trays === 1 ? '' : 's'}`,
    c.groupedCircuits !== null && `${c.groupedCircuits} grouped circuits`,
    c.separation !== null && `separation ${c.separation}`,
    c.depthM !== null && `${c.depthM} m deep`,
  ]
    .filter(Boolean)
    .join(', ');
}
