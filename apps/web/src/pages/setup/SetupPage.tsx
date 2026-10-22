import { page1Issues } from '@neuromep/shared';
import { ACTIVE_REGIONS } from '@neuromep/rulepacks';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUser } from '../../auth/AuthContext';
import { fieldDomId, Modal } from '../../components/fields';
import { AppShell } from '../../layout/AppShell';
import { CalculationCard } from './CalculationCard';
import type { CardProps } from './cardProps';
import { DetailsCard } from './DetailsCard';
import { DisciplinesCard } from './DisciplinesCard';
import { FloorsCard } from './FloorsCard';
import { ImportCard } from './ImportCard';
import { PlansCard } from './PlansCard';
import { SiteCard } from './SiteCard';
import './setup.css';
import { useProjectEditor, type SaveState } from './useProjectEditor';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Not saved',
  conflict: 'Not saved – conflict',
};

/** Page 1 - Project Set-up & Import Floor Plan. */
export function SetupPage() {
  const { projectId = '' } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const editor = useProjectEditor(projectId);
  const { project } = editor;
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [hoverNext, setHoverNext] = useState(false);

  const issues = useMemo(
    () => (project ? page1Issues(project, { activeRegions: ACTIVE_REGIONS }) : []),
    [project],
  );
  const byField = useMemo(() => new Map(issues.map((i) => [i.field, i.message])), [issues]);

  if (editor.loadError) {
    return (
      <AppShell>
        <div className="banner banner-error">{editor.loadError}</div>
      </AppShell>
    );
  }
  if (!project) {
    return (
      <AppShell projectId={projectId}>
        <p className="muted">Loading project…</p>
      </AppShell>
    );
  }

  const cardProps: CardProps = {
    project,
    dispatch: editor.dispatch,
    readOnly: editor.readOnly,
    user,
    errorFor: (f) => (showAll || touched.has(f) ? (byField.get(f) ?? null) : null),
    touch: (f) => setTouched((t) => (t.has(f) ? t : new Set(t).add(f))),
  };

  function goToFirstIssue() {
    setShowAll(true);
    const first = issues[0];
    if (!first) return;
    const el = document.getElementById(fieldDomId(first.field));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)
      el.focus({ preventScroll: true });
  }

  async function next() {
    if (issues.length) return goToFirstIssue();
    editor.dispatch({ type: 'lastPage', page: 'floor-modelling' });
    navigate(`/projects/${project!.id}/floor-modelling`);
  }

  const actions = (
    <>
      <span className={`save-status ${editor.saveState}`} role="status">
        {editor.readOnly
          ? 'Read-only'
          : editor.dirty && editor.saveState !== 'saving'
            ? 'Unsaved changes'
            : SAVE_LABEL[editor.saveState]}
      </span>
      {!editor.readOnly && (
        <button
          className="btn btn-primary btn-sm"
          disabled={editor.saveState === 'saving'}
          onClick={() => void editor.save()}
        >
          Save Project
        </button>
      )}
    </>
  );

  return (
    <AppShell projectId={projectId} actions={actions}>
      <div className="page-header">
        <h1>Project Set-up &amp; Import Floor Plan</h1>
        <p>
          Configure the project, calculation set-up and floors, assign discipline engineers, and
          upload and calibrate the floor plans.
          {editor.readOnly &&
            ' Only the Technical Lead can change this page; you are viewing it read-only.'}
        </p>
      </div>
      {editor.saveState === 'conflict' && (
        <div className="banner banner-error setup-banner" role="alert">
          {editor.saveError}{' '}
          <button className="btn btn-sm" onClick={() => void editor.reload()}>
            Reload (discards my changes)
          </button>
        </div>
      )}
      {editor.saveState === 'error' && (
        <div className="banner banner-warning setup-banner" role="alert">
          {editor.saveError} Your changes are kept here; saving is retried on the next change, or
          use Save Project.
        </div>
      )}

      <div className="setup">
        <DetailsCard {...cardProps} />
        <SiteCard {...cardProps} />
        <CalculationCard {...cardProps} />
        <FloorsCard {...cardProps} />
        <DisciplinesCard {...cardProps} />
        <PlansCard {...cardProps} />
        <ImportCard {...cardProps} />
      </div>

      <footer className="setup-footer">
        <div
          className="next-wrap"
          onMouseEnter={() => setHoverNext(true)}
          onMouseLeave={() => setHoverNext(false)}
          onFocus={() => setHoverNext(true)}
          onBlur={() => setHoverNext(false)}
        >
          {hoverNext && issues.length > 0 && (
            <div className="next-missing" role="tooltip" id="next-missing">
              <strong>Still needed before Floor Modelling:</strong>
              <ul>
                {issues.map((i) => (
                  <li key={i.field}>
                    Card {i.card}: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            // aria-disabled, not disabled: a disabled button gets no clicks, but clicking it must
            // scroll to the first problem, and it must stay focusable to reach the list.
            className={`btn btn-primary${issues.length ? ' is-disabled' : ''}`}
            aria-disabled={issues.length > 0}
            aria-describedby={issues.length ? 'next-missing' : undefined}
            onClick={() => void next()}
          >
            Next →
          </button>
        </div>
      </footer>

      {editor.leavePrompt && (
        <Modal
          title="Leave without saving?"
          onClose={editor.leavePrompt.stay}
          actions={
            <>
              <button className="btn" onClick={editor.leavePrompt.stay}>
                Stay on this page
              </button>
              <button className="btn btn-danger-outline" onClick={editor.leavePrompt.leave}>
                Leave and lose changes
              </button>
            </>
          }
        >
          <p>Your latest changes could not be saved: {editor.saveError}</p>
        </Modal>
      )}
    </AppShell>
  );
}
