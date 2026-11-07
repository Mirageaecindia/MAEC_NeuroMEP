import {
  cableLength,
  DEFAULT_BUSBAR,
  IpRatingSchema,
  type BusbarSpec,
  type Cable,
  type Element,
  type FeederType,
  type LengthRule,
} from '@neuromep/shared';
import { useState } from 'react';

const m = (v: number) => `${v.toFixed(2)} m`;

/**
 * Engineering Property of a selected feeder (FR-15): Cable or Busbar (decision 1 Nov 2026), tag,
 * ends, circuit reference, cable construction or busbar fields (12.3), and the length the engine
 * will use - routed + the fixed addition per cable (5 m, 3 Nov 2026) + any 12.2 allowance.
 */
export function CableProperty(props: {
  cable: Cable;
  elements: readonly Element[];
  /** How lengths are built (rule pack); null without a rule pack. */
  length: (LengthRule & { interim: boolean }) | null;
  editable: boolean;
  takenTags: string[];
  onChange: (patch: { tag?: string; feederType?: FeederType; busbar?: BusbarSpec }) => void;
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
  const length = cableLength(cable, props.length ?? { allowancePct: 0, additionM: null });
  const c = cable.construction;
  const isBusbar = cable.feederType === 'busbar';
  const bb = cable.busbar ?? DEFAULT_BUSBAR;
  const setBusbar = (patch: Partial<BusbarSpec>) => props.onChange({ busbar: { ...bb, ...patch } });

  return (
    <section className="property-card" aria-label="Engineering Property">
      <h3>Engineering Property</h3>
      <dl>
        <dt>Name :</dt>
        <dd>Feeder</dd>
        <dt>
          <label htmlFor="feeder-type">Type :</label>
        </dt>
        <dd>
          <select
            id="feeder-type"
            className="pill-input"
            value={cable.feederType}
            disabled={!props.editable}
            onChange={(e) => {
              const feederType = e.target.value as FeederType;
              props.onChange(feederType === 'busbar' ? { feederType, busbar: bb } : { feederType });
            }}
          >
            <option value="cable">Cable</option>
            <option value="busbar">Busbar</option>
          </select>
        </dd>
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
        {isBusbar ? (
          <>
            <dt>Busbar :</dt>
            <dd>Feeder type, TPN+E, 600/1000 V</dd>
            <dt>
              <label htmlFor="busbar-conductor">Conductor :</label>
            </dt>
            <dd>
              <select
                id="busbar-conductor"
                className="pill-input"
                value={bb.conductor}
                disabled={!props.editable}
                onChange={(e) =>
                  setBusbar({ conductor: e.target.value as BusbarSpec['conductor'] })
                }
              >
                <option value="Cu">Cu</option>
                <option value="Al">Al</option>
              </select>
            </dd>
            <dt>
              <label htmlFor="busbar-ip">IP :</label>
            </dt>
            <dd>
              <select
                id="busbar-ip"
                className="pill-input"
                value={bb.ipRating ?? ''}
                disabled={!props.editable}
                onChange={(e) =>
                  setBusbar({
                    ipRating: e.target.value ? (e.target.value as BusbarSpec['ipRating']) : null,
                  })
                }
              >
                <option value="">Select</option>
                {IpRatingSchema.options.map((ip) => (
                  <option key={ip}>{ip}</option>
                ))}
              </select>
            </dd>
            <dt>
              <label htmlFor="busbar-fire">Fire rated :</label>
            </dt>
            <dd>
              <input
                id="busbar-fire"
                type="checkbox"
                checked={bb.fireRated}
                disabled={!props.editable}
                onChange={(e) => setBusbar({ fireRated: e.target.checked })}
              />
            </dd>
          </>
        ) : (
          <>
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
          </>
        )}
        <dt>Length :</dt>
        <dd>
          <span>
            <strong>{m(length.totalM)}</strong>
          </span>
          <span className="muted">
            routed {m(length.routedM)} + {m(length.additionM)} added
            {length.allowanceM > 0 &&
              ` + ${props.length!.allowancePct} %${props.length!.interim ? ' (interim, OI-17)' : ''} ${m(length.allowanceM)}`}
          </span>
        </dd>
        {isBusbar ? (
          <>
            <dt>Rating :</dt>
            <dd className="muted">Calculated by Cable Size</dd>
            <dt>Fault duty :</dt>
            <dd className="muted">Calculated by Cable Size</dd>
            <dt>R / X / Icw :</dt>
            <dd className="muted">Datasheet required (OI-13)</dd>
          </>
        ) : (
          <>
            <dt>Size :</dt>
            <dd className="muted">Calculated by Cable Size</dd>
          </>
        )}
      </dl>
      {props.editable && (
        <button className="btn btn-sm btn-danger-outline" onClick={props.onDelete}>
          Delete feeder
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
