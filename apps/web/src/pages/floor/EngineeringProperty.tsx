import { itemOfElement, type Element } from '@neuromep/shared';
import { useState } from 'react';

/**
 * "Engineering Property" card of the selected component (Figma 3.3): name, tag, description and
 * fed-from (from the cables). Equipment values (kVA, poles, loads …) are entered here with WBS
 * 1.3.4. Text is saved when the field is left.
 */
export function EngineeringProperty(props: {
  element: Element;
  editable: boolean;
  takenTags: string[];
  /** Tag(s) of the component feeding it, from the cables; null when nothing feeds it yet. */
  fedFrom: string | null;
  onChange: (patch: { tag?: string; description?: string }) => void;
  onDelete: () => void;
}) {
  const { element } = props;
  const item = itemOfElement(element);
  const [tag, setTag] = useState(element.tag);
  const [description, setDescription] = useState(element.description);
  const taken = new Set(props.takenTags.map((t) => t.toLowerCase()));
  const tagError = !tag.trim()
    ? 'Enter a tag.'
    : taken.has(tag.trim().toLowerCase())
      ? 'Another component already has this tag.'
      : null;

  return (
    <section className="property-card" aria-label="Engineering Property">
      <h3>Engineering Property</h3>
      <dl>
        <dt>Name :</dt>
        <dd>{item?.label ?? element.kind}</dd>
        <dt>
          <label htmlFor="prop-tag">Tag :</label>
        </dt>
        <dd>
          <input
            id="prop-tag"
            className="pill-input"
            value={tag}
            disabled={!props.editable}
            aria-invalid={tagError !== null}
            onChange={(e) => setTag(e.target.value)}
            onBlur={() => {
              if (tagError) setTag(element.tag);
              else if (tag.trim() !== element.tag) props.onChange({ tag: tag.trim() });
            }}
          />
          {tagError && <span className="field-error">{tagError}</span>}
        </dd>
        <dt>
          <label htmlFor="prop-description">Description :</label>
        </dt>
        <dd>
          <input
            id="prop-description"
            className="pill-input"
            value={description}
            disabled={!props.editable}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== element.description) props.onChange({ description });
            }}
          />
        </dd>
        <dt>Fed From :</dt>
        <dd>{props.fedFrom ?? '-'}</dd>
        <dt>Symbol :</dt>
        <dd>{item ? `${item.cmpCode} (draft)` : '-'}</dd>
      </dl>
      {props.editable && (
        <button className="btn btn-sm btn-danger-outline" onClick={props.onDelete}>
          Delete component
        </button>
      )}
    </section>
  );
}
