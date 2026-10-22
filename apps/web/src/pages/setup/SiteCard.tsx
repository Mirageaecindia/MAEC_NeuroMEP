import type { DefaultableNumber } from '@neuromep/shared';
import { rulePackForRegion } from '@neuromep/rulepacks';
import { Card, NumberField } from '../../components/fields';
import type { CardProps } from './cardProps';

const SITE = [
  { key: 'ambientAirC', label: 'Ambient air temperature', unit: '°C', placeholder: '0 – 60' },
  { key: 'ambientSoilC', label: 'Ambient soil temperature', unit: '°C', placeholder: '0 – 50' },
  {
    key: 'soilResistivity',
    label: 'Soil thermal resistivity',
    unit: '°C·m/W',
    placeholder: '0.5 – 3.0',
  },
] as const;

/** Card 2 - Site Conditions. Values still equal to the rule-pack default carry a tag. */
export function SiteCard({ project, dispatch, readOnly, errorFor, touch }: CardProps) {
  const pack = project.calculation.region ? rulePackForRegion(project.calculation.region) : null;
  return (
    <Card n={2} title="Site Conditions">
      <div className="grid grid-4">
        {SITE.map(({ key, label, unit, placeholder }) => {
          const v: DefaultableNumber = project.site[key];
          const isDefault = pack !== null && v.value !== null && v.value === pack.siteDefaults[key];
          return (
            <NumberField
              key={key}
              field={`site.${key}`}
              label={label}
              unit={unit}
              required
              value={v.value}
              placeholder={placeholder}
              disabled={readOnly}
              tags={isDefault && <span className="tag tag-default">{pack.name} default</span>}
              error={errorFor(`site.${key}`)}
              onBlur={() => touch(`site.${key}`)}
              onChange={(value) => dispatch({ type: 'site', key, value })}
            />
          );
        })}
        <NumberField
          field="site.altitudeM"
          label="Altitude"
          unit="m"
          value={project.site.altitudeM}
          placeholder="Optional"
          hint="Optional – not used in Phase 1 calculations (OI-26)."
          disabled={readOnly}
          error={errorFor('site.altitudeM')}
          onBlur={() => touch('site.altitudeM')}
          onChange={(value) => dispatch({ type: 'altitude', value })}
        />
      </div>
      {!pack && (
        <p className="field-hint">
          Choose the region in Calculation Set-up to load the regional defaults.
        </p>
      )}
    </Card>
  );
}
