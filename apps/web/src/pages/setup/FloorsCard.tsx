import {
  computeLevels,
  floorTags,
  generateRegistry,
  planStatus,
  type FloorCounts,
  type RegistryChange,
} from '@neuromep/shared';
import { useState } from 'react';
import { Card, fieldDomId, Modal, NumberInput } from '../../components/fields';
import type { CardProps } from './cardProps';

const TYPE_LABELS = {
  basement: 'Basement',
  ground: 'Ground',
  podium: 'Podium',
  typical: 'Typical',
} as const;
export const STATUS_CLASS = {
  'No plan': 'tag',
  Uncalibrated: 'tag tag-tbc',
  Calibrated: 'tag tag-ok',
} as const;

const COUNT_FIELDS = [
  ['basements', 'No. of basements'],
  ['podiums', 'No. of podium levels'],
  ['typicals', 'No. of typical floors'],
] as const;

/** Card 4 - Floors & Elevations (FR-06). */
export function FloorsCard({ project, dispatch, readOnly, errorFor, touch }: CardProps) {
  const b = project.building;
  const [fillHeight, setFillHeight] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ counts: FloorCounts; change: RegistryChange } | null>(
    null,
  );
  const levels = computeLevels(b.floors, b.gfLevelM);
  const tags = floorTags(b);

  function generate() {
    const counts = {
      basements: b.counts.basements ?? 0,
      podiums: b.counts.podiums ?? 0,
      typicals: b.counts.typicals ?? 0,
    };
    if (Object.values(counts).some((n) => !Number.isInteger(n) || n < 0 || n > 200)) {
      setCountError('Floor counts must be whole numbers from 0 to 200.');
      return;
    }
    setCountError(null);
    const change = generateRegistry(counts, b.floors, () => crypto.randomUUID());
    if (change.removedWithPlans.length > 0) setPending({ counts, change });
    else dispatch({ type: 'applyRegistry', counts, change });
  }

  return (
    <Card n={4} title="Floors & Elevations">
      <div className="floors-inputs">
        {COUNT_FIELDS.map(([key, label]) => (
          <div className="field" key={key}>
            <label className="field-label" htmlFor={`count-${key}`}>
              {label}
            </label>
            <NumberInput
              id={`count-${key}`}
              value={b.counts[key]}
              placeholder="0"
              disabled={readOnly}
              onChange={(v) => dispatch({ type: 'counts', counts: { [key]: v } })}
            />
          </div>
        ))}
        <div className="field">
          <span className="field-label">Ground floor</span>
          <input className="input" value="1" disabled aria-label="Ground floor (always 1)" />
        </div>
        <div className="field" id={fieldDomId('building.registry')}>
          <span className="field-label">&nbsp;</span>
          <button className="btn btn-primary" disabled={readOnly} onClick={generate}>
            {b.floors.length ? 'Update floor registry' : 'Generate floor registry'}
          </button>
        </div>
      </div>
      {(countError || errorFor('building.registry')) && (
        <p className="field-error">{countError ?? errorFor('building.registry')}</p>
      )}

      {b.floors.length > 0 && (
        <>
          <div className="floors-inputs">
            {([0, 1, 2] as const).map((i) => (
              <div className="field" key={i}>
                <label
                  className="field-label"
                  htmlFor={fieldDomId(`building.mechanicalFloor${i + 1}`)}
                >
                  Mechanical floor {i + 1} <span className="muted">(optional)</span>
                </label>
                <select
                  id={fieldDomId(`building.mechanicalFloor${i + 1}`)}
                  className="select"
                  value={b.mechanicalFloorIds[i] ?? ''}
                  disabled={readOnly}
                  onChange={(e) =>
                    dispatch({ type: 'mechanicalFloor', index: i, floorId: e.target.value || null })
                  }
                >
                  <option value="">None</option>
                  {b.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} – {f.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field">
              <label className="field-label" htmlFor="gf-level">
                GF finished floor level <span className="muted">(m)</span>
              </label>
              <NumberInput
                id="gf-level"
                value={b.gfLevelM}
                disabled={readOnly}
                onChange={(v) => dispatch({ type: 'gfLevel', value: v ?? 0 })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="fill-height">
                Fill all heights <span className="muted">(m)</span>
              </label>
              <div className="input-group">
                <NumberInput
                  id="fill-height"
                  value={fillHeight}
                  placeholder="e.g. 4.0"
                  disabled={readOnly}
                  onChange={setFillHeight}
                />
                <button
                  className="btn"
                  disabled={readOnly || fillHeight === null}
                  onClick={() =>
                    fillHeight !== null && dispatch({ type: 'fillHeights', value: fillHeight })
                  }
                >
                  Fill all
                </button>
              </div>
            </div>
          </div>

          <table className="table registry">
            <thead>
              <tr>
                <th className="num">Order</th>
                <th>Floor code</th>
                <th>Floor name</th>
                <th>Type</th>
                <th className="num">Finished floor level (m)</th>
                <th>Floor-to-floor height (m)</th>
                <th>Plan status</th>
              </tr>
            </thead>
            <tbody>
              {[...b.floors].reverse().map((f) => {
                const order = b.floors.indexOf(f) + 1;
                const field = `floor.${f.id}.height`;
                const error = errorFor(field);
                const level = levels.get(f.id);
                const status = planStatus(f);
                return (
                  <tr key={f.id}>
                    <td className="num">{order}</td>
                    <td>
                      <strong>{f.code}</strong>{' '}
                      {tags.get(f.id)?.map((t) => (
                        <span key={t} className="tag tag-default">
                          {t}
                        </span>
                      ))}
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={`${f.code} floor name`}
                        value={f.name}
                        disabled={readOnly}
                        onChange={(e) =>
                          dispatch({
                            type: 'floor',
                            floorId: f.id,
                            patch: { name: e.target.value },
                          })
                        }
                      />
                    </td>
                    <td>{TYPE_LABELS[f.type]}</td>
                    <td className="num">
                      {level === null || level === undefined ? '—' : level.toFixed(2)}
                    </td>
                    <td style={{ width: 170 }}>
                      <NumberInput
                        id={fieldDomId(field)}
                        ariaLabel={`${f.code} floor-to-floor height`}
                        value={f.heightM}
                        placeholder="2.5 – 10"
                        disabled={readOnly}
                        invalid={!!error}
                        onBlur={() => touch(field)}
                        onChange={(v) =>
                          dispatch({ type: 'floor', floorId: f.id, patch: { heightM: v } })
                        }
                      />
                      {error && <div className="field-error">{error}</div>}
                    </td>
                    <td>
                      <span className={STATUS_CLASS[status]}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="field-hint">
            Listed top to bottom. A floor's height is measured up to the floor above; levels above
            GF add up the heights, basement levels are negative.
          </p>
        </>
      )}

      {pending && (
        <Modal
          title="Remove floors with plans?"
          onClose={() => setPending(null)}
          actions={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Keep current floors
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  dispatch({ type: 'applyRegistry', ...pending });
                  setPending(null);
                }}
              >
                Remove {pending.change.removed.length} floor
                {pending.change.removed.length === 1 ? '' : 's'}
              </button>
            </>
          }
        >
          <p>
            The new counts remove these floors. Floors with an uploaded plan lose the plan and its
            calibration:
          </p>
          <ul>
            {pending.change.removed.map((f) => (
              <li key={f.id}>
                <strong>{f.code}</strong> {f.name}
                {f.plan && (
                  <span className="muted">
                    {' '}
                    – plan {f.plan.fileName} ({planStatus(f)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </Card>
  );
}
