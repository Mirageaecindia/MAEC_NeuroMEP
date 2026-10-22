import {
  CALCULATION_CHECK_LABELS,
  CalculationCheckSchema,
  DEMAND_CATEGORY_LABELS,
  DemandCategorySchema,
  LOAD_TYPE_LABELS,
  LoadTypeCodeSchema,
  REGION_LABELS,
  RegionSchema,
  type DefaultableNumber,
} from '@neuromep/shared';
import {
  effectiveCalculationDefaults,
  REGION_RULE_PACKS,
  rulePackForRegion,
  type EffectiveDefault,
} from '@neuromep/rulepacks';
import { useState } from 'react';
import { Card, fieldDomId, NumberField, NumberInput, SelectField } from '../../components/fields';
import { newAudit, type CardProps } from './cardProps';

const REGIONS = RegionSchema.options.map((r) => ({
  value: r,
  label: REGION_RULE_PACKS[r]
    ? REGION_LABELS[r]
    : `${REGION_LABELS[r]} (rule pack not available yet)`,
  disabled: !REGION_RULE_PACKS[r],
  title: REGION_RULE_PACKS[r] ? undefined : 'Rule pack not available yet',
}));

/** Card 3 - Calculation Set-up: region, fault level, checks, demand factors, calculation defaults. */
export function CalculationCard(props: CardProps) {
  const { project, dispatch, readOnly, errorFor, touch } = props;
  const c = project.calculation;
  const [percent, setPercent] = useState(false);

  return (
    <Card n={3} title="Calculation Set-up">
      <div className="calc-layout">
        <div className="calc-left">
          <SelectField
            field="calculation.region"
            label="Region"
            required
            value={c.region}
            options={REGIONS}
            disabled={readOnly}
            hint="Loads the region's rule pack and pre-fills defaults you have not edited."
            error={errorFor('calculation.region')}
            onBlur={() => touch('calculation.region')}
            onChange={(region) => dispatch({ type: 'region', region })}
          />
          <NumberField
            field="calculation.upstreamFaultMva"
            label="Upstream short-circuit capacity"
            unit="MVA"
            required
            placeholder="e.g. 350"
            value={c.upstreamFaultMva}
            disabled={readOnly}
            error={errorFor('calculation.upstreamFaultMva')}
            onBlur={() => touch('calculation.upstreamFaultMva')}
            onChange={(value) => dispatch({ type: 'upstreamMva', value })}
          />
          <fieldset className="checks">
            <legend className="field-label">Calculations</legend>
            {CalculationCheckSchema.options.map((check) => (
              <div key={check}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={c.checks[check]}
                    disabled={readOnly}
                    onChange={(e) => dispatch({ type: 'check', check, enabled: e.target.checked })}
                  />
                  {CALCULATION_CHECK_LABELS[check]}
                </label>
                {!c.checks[check] && (
                  <div className="field-hint check-note">
                    This check will still be calculated and reported as Not verified.
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        </div>

        <div className="calc-df">
          <div className="df-header">
            <span className="field-label">Demand factors</span>
            <label className="check">
              <input
                type="checkbox"
                checked={percent}
                onChange={(e) => setPercent(e.target.checked)}
              />
              Show as %
            </label>
          </div>
          <p className="field-hint">
            Values are not confirmed yet (OI-01); empty factors are shown as TBC and taken as 1.0 by
            the calculations until entered (D-19). How the two tables combine is open (OI-02).
          </p>
          <div className="grid grid-2">
            <DemandTable
              {...props}
              title="By load type"
              percent={percent}
              rows={LoadTypeCodeSchema.options.map((code) => ({
                key: code,
                label: `${code}. ${LOAD_TYPE_LABELS[code]}`,
                value: c.demandFactors.byLoadType[code],
                field: `calculation.demandFactors.byLoadType.${code}`,
                onChange: (value: number | null) =>
                  dispatch({
                    type: 'demandFactor',
                    table: 'byLoadType',
                    key: code,
                    value,
                    audit: newAudit(props.user),
                  }),
              }))}
            />
            <DemandTable
              {...props}
              title={`By category${c.region === 'dubai' ? ' (Dubai)' : ''}`}
              percent={percent}
              rows={DemandCategorySchema.options.map((cat) => ({
                key: cat,
                label: DEMAND_CATEGORY_LABELS[cat],
                value: c.demandFactors.byCategory[cat],
                field: `calculation.demandFactors.byCategory.${cat}`,
                onChange: (value: number | null) =>
                  dispatch({
                    type: 'demandFactor',
                    table: 'byCategory',
                    key: cat,
                    value,
                    audit: newAudit(props.user),
                  }),
              }))}
            />
          </div>
        </div>
      </div>
      <CalculationDefaults {...props} />
    </Card>
  );
}

function DemandTable(
  props: CardProps & {
    title: string;
    percent: boolean;
    rows: {
      key: string;
      label: string;
      value: DefaultableNumber;
      field: string;
      onChange: (v: number | null) => void;
    }[];
  },
) {
  return (
    <table className="table df-table">
      <thead>
        <tr>
          <th>{props.title}</th>
          <th className="num">Factor{props.percent ? ' (%)' : ' (0–1)'}</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => {
          const error = props.errorFor(r.field);
          return (
            <tr key={r.key}>
              <td>
                {r.label}
                {r.value.value === null && (
                  <span className="tag tag-tbc" style={{ marginLeft: 6 }}>
                    TBC
                  </span>
                )}
                {error && <div className="field-error">{error}</div>}
              </td>
              <td style={{ width: 96 }}>
                <NumberInput
                  id={fieldDomId(r.field)}
                  className="num"
                  ariaLabel={`${r.label} demand factor`}
                  value={r.value.value}
                  scale={props.percent ? 100 : 1}
                  placeholder="TBC"
                  disabled={props.readOnly}
                  invalid={!!error}
                  commit="blur"
                  onBlur={() => props.touch(r.field)}
                  onChange={r.onChange}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 12.2 defaults from the rule pack; read-only except for the Technical Lead, overrides logged. */
function CalculationDefaults({ project, dispatch, readOnly, user }: CardProps) {
  const pack = project.calculation.region ? rulePackForRegion(project.calculation.region) : null;
  if (!pack) return null;
  const rows = effectiveCalculationDefaults(project, pack);
  const groups = [...new Set(rows.map((r) => r.group))];
  const overridden = rows.filter((r) => r.overridden).length;
  return (
    <details className="defaults">
      <summary>
        Calculation defaults ({pack.name} rule pack v{pack.version})
        {overridden > 0 && <span className="tag tag-overridden">{overridden} overridden</span>}
      </summary>
      <p className="field-hint">
        Applied automatically from the rule pack (design doc 12.2).{' '}
        {readOnly
          ? 'Only the Technical Lead can override them.'
          : 'Overrides apply to this project only and are logged.'}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Default</th>
            <th>Rule pack</th>
            <th>Project value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <DefaultsGroup
              key={g}
              group={g}
              rows={rows.filter((r) => r.group === g)}
              readOnly={readOnly}
              onOverride={(r, value) =>
                dispatch({
                  type: 'defaultOverride',
                  key: r.key,
                  value,
                  ruleValue: r.value,
                  audit: newAudit(user),
                })
              }
            />
          ))}
        </tbody>
      </table>
    </details>
  );
}

function DefaultsGroup(props: {
  group: string;
  rows: EffectiveDefault[];
  readOnly: boolean;
  onOverride: (row: EffectiveDefault, value: number | string | undefined) => void;
}) {
  const fmt = (v: number | string | null | undefined, unit?: string) =>
    v === null || v === undefined ? null : `${v}${unit ? ` ${unit}` : ''}`;
  return (
    <>
      <tr>
        <td colSpan={4} className="defaults-group">
          {props.group}
        </td>
      </tr>
      {props.rows.map((r) => (
        <tr key={r.key}>
          <td>{r.label}</td>
          <td>
            {fmt(r.value, r.unit) ?? <span className="tag tag-tbc">TBC</span>}
            {r.value === null && r.interimDefault !== undefined && r.interimDefault !== null && (
              <span className="field-hint">
                {' '}
                interim {fmt(r.interimDefault, r.unit)}
                {r.openItem ? ` (${r.openItem})` : ''}
              </span>
            )}
            {r.note && <span className="field-hint"> {r.note}</span>}
          </td>
          <td style={{ width: 180 }}>
            {props.readOnly ? (
              (fmt(r.effective, r.unit) ?? <span className="tag tag-tbc">TBC</span>)
            ) : r.type === 'number' ? (
              <NumberInput
                ariaLabel={`${r.label} project value`}
                value={typeof r.effective === 'number' ? r.effective : null}
                placeholder="TBC"
                commit="blur"
                onChange={(v) => props.onOverride(r, v === null || v === r.value ? undefined : v)}
              />
            ) : (
              <input
                className="input"
                aria-label={`${r.label} project value`}
                defaultValue={typeof r.effective === 'string' ? r.effective : ''}
                key={String(r.effective)}
                placeholder="TBC"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (r.effective ?? '')) props.onOverride(r, v === '' ? undefined : v);
                }}
              />
            )}
          </td>
          <td>
            {r.overridden && (
              <>
                <span className="tag tag-overridden">overridden</span>{' '}
                {!props.readOnly && (
                  <button className="btn-link" onClick={() => props.onOverride(r, undefined)}>
                    Reset
                  </button>
                )}
              </>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
