import {
  DemandCategorySchema,
  DeviceTypeSchema,
  EarthLeakageSchema,
  ElementSchema,
  IpRatingSchema,
  LoadCategorySchema,
  LoadTypeCodeSchema,
  LOAD_TYPE_LABELS,
  StarterSchema,
  MountingSchema,
  type Element,
} from '@neuromep/shared';
import { useState } from 'react';
import { NumberInput } from '../../components/fields';

type FieldDef =
  | { key: string; label: string; type: 'number'; unit?: string; placeholder?: string }
  | { key: string; label: string; type: 'text' }
  | { key: string; label: string; type: 'bool' }
  | {
      key: string;
      label: string;
      type: 'select';
      options: readonly string[];
      empty?: string;
      /** Shown text per option (the value is stored). */
      labels?: Record<string, string>;
    }
  | { key: string; label: string; type: 'multi'; options: readonly string[] };

const num = (key: string, label: string, unit?: string): FieldDef => ({
  key,
  label,
  type: 'number',
  unit,
});
const select = (
  key: string,
  label: string,
  options: readonly string[],
  empty?: string,
): FieldDef => ({
  key,
  label,
  type: 'select',
  options,
  empty,
});

const COMMON: FieldDef[] = [
  { key: 'location', label: 'Location / room', type: 'text' },
  select('ipRating', 'IP rating', IpRatingSchema.options, '-'),
  { key: 'fireRated', label: 'Fire rated', type: 'bool' },
];
const BOARD: FieldDef[] = [
  select('poles', 'Poles', ['SPN', 'TPN']),
  select('loadCategory', 'Load category', LoadCategorySchema.options),
  num('standbyKw', 'Standby load', 'kW'),
  select('incomerDevice', 'Incomer device', DeviceTypeSchema.options),
  select('earthLeakage', 'Earth leakage', EarthLeakageSchema.options),
  select('mounting', 'Mounting', MountingSchema.options, '-'),
];

/** Equipment fields per kind (design doc 12.3); calculated values are not entered here. */
function fieldsFor(e: Element, feeders: readonly { id: string; tag: string }[]): FieldDef[] {
  switch (e.kind) {
    // Mechanical / PHE equipment (briefing page 9, 6 Nov 2026): its load goes to its isolator.
    case 'equipment':
      return [
        {
          ...select(
            'fedFromId',
            'Fed from',
            feeders.map((f) => f.id),
            'Not connected (E1803)',
          ),
          labels: Object.fromEntries(feeders.map((f) => [f.id, f.tag])),
        } as FieldDef,
        num('kw', 'Rated power', 'kW'),
        select('phases', 'Phases', ['3P', 'L1', 'L2', 'L3']),
        {
          ...select('loadType', 'Load type', LoadTypeCodeSchema.options),
          labels: LOAD_TYPE_LABELS,
        } as FieldDef,
        { ...num('powerFactor', 'Power factor'), placeholder: 'Load type' } as FieldDef,
        select('starter', 'Starter', StarterSchema.options, '-'),
        // Motor-driven (with a starter): required; otherwise 1.0 when empty (user decision).
        { ...num('efficiency', 'Efficiency'), placeholder: e.starter ? 'TBC' : '1.0' } as FieldDef,
        { key: 'fls', label: 'FLS', type: 'bool' },
      ];
    case 'db':
      return [
        select('demandCategory', 'Demand category', DemandCategorySchema.options, '-'),
        num('powerFactor', 'Power factor'),
        num('thirdHarmonicPct', 'Third harmonic', '%'),
        ...BOARD,
      ];
    case 'lv-panel':
    case 'mdb':
    case 'emdb':
    case 'acb-panel':
    case 'smdb':
    case 'esmdb':
      return [
        {
          key: 'demandCategories',
          label: 'Demand categories',
          type: 'multi',
          options: DemandCategorySchema.options,
        },
        ...BOARD,
        num('icwKa', 'Icw', 'kA'),
        num('ipkKa', 'Ipk', 'kA'),
      ];
    case 'mcc':
    case 'emcc':
      return [
        {
          key: 'demandCategories',
          label: 'Demand categories',
          type: 'multi',
          options: DemandCategorySchema.options,
        },
        ...BOARD,
      ];
    case 'transformer':
      return [
        num('kva', 'Capacity', 'kVA'),
        num('primaryV', 'Primary voltage', 'V'),
        num('ukPct', 'uk', '%'),
        num('urPct', 'ur', '%'),
        { key: 'vectorGroup', label: 'Vector group', type: 'text' },
      ];
    // UPS (7 Nov 2026): its rating and the fault current from its datasheet (not used by the
    // engine yet - short-circuit below a UPS is not calculated until the UPS data is agreed).
    case 'ups':
      return [
        num('kvaOverride', 'Rating', 'kVA'),
        num('sustainedScKa', 'Fault current (datasheet)', 'kA'),
      ];
    case 'generator':
      return [
        num('kvaOverride', 'kVA (override)', 'kVA'),
        num('xdSubtransientPct', "X''d", '%'),
        num('sustainedScKa', 'Sustained short-circuit', 'kA'),
      ];
    // Isolators / connection units stand for the equipment they feed (user decision 6 Nov 2026):
    // its description, load lines (kW per phase and load type) and load category.
    case 'isolator':
    case 'connection-unit':
    case 'tap-off-box':
    case 'motor':
      return [
        select('loadCategory', 'Load category', LoadCategorySchema.options),
        select('demandCategory', 'Demand category', DemandCategorySchema.options, '-'),
        num('standbyKw', 'Standby load', 'kW'),
        select('earthLeakage', 'Earth leakage', EarthLeakageSchema.options),
        // A motor typed on the isolator (manager feedback, 7 Nov 2026): its starter, and the
        // efficiency that turns the rated kW into the input load (required with a starter).
        ...(e.kind === 'tap-off-box'
          ? []
          : [
              select('starter', 'Starter', StarterSchema.options, '-'),
              {
                ...num('efficiency', 'Efficiency'),
                placeholder: e.starter ? 'TBC' : '1.0',
              } as FieldDef,
            ]),
      ];
    case 'busbar':
      return [
        select('busbarType', 'Type', ['feeder', 'tap-off']),
        select('conductor', 'Conductor', ['Cu', 'Al']),
      ];
    default:
      return [];
  }
}

/**
 * Equipment properties of a component (12.3) in the Engineering Property card. Every value is
 * checked against the element schema before it is saved; a refused value shows why (E1502).
 */
export function ElementFields(props: {
  element: Element;
  editable: boolean;
  /** Isolators / connection units equipment may be fed from (tag order). */
  feeders?: readonly { id: string; tag: string }[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { element } = props;
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const values = element as unknown as Record<string, unknown>;

  function commit(key: string, value: unknown) {
    const parsed = ElementSchema.safeParse({ ...element, [key]: value });
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === key) ?? parsed.error.issues[0];
      setError({ key, text: `${issue?.message ?? 'Not a valid value'} (E1502)` });
      return;
    }
    setError(null);
    props.onChange({ [key]: value });
  }

  return (
    <>
      {[...fieldsFor(element, props.feeders ?? []), ...COMMON].map((f) => {
        const id = `prop-${f.key}`;
        const value = values[f.key];
        return (
          <div key={f.key} className="prop-row">
            <dt>
              <label htmlFor={id}>{f.label} :</label>
            </dt>
            <dd>
              {f.type === 'number' ? (
                <span className="prop-number">
                  <NumberInput
                    id={id}
                    className="pill-input"
                    value={(value as number | null) ?? null}
                    commit="blur"
                    placeholder={f.placeholder ?? 'TBC'}
                    disabled={!props.editable}
                    invalid={error?.key === f.key}
                    onChange={(v) => commit(f.key, v)}
                  />
                  {f.unit && <span className="muted">{f.unit}</span>}
                </span>
              ) : f.type === 'text' ? (
                <input
                  id={id}
                  className="pill-input"
                  defaultValue={(value as string) ?? ''}
                  disabled={!props.editable}
                  onBlur={(e) => e.target.value !== value && commit(f.key, e.target.value)}
                />
              ) : f.type === 'bool' ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={!props.editable}
                  onChange={(e) => commit(f.key, e.target.checked)}
                />
              ) : f.type === 'select' ? (
                <select
                  id={id}
                  className="select"
                  value={(value as string | null) ?? ''}
                  disabled={!props.editable}
                  onChange={(e) => commit(f.key, e.target.value || null)}
                >
                  {f.empty !== undefined && <option value="">{f.empty}</option>}
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {f.labels?.[o] ?? o}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="prop-multi" id={id} role="group" aria-label={f.label}>
                  {f.options.map((o) => {
                    const list = (value as string[]) ?? [];
                    return (
                      <label key={o} className="check">
                        <input
                          type="checkbox"
                          checked={list.includes(o)}
                          disabled={!props.editable}
                          onChange={(e) =>
                            commit(
                              f.key,
                              e.target.checked ? [...list, o] : list.filter((x) => x !== o),
                            )
                          }
                        />
                        {o}
                      </label>
                    );
                  })}
                </span>
              )}
              {error?.key === f.key && <span className="field-error">{error.text}</span>}
            </dd>
          </div>
        );
      })}
    </>
  );
}
