import { canCreateProject, DESIGN_STAGE_LABELS, type ProjectSummary } from '@neuromep/shared';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../components/fields';
import { useNavigate } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { StatusMark } from '../../layout/icons';
import { Shell, tabPath, useNotice } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { TAB_OF_PAGE } from '../../workspace/ProjectWorkspace';
import './projects.css';

const modified = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** FR-02 details not drawn on the Figma card: shown on hover. */
const details = (p: ProjectSummary) =>
  [
    p.designStage && `Stage: ${DESIGN_STAGE_LABELS[p.designStage]}`,
    p.revision && `Revision: ${p.revision}`,
    `Last modified: ${modified(p.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * All Projects (Figma screen 1, #TASK-02): the projects this user may open (access rule in
 * shared/access.ts, applied by the API), most recently modified first, with their status (A-08).
 */
export function AllProjectsPage() {
  const api = useApi();
  const user = useUser();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.listProjects().then(
        (r) => {
          setProjects(r.projects);
          setError(null);
        },
        (e: Error) => setError(e.message),
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const open = (p: ProjectSummary) => navigate(tabPath(TAB_OF_PAGE[p.lastPage], p.id)!);

  // Delete (Technical Lead, user request 7 Nov 2026): confirmed by typing the project's name.
  const notice = useNotice();
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const label = (p: ProjectSummary) => p.name || 'Untitled';
  /**
   * Duplicate (Technical Lead, user request 25 Nov 2026): the project as last saved - set-up,
   * floors with their plan PDFs and calibration, components, feeders, risers, results - becomes a
   * new project; the API names it name_duplicated (then _duplicated_2 ...) and copies the plans.
   * The original is not changed.
   */
  const [copying, setCopying] = useState<string | null>(null);
  async function duplicate(p: ProjectSummary) {
    setCopying(p.id);
    try {
      const { project } = await api.getProject(p.id);
      const { project: copy, plansToUpload } = await api.createProject(project, p.id);
      await load();
      notice(
        `"${label(p)}" duplicated as "${copy.details.name}".${plansToUpload ? ` ${plansToUpload} floor plan${plansToUpload === 1 ? '' : 's'} could not be copied: upload ${plansToUpload === 1 ? 'it' : 'them'} again in the copy.` : ''}`,
      );
    } catch (e) {
      notice(`Could not duplicate "${label(p)}": ${(e as Error).message}`);
    } finally {
      setCopying(null);
    }
  }
  async function remove(p: ProjectSummary) {
    setBusy(true);
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
      notice(`Project "${label(p)}" deleted.`);
      setDeleting(null);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tab="projects"
      projectId={null}
      toolbar={
        <Toolbar
          enabled={[]}
          hidden={['sync', 'status']}
          onAction={() => undefined}
          floorPicker={{ options: [], value: null, enabled: false }}
        />
      }
    >
      {error && (
        <div className="banner banner-error" role="alert">
          Projects could not be loaded: {error}{' '}
          <button className="btn btn-sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {projects === null ? (
        !error && <p className="muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="muted projects-empty">
          {canCreateProject(user)
            ? 'No projects yet. Create one on the Import File tab, or open a project file (.json) there.'
            : 'No projects are assigned to you yet. The Technical Lead assigns engineers on the Import File tab.'}
        </p>
      ) : (
        <ul className="project-cards" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <div className="project-card-wrap">
                <button className="project-card" title={details(p)} onClick={() => open(p)}>
                  <span className="project-card-text">
                    <span>Project Name : {p.name || 'Untitled'}</span>
                    <span>Client Name : {p.clientName || '-'}</span>
                  </span>
                  {/* A-08: flag = saved, pill = in progress. */}
                  <StatusMark status="pill" size={30} />
                </button>
                {canCreateProject(user) && (
                  <button
                    className="project-duplicate"
                    aria-label={`Duplicate project ${p.name || 'Untitled'}`}
                    title="Duplicate project (everything, plans included)"
                    disabled={copying !== null}
                    onClick={() => void duplicate(p)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <rect
                        x="8"
                        y="8"
                        width="12"
                        height="12"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
                {canCreateProject(user) && (
                  <button
                    className="project-delete"
                    aria-label={`Delete project ${p.name || 'Untitled'}`}
                    title="Delete project"
                    onClick={() => {
                      setTyped('');
                      setDeleting(p);
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <Modal
          title={`Delete project "${label(deleting)}"?`}
          onClose={() => setDeleting(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-danger-outline"
                disabled={busy || typed.trim() !== label(deleting)}
                onClick={() => void remove(deleting)}
              >
                Delete project
              </button>
            </>
          }
        >
          <p>
            This deletes the project for everyone: its floors, plans, components, feeders, risers
            and results. It cannot be undone. Download it first (Import File, Open, Download this
            project) if you may need it again.
          </p>
          <label className="delete-confirm">
            Type the project name to confirm: <strong>{label(deleting)}</strong>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Project name to confirm"
              autoFocus
            />
          </label>
        </Modal>
      )}
    </Shell>
  );
}
