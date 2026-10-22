import { useEffect, useId, useState, type ReactNode } from 'react';

/** DOM id for a Page 1 field key, used by the Next button to scroll to a problem. */
export const fieldDomId = (field: string) => `field-${field}`;

interface BaseProps {
  field: string;
  label: ReactNode;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  tags?: ReactNode;
  disabled?: boolean;
  onBlur?: () => void;
}

export function FieldShell(props: BaseProps & { children: ReactNode; inputId: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={props.inputId}>
        <span>
          {props.label}
          {props.required && <span className="req"> *</span>}
        </span>
        {props.tags}
      </label>
      {props.children}
      {props.error ? (
        <span className="field-error" id={`${props.inputId}-error`}>
          {props.error}
        </span>
      ) : (
        props.hint && <span className="field-hint">{props.hint}</span>
      )}
    </div>
  );
}

export function TextField(
  props: BaseProps & { value: string; onChange: (v: string) => void; placeholder?: string },
) {
  const id = fieldDomId(props.field);
  return (
    <FieldShell {...props} inputId={id}>
      <input
        id={id}
        className={`input${props.error ? ' invalid' : ''}`}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-invalid={!!props.error}
        aria-describedby={props.error ? `${id}-error` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
      />
    </FieldShell>
  );
}

export function SelectField<T extends string>(
  props: BaseProps & {
    value: T | null;
    options: readonly { value: T; label: string; disabled?: boolean; title?: string }[];
    onChange: (v: T) => void;
    placeholder?: string;
  },
) {
  const id = fieldDomId(props.field);
  return (
    <FieldShell {...props} inputId={id}>
      <select
        id={id}
        className={`select${props.error ? ' invalid' : ''}`}
        value={props.value ?? ''}
        disabled={props.disabled}
        aria-invalid={!!props.error}
        onChange={(e) => props.onChange(e.target.value as T)}
        onBlur={props.onBlur}
      >
        <option value="" disabled>
          {props.placeholder ?? 'Select…'}
        </option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Parses user text to a number: '' -> null, invalid -> undefined. Accepts a comma decimal. */
export function parseNumber(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const show = (v: number | null, scale: number) =>
  v === null ? '' : String(Math.round(v * scale * 1e9) / 1e9);

/**
 * Number input that never blocks typing: the text is kept as typed, and the value is passed on
 * whenever it parses. `scale` displays e.g. a 0-1 factor as % (scale 100).
 */
export function NumberInput(props: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  scale?: number;
  ariaLabel?: string;
  describedBy?: string;
  onBlur?: () => void;
  className?: string;
  /** 'blur': pass the value on only when the user leaves the field or presses Enter (one audit entry per edit). */
  commit?: 'change' | 'blur';
}) {
  const scale = props.scale ?? 1;
  const [text, setText] = useState(() => show(props.value, scale));
  const [bad, setBad] = useState(false);
  const [seen, setSeen] = useState({ value: props.value, scale });
  if (seen.value !== props.value || seen.scale !== scale) {
    // Follow outside changes (rule-pack load, fill-all) unless the text already means this value.
    setSeen({ value: props.value, scale });
    const parsed = parseNumber(text);
    const current = parsed === undefined || parsed === null ? parsed : parsed / scale;
    if (current !== props.value || seen.scale !== scale) {
      setText(show(props.value, scale));
      setBad(false);
    }
  }
  return (
    <>
      <input
        id={props.id}
        className={`input ${props.className ?? ''}${props.invalid || bad ? ' invalid' : ''}`}
        inputMode="decimal"
        value={text}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        aria-invalid={props.invalid || bad}
        aria-describedby={props.describedBy}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          setBad(n === undefined);
          if (n !== undefined && props.commit !== 'blur')
            props.onChange(n === null ? null : n / scale);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && props.commit === 'blur') e.currentTarget.blur();
        }}
        onBlur={() => {
          if (props.commit === 'blur') {
            const n = parseNumber(text);
            if (n !== undefined && (n === null ? null : n / scale) !== props.value) {
              props.onChange(n === null ? null : n / scale);
            }
          }
          props.onBlur?.();
        }}
      />
      {bad && <span className="field-error">Enter a number.</span>}
    </>
  );
}

export function NumberField(
  props: BaseProps & {
    value: number | null;
    onChange: (v: number | null) => void;
    unit?: string;
    placeholder?: string;
    after?: ReactNode;
  },
) {
  const id = fieldDomId(props.field);
  const label = props.unit ? (
    <>
      {props.label} <span className="muted">({props.unit})</span>
    </>
  ) : (
    props.label
  );
  return (
    <FieldShell {...props} label={label} inputId={id}>
      <div className="input-group">
        <NumberInput
          id={id}
          value={props.value}
          onChange={props.onChange}
          disabled={props.disabled}
          invalid={!!props.error}
          placeholder={props.placeholder}
          describedBy={props.error ? `${id}-error` : undefined}
          onBlur={props.onBlur}
        />
        {props.after}
      </div>
    </FieldShell>
  );
}

export function Card(props: {
  n: number;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section className="card" aria-labelledby={headingId} id={props.id}>
      <h2 className="card-title" id={headingId}>
        <span>
          {props.n}. {props.title}
        </span>
        <span style={{ marginLeft: 'auto' }}>{props.aside}</span>
      </h2>
      {props.children}
    </section>
  );
}

export function Modal(props: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id}>{props.title}</h2>
        {props.children}
        <div className="modal-actions">{props.actions}</div>
      </div>
    </div>
  );
}
