import { ROLE_LABELS, type Role, type UserSummary } from '@neuromep/shared';
import { useId, useState } from 'react';
import { fieldDomId } from './fields';
import './userMultiSelect.css';

/** Searchable multi-select shown as chips. */
export function UserMultiSelect(props: {
  field: string;
  label: string;
  color: string;
  required: boolean;
  hint: string;
  users: UserSummary[];
  allUsers: UserSummary[];
  selected: string[];
  disabled: boolean;
  error: string | null;
  onBlur: () => void;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const byId = new Map(props.allUsers.map((u) => [u.id, u]));
  const q = query.trim().toLowerCase();
  const options = props.users.filter(
    (u) =>
      !props.selected.includes(u.id) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
  );
  const inputId = fieldDomId(props.field);

  return (
    <div className={`discipline-box${props.error ? ' invalid' : ''}`}>
      <label className="field-label" htmlFor={inputId} style={{ color: props.color }}>
        {props.label}
        {props.required && <span className="req"> *</span>}
      </label>
      <div className="combo">
        <input
          id={inputId}
          className="input"
          placeholder="Search & select…"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          value={query}
          disabled={props.disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
            props.onBlur();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {open && !props.disabled && (
          <ul className="combo-list" id={listId} role="listbox">
            {options.length === 0 ? (
              <li className="muted combo-empty">No matching users</li>
            ) : (
              options.map((u) => (
                <li
                  key={u.id}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    props.onChange([...props.selected, u.id]);
                    setQuery('');
                  }}
                >
                  {u.name} <span className="muted">· {ROLE_LABELS[u.role as Role]}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <div className="chips">
        {props.selected.map((id) => (
          <span key={id} className="chip">
            <span className="chip-text">{byId.get(id)?.name ?? id}</span>
            {!props.disabled && (
              <button
                aria-label={`Remove ${byId.get(id)?.name ?? id}`}
                onClick={() => props.onChange(props.selected.filter((x) => x !== id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {props.error ? (
        <span className="field-error">{props.error}</span>
      ) : (
        <span className="field-hint">{props.hint}</span>
      )}
    </div>
  );
}
