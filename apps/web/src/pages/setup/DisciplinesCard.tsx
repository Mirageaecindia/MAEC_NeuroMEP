import { ROLE_LABELS, type Role, type UserSummary } from '@neuromep/shared';
import { useEffect, useId, useState } from 'react';
import { useApi } from '../../auth/AuthContext';
import { Card, fieldDomId } from '../../components/fields';
import type { CardProps } from './cardProps';

const DISCIPLINES = [
  {
    key: 'electrical',
    label: 'Electrical Eng.',
    role: 'ELECTRICAL_ENGINEER',
    required: true,
    color: 'var(--elec)',
  },
  {
    key: 'mechanical',
    label: 'Mechanical Eng.',
    role: 'MECHANICAL_ENGINEER',
    required: false,
    color: 'var(--mech)',
  },
  { key: 'phe', label: 'PHE Eng.', role: 'PHE_ENGINEER', required: false, color: 'var(--phe)' },
] as const;

/** Card 5 - Discipline Assignment (drives discipline locks). No working directory (D-18). */
export function DisciplinesCard({ project, dispatch, readOnly, errorFor, touch }: CardProps) {
  const api = useApi();
  const [users, setUsers] = useState<UserSummary[]>([]);
  useEffect(() => {
    api.users().then(
      (r) => setUsers(r.users),
      () => setUsers([]),
    );
  }, [api]);

  return (
    <Card n={5} title="Discipline Assignment">
      <div className="grid grid-3">
        {DISCIPLINES.map((d) => (
          <UserMultiSelect
            key={d.key}
            field={`disciplines.${d.key}`}
            label={d.label}
            color={d.color}
            required={d.required}
            hint={d.required ? 'At least one required.' : 'Optional in Phase 1.'}
            users={users.filter((u) => u.role === d.role || u.role === 'TECHNICAL_LEAD')}
            allUsers={users}
            selected={project.disciplines[d.key]}
            disabled={readOnly}
            error={errorFor(`disciplines.${d.key}`)}
            onBlur={() => touch(`disciplines.${d.key}`)}
            onChange={(userIds) => dispatch({ type: 'disciplines', discipline: d.key, userIds })}
          />
        ))}
      </div>
    </Card>
  );
}

/** Searchable multi-select shown as chips. */
function UserMultiSelect(props: {
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
