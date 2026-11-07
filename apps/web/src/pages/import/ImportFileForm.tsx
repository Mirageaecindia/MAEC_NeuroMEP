import {
  CALCULATION_CHECK_LABELS,
  DEMAND_CATEGORY_LABELS,
  DESIGN_STAGE_LABELS,
  DesignStageSchema,
  generateRegistry,
  typicalSet,
  LOAD_TYPE_LABELS,
  PROJECT_CATEGORY_LABELS,
  ProjectCategorySchema,
  REGION_LABELS,
  RegionSchema,
  type CalculationCheck,
  type DemandCategory,
  type FloorCounts,
  type LoadTypeCode,
  type RegistryChange,
  type UserSummary,
  BUSBAR_MAKER_LABELS,
  BusbarMakerSchema,
  DEMAND_METHOD_LABELS,
  DemandMethodSchema,
} from '@neuromep/shared';
import {
  demandFactorsFor,
  getRulePack,
  loadPowerFactorKey,
  loadPowerFactors,
  REGION_RULE_PACKS,
  type RulePack,
} from '@neuromep/rulepacks';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../auth/AuthContext';
import { fieldDomId, Modal, NumberInput } from '../../components/fields';
import { UserMultiSelect } from '../../components/UserMultiSelect';
import { newAudit, type CardProps } from '../../workspace/formProps';
import './import.css';

/** Load types in the order of the Figma grid (Import File and the Building tab dialog). */
export const LOAD_TYPE_GRID: LoadTypeCode[] = [
  '1',
  '2',
  '10',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '3',
  '11',
  '12',
];
const CATEGORIES: DemandCategory[] = ['landlord', 'residential', 'office', 'retail'];
/** A-06: always calculated. */
const FIXED_CHECKS: CalculationCheck[] = ['currentCarryingCapacity', 'voltageDrop'];
const OPTIONAL_CHECKS: CalculationCheck[] = [
  'shortCircuit',
  'letThroughEnergy',
  'earthFaultLoopImpedance',
];

function Row(props: {
  label: string;
  required?: boolean;
  field: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="form-row">
      <label className="form-label" htmlFor={fieldDomId(props.field)}>
        {props.label}
        {props.required && <span className="req">*</span>}
      </label>
      <div className="form-control">
        {props.children}
        {props.error && <span className="field-error">{props.error}</span>}
      </div>
    </div>
  );
}

/** Import File form (Figma screen 2): project data, calculation set-up, discipline assignment. */
export function ImportFileForm(props: CardProps & { plans?: ReactNode }) {
  const { project, dispatch, readOnly, errorFor, touch, user } = props;
  const d = project.details;
  const c = project.calculation;
  const pack =
    project.rulePackId && project.rulePackVersion
      ? getRulePack(project.rulePackId, project.rulePackVersion)
      : null;
  const api = useApi();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [pending, setPending] = useState<{ counts: FloorCounts; change: RegistryChange } | null>(
    null,
  );
  const [countsKey, setCountsKey] = useState(0);
  useEffect(() => {
    api.users().then(
      (r) => setUsers(r.users),
      () => setUsers([]),
    );
  }, [api]);

  const text = (field: 'name' | 'location' | 'clientName' | 'plotRef', label: string) => (
    <Row label={label} required field={`details.${field}`} error={errorFor(`details.${field}`)}>
      <input
        id={fieldDomId(`details.${field}`)}
        className="pill-input"
        value={d[field]}
        disabled={readOnly}
        onBlur={() => touch(`details.${field}`)}
        onChange={(e) => dispatch({ type: 'details', patch: { [field]: e.target.value } })}
      />
    </Row>
  );

  const site = (key: 'ambientAirC' | 'ambientSoilC' | 'soilResistivity', label: string) => (
    <Row label={label} required field={`site.${key}`} error={errorFor(`site.${key}`)}>
      <NumberInput
        id={fieldDomId(`site.${key}`)}
        className="pill-input"
        value={project.site[key].value}
        disabled={readOnly}
        commit="blur"
        onBlur={() => touch(`site.${key}`)}
        onChange={(value) => dispatch({ type: 'site', key, value })}
      />
    </Row>
  );

  /** Floors (12.1, user request 7 Nov 2026): the registry follows the counts immediately. */
  function setCount(key: 'typicals' | 'basements' | 'grounds' | 'podiums', value: number | null) {
    const next = { ...project.building.counts, [key]: value };
    const valid = (n: number | null, max: number, min = 0) =>
      n === null || (Number.isInteger(n) && n >= min && n <= max);
    if (
      next.typicals === null ||
      !valid(next.typicals, 200) ||
      !valid(next.basements, 20) ||
      !valid(next.grounds, 5, 1) ||
      !valid(next.podiums, 20)
    ) {
      dispatch({ type: 'counts', counts: { [key]: value } });
      return;
    }
    const counts: FloorCounts = {
      basements: next.basements ?? 0,
      grounds: next.grounds ?? 1,
      podiums: next.podiums ?? 0,
      typicals: next.typicals,
    };
    const change = generateRegistry(counts, project.building.floors, () => crypto.randomUUID());
    if (change.removedWithPlans.length > 0) setPending({ counts, change });
    else dispatch({ type: 'applyRegistry', counts, change });
  }

  const count = (
    key: 'typicals' | 'basements' | 'grounds' | 'podiums',
    label: string,
    placeholder?: string,
    required?: boolean,
  ) => (
    <Row
      label={label}
      required={required}
      field={`building.counts.${key}`}
      error={errorFor(`building.counts.${key}`)}
    >
      <NumberInput
        key={`${key}${countsKey}`}
        id={fieldDomId(`building.counts.${key}`)}
        className="pill-input center"
        value={project.building.counts[key]}
        placeholder={placeholder}
        disabled={readOnly}
        commit="blur"
        onBlur={() => touch(`building.counts.${key}`)}
        onChange={(v) => setCount(key, v)}
      />
    </Row>
  );
  // Mechanical floors are chosen from the floors above ground (podium and typical floors).
  const upper = project.building.floors.filter((f) => f.type === 'podium' || f.type === 'typical');
  const typical = typicalSet(project.building);

  return (
    <div className="import-form">
      <section className="import-left" aria-label="Project details">
        {text('name', 'Project Name')}
        {text('location', 'Location')}
        <Row
          label="Design Stage"
          required
          field="details.designStage"
          error={errorFor('details.designStage')}
        >
          <select
            id={fieldDomId('details.designStage')}
            className="pill-input pill-select"
            value={d.designStage ?? ''}
            disabled={readOnly}
            onBlur={() => touch('details.designStage')}
            onChange={(e) =>
              dispatch({
                type: 'details',
                patch: { designStage: e.target.value as typeof d.designStage },
              })
            }
          >
            <option value="" disabled>
              Select
            </option>
            {DesignStageSchema.options.map((s) => (
              <option key={s} value={s} title={DESIGN_STAGE_LABELS[s]}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        {text('clientName', 'Client Name')}
        {text('plotRef', 'Plot Ref')}
        {props.plans ?? (
          <div className="form-row">
            <span className="form-label">Floor Plans</span>
            <div className="form-control">
              <span className="field-hint">
                Save the project first, then upload its floor plans.
              </span>
            </div>
          </div>
        )}
        <Row
          label="Project Category"
          required
          field="details.category"
          error={errorFor('details.category')}
        >
          <select
            id={fieldDomId('details.category')}
            className="pill-input pill-select"
            value={d.category ?? ''}
            disabled={readOnly}
            onBlur={() => touch('details.category')}
            onChange={(e) =>
              dispatch({
                type: 'details',
                patch: { category: e.target.value as typeof d.category },
              })
            }
          >
            <option value="" disabled>
              Select
            </option>
            {ProjectCategorySchema.options.map((s) => (
              <option key={s} value={s}>
                {PROJECT_CATEGORY_LABELS[s]}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Plot Load Allocation"
          required
          field="details.plotLoad"
          error={errorFor('details.plotLoad')}
        >
          <div className="pill-pair">
            <NumberInput
              id={fieldDomId('details.plotLoad')}
              className="pill-input"
              value={d.plotLoad.value}
              disabled={readOnly}
              commit="blur"
              onBlur={() => touch('details.plotLoad')}
              onChange={(v) =>
                dispatch({ type: 'details', patch: { plotLoad: { ...d.plotLoad, value: v } } })
              }
            />
            <select
              className="pill-input pill-select unit"
              aria-label="Plot load unit"
              value={d.plotLoad.unit}
              disabled={readOnly}
              onChange={(e) =>
                dispatch({
                  type: 'details',
                  patch: { plotLoad: { ...d.plotLoad, unit: e.target.value as 'kW' | 'kVA' } },
                })
              }
            >
              <option value="kW">KW</option>
              <option value="kVA">KVA</option>
            </select>
          </div>
        </Row>
        {site('ambientAirC', 'Ambient Air  Temp (Deg)')}
        {site('ambientSoilC', 'Ambient Soil  Temp (Deg)')}
        {site('soilResistivity', 'Soil Thermal Resistivity (DegC.m/W)')}
        <Row label="Altitude" field="site.altitudeM" error={errorFor('site.altitudeM')}>
          <NumberInput
            id={fieldDomId('site.altitudeM')}
            className="pill-input"
            value={project.site.altitudeM}
            disabled={readOnly}
            commit="blur"
            onBlur={() => touch('site.altitudeM')}
            onChange={(value) => dispatch({ type: 'altitude', value })}
          />
        </Row>
        <p className="form-group-label">
          No of Floors
          {project.building.floors.length > 0 && (
            <span className="muted"> - {project.building.floors.length} floors in total</span>
          )}
        </p>
        {count('basements', 'No of Basements', '0')}
        {count('grounds', 'GF (ground levels)', '1')}
        {count('podiums', 'No of Podium levels', '0')}
        {count('typicals', 'No of Typical floors', undefined, true)}
        {[0, 1, 2].map((i) => (
          <Row
            key={i}
            label={`Mechanical floor-${i + 1} ref`}
            field={`building.mechanicalFloor${i + 1}`}
            error={errorFor(`building.mechanicalFloor${i + 1}`)}
          >
            <select
              id={fieldDomId(`building.mechanicalFloor${i + 1}`)}
              className="pill-input pill-select"
              value={project.building.mechanicalFloorIds[i] ?? ''}
              disabled={readOnly || upper.length === 0}
              onChange={(e) =>
                dispatch({ type: 'mechanicalFloor', index: i, floorId: e.target.value || null })
              }
            >
              <option value="">None</option>
              {upper.map((f) => (
                <option
                  key={f.id}
                  value={f.id}
                  disabled={project.building.mechanicalFloorIds.some(
                    (id, j) => j !== i && id === f.id,
                  )}
                >
                  {f.name}
                </option>
              ))}
            </select>
          </Row>
        ))}
        {typical.length > 1 && (
          <p className="form-hint muted">
            {typical.length} typical floors are identical: one plan uploaded on Floor Setup can be
            used for all of them. Mechanical floors keep their own plan.
          </p>
        )}
      </section>

      <section className="import-right" aria-label="Calculation Setup">
        <h2 className="import-heading">Calculation Setup</h2>
        <Row
          label="Region"
          required
          field="calculation.region"
          error={errorFor('calculation.region')}
        >
          <select
            id={fieldDomId('calculation.region')}
            className="pill-input pill-select"
            value={c.region ?? ''}
            disabled={readOnly}
            onChange={(e) =>
              dispatch({ type: 'region', region: e.target.value as NonNullable<typeof c.region> })
            }
          >
            <option value="" disabled>
              Select
            </option>
            {RegionSchema.options.map((r) => (
              <option
                key={r}
                value={r}
                disabled={!REGION_RULE_PACKS[r]}
                title={REGION_RULE_PACKS[r] ? undefined : 'Rule pack not available yet'}
              >
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Upstream Short-circuit Capacity (MVA)"
          required
          field="calculation.upstreamFaultMva"
          error={errorFor('calculation.upstreamFaultMva')}
        >
          <NumberInput
            id={fieldDomId('calculation.upstreamFaultMva')}
            className="pill-input"
            value={c.upstreamFaultMva}
            placeholder="e.g. 350"
            disabled={readOnly}
            commit="blur"
            onBlur={() => touch('calculation.upstreamFaultMva')}
            onChange={(value) => dispatch({ type: 'upstreamMva', value })}
          />
        </Row>
        <Row label="Busbar Manufacturer" field="calculation.busbarMaker" error={null}>
          <select
            id={fieldDomId('calculation.busbarMaker')}
            className="pill-input pill-select"
            value={c.busbarMaker ?? ''}
            disabled={readOnly}
            title="R, X, Icw and Ipk of busbar feeders and risers come from this maker's data"
            onChange={(e) =>
              dispatch({
                type: 'busbarMaker',
                maker: (e.target.value || null) as typeof c.busbarMaker,
              })
            }
          >
            <option value="">Select</option>
            {BusbarMakerSchema.options.map((m) => (
              <option key={m} value={m}>
                {BUSBAR_MAKER_LABELS[m]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Transformer Loading" field="calculation.transformerLoading" error={null}>
          <label
            className="check"
            title="Maximum demand on each transformer is checked against this share of its kVA (10.15); 100 % when not ticked"
          >
            <input
              id={fieldDomId('calculation.transformerLoading')}
              type="checkbox"
              checked={c.defaultOverrides.transformerLoadingLimitPct === 80}
              disabled={readOnly || !pack}
              onChange={(e) =>
                dispatch({
                  type: 'defaultOverride',
                  key: 'transformerLoadingLimitPct',
                  value: e.target.checked ? 80 : undefined,
                  ruleValue:
                    pack?.calculationDefaults.find((d) => d.key === 'transformerLoadingLimitPct')
                      ?.value ?? null,
                  audit: newAudit(user),
                })
              }
            />
            Limit to 80 %
          </label>
        </Row>
        <div className="form-row checks-row">
          <span className="form-label">
            Calculation Based On<span className="req">*</span>
          </span>
          <div className="checks-inline">
            {[...FIXED_CHECKS, ...OPTIONAL_CHECKS].map((check) => {
              const fixed = FIXED_CHECKS.includes(check);
              return (
                <label
                  key={check}
                  className="check"
                  title={fixed ? 'Always calculated (A-06)' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={fixed || c.checks[check]}
                    disabled={fixed || readOnly}
                    onChange={(e) => dispatch({ type: 'check', check, enabled: e.target.checked })}
                  />
                  {CALCULATION_CHECK_LABELS[check]}
                </label>
              );
            })}
          </div>
        </div>

        <Row label="Demand Method" field="calculation.demandMethod" error={null}>
          <select
            id={fieldDomId('calculation.demandMethod')}
            className="pill-input pill-select"
            value={c.demandMethod}
            disabled={readOnly}
            onChange={(e) => {
              const method = e.target.value as typeof c.demandMethod;
              dispatch({
                type: 'demandMethod',
                method,
                factors: pack ? demandFactorsFor(method, c.demandFactors, pack) : c.demandFactors,
              });
            }}
          >
            {DemandMethodSchema.options.map((m) => (
              <option key={m} value={m}>
                {DEMAND_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Row>
        <p className="field-hint">
          {c.demandMethod === 'manual'
            ? 'The load-type factors apply at every board.'
            : 'Category factors apply at the LV panel / MDB only; SMDBs take the SMDB-level factor and everything below is at 100 %.'}
        </p>
        <div className="df-grid">
          <div className={`df-col${c.demandMethod === 'manual' ? ' df-unused' : ''}`}>
            <h3>Demand Load Category</h3>
            {CATEGORIES.map((cat) => (
              <DfInput
                key={cat}
                label={DEMAND_CATEGORY_LABELS[cat]}
                field={`calculation.demandFactors.byCategory.${cat}`}
                value={c.demandFactors.byCategory[cat].value}
                {...props}
                onCommit={(value) =>
                  dispatch({
                    type: 'demandFactor',
                    table: 'byCategory',
                    key: cat,
                    value,
                    audit: newAudit(user),
                  })
                }
              />
            ))}
            {c.demandMethod !== 'manual' && (
              <DfInput
                label="SMDB level"
                field="calculation.demandFactors.secondLevel"
                value={c.demandFactors.secondLevel.value}
                {...props}
                onCommit={(value) =>
                  dispatch({ type: 'secondLevelFactor', value, audit: newAudit(user) })
                }
              />
            )}
          </div>
          <div className={`df-col df-types${c.demandMethod === 'manual' ? '' : ' df-unused'}`}>
            <h3>Load Type</h3>
            <div className="df-type-grid">
              {LOAD_TYPE_GRID.map((code) => (
                <DfInput
                  key={code}
                  label={LOAD_TYPE_LABELS[code]}
                  field={`calculation.demandFactors.byLoadType.${code}`}
                  value={c.demandFactors.byLoadType[code].value}
                  {...props}
                  onCommit={(value) =>
                    dispatch({
                      type: 'demandFactor',
                      table: 'byLoadType',
                      key: code,
                      value,
                      audit: newAudit(user),
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>

        {pack && <LoadPowerFactorGrid {...props} pack={pack} />}

        <div
          className="disciplines"
          aria-label="Discipline Engineer Assignments and Access Control"
        >
          <h3>Discipline Engineer Assignments and Access Control</h3>
          {(
            [
              ['electrical', 'Electrical Eng.', 'ELECTRICAL_ENGINEER', true, 'var(--elec)'],
              ['mechanical', 'Mechanical Eng.', 'MECHANICAL_ENGINEER', false, 'var(--mech)'],
              ['phe', 'PHE Eng.', 'PHE_ENGINEER', false, 'var(--phe)'],
            ] as const
          ).map(([key, label, role, required, color]) => (
            <UserMultiSelect
              key={key}
              field={`disciplines.${key}`}
              label={label}
              color={color}
              required={required}
              hint=""
              users={users.filter((u) => u.role === role || u.role === 'TECHNICAL_LEAD')}
              allUsers={users}
              selected={project.disciplines[key]}
              disabled={readOnly}
              error={errorFor(`disciplines.${key}`)}
              onBlur={() => touch(`disciplines.${key}`)}
              onChange={(userIds) => dispatch({ type: 'disciplines', discipline: key, userIds })}
            />
          ))}
        </div>
      </section>

      {pending && (
        <Modal
          title="Remove floors with plans?"
          onClose={() => {
            setPending(null);
            setCountsKey((k) => k + 1);
          }}
          actions={
            <>
              <button
                className="btn"
                onClick={() => {
                  setPending(null);
                  setCountsKey((k) => k + 1);
                }}
              >
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
            The new number of floors removes these floors, including their plans and calibration:
          </p>
          <ul>
            {pending.change.removed.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong>
                {f.plan && <span className="muted"> - plan {f.plan.fileName}</span>}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/**
 * Power factor per load type (manager 3 Nov 2026, editable): the rule-pack value unless the
 * Technical Lead types another; emptying the field returns to the rule-pack value. Types the
 * engineer gave no value for show the default load power factor.
 */
function LoadPowerFactorGrid(props: CardProps & { pack: RulePack }) {
  const { project, dispatch, user, pack } = props;
  const pfs = loadPowerFactors(project, pack);
  return (
    <div className="df-col df-types pf-types" aria-label="Load Power Factor">
      <h3>Load Power Factor</h3>
      <div className="df-type-grid">
        {LOAD_TYPE_GRID.map((code) => {
          const key = loadPowerFactorKey(code);
          const rule = pack.calculationDefaults.find((d) => d.key === key);
          const value = pfs.byType[code] ?? pfs.defaultPf;
          const id = fieldDomId(`calculation.powerFactor.${code}`);
          return (
            <div className="df-row" key={code} title={rule?.note}>
              <label htmlFor={id}>{LOAD_TYPE_LABELS[code]}</label>
              <PfField
                id={id}
                label={`${LOAD_TYPE_LABELS[code]} power factor`}
                value={value}
                disabled={props.readOnly}
                onCommit={(v) =>
                  dispatch({
                    type: 'defaultOverride',
                    key,
                    value: v ?? undefined,
                    ruleValue: rule?.value ?? null,
                    audit: newAudit(user),
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A power factor between 0.5 and 1 (as on a DB); a value outside is shown red and not kept. */
function PfField(props: {
  id: string;
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <NumberInput
      id={props.id}
      ariaLabel={props.label}
      className="pill-input df-input"
      value={props.value}
      placeholder="-"
      commit="blur"
      disabled={props.disabled}
      invalid={bad}
      onChange={(v) => {
        const ok = v === null || (v >= 0.5 && v <= 1);
        setBad(!ok);
        if (ok) props.onCommit(v);
      }}
    />
  );
}

/** Demand factor input: empty = TBC (OI-01, E1901); committed on blur for one audit entry. */
function DfInput(
  props: CardProps & {
    label: string;
    field: string;
    value: number | null;
    onCommit: (v: number | null) => void;
  },
) {
  const error = props.errorFor(props.field);
  return (
    <div className="df-row">
      <label htmlFor={fieldDomId(props.field)}>
        {props.label}
        <span className="req">*</span>
      </label>
      <NumberInput
        id={fieldDomId(props.field)}
        className="pill-input df-input"
        value={props.value}
        placeholder="TBC"
        commit="blur"
        disabled={props.readOnly}
        invalid={!!error}
        onBlur={() => props.touch(props.field)}
        onChange={props.onCommit}
      />
    </div>
  );
}
