import {
  DESIGN_STAGE_LABELS,
  DesignStageSchema,
  PROJECT_CATEGORY_LABELS,
  ProjectCategorySchema,
} from '@neuromep/shared';
import { Card, NumberField, SelectField, TextField } from '../../components/fields';
import type { CardProps } from './cardProps';

const STAGES = DesignStageSchema.options.map((s) => ({
  value: s,
  label: `${s} – ${DESIGN_STAGE_LABELS[s]}`,
}));
const CATEGORIES = ProjectCategorySchema.options.map((c) => ({
  value: c,
  label: PROJECT_CATEGORY_LABELS[c],
}));

/** Card 1 - Project Details (design doc 12.1). */
export function DetailsCard({ project, dispatch, readOnly, errorFor, touch }: CardProps) {
  const d = project.details;
  const text = (
    field: keyof typeof d & ('name' | 'location' | 'clientName' | 'plotRef' | 'revision'),
    label: string,
    placeholder?: string,
  ) => (
    <TextField
      field={`details.${field}`}
      label={label}
      required
      value={d[field]}
      placeholder={placeholder}
      disabled={readOnly}
      error={errorFor(`details.${field}`)}
      onBlur={() => touch(`details.${field}`)}
      onChange={(v) => dispatch({ type: 'details', patch: { [field]: v } })}
    />
  );
  return (
    <Card n={1} title="Project Details">
      <div className="grid grid-4">
        {text('name', 'Project Name')}
        {text('location', 'Location')}
        {text('clientName', 'Client Name')}
        {text('plotRef', 'Plot ref')}
        <SelectField
          field="details.designStage"
          label="Design Stage"
          required
          value={d.designStage}
          options={STAGES}
          disabled={readOnly}
          error={errorFor('details.designStage')}
          onBlur={() => touch('details.designStage')}
          onChange={(v) => dispatch({ type: 'details', patch: { designStage: v } })}
        />
        {text('revision', 'Revision', 'e.g. A, B, 0, 1')}
        <SelectField
          field="details.category"
          label="Project Category"
          required
          value={d.category}
          options={CATEGORIES}
          disabled={readOnly}
          error={errorFor('details.category')}
          onBlur={() => touch('details.category')}
          onChange={(v) => dispatch({ type: 'details', patch: { category: v } })}
        />
        <NumberField
          field="details.plotLoad"
          label="Plot load allocation"
          required
          value={d.plotLoad.value}
          disabled={readOnly}
          error={errorFor('details.plotLoad')}
          onBlur={() => touch('details.plotLoad')}
          onChange={(v) =>
            dispatch({ type: 'details', patch: { plotLoad: { ...d.plotLoad, value: v } } })
          }
          after={
            <select
              className="select"
              style={{ width: 84, flex: 'none' }}
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
              <option value="kVA">kVA</option>
              <option value="kW">kW</option>
            </select>
          }
        />
      </div>
    </Card>
  );
}
