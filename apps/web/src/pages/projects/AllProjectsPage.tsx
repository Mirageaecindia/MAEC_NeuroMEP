import { canCreateProject, DESIGN_STAGE_LABELS, type ProjectSummary } from '@neuromep/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { StatusMark } from '../../layout/icons';
import { Shell, tabPath } from '../../layout/Shell';
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
              <button className="project-card" title={details(p)} onClick={() => open(p)}>
                <span className="project-card-text">
                  <span>Project Name : {p.name || 'Untitled'}</span>
                  <span>Client Name : {p.clientName || '-'}</span>
                </span>
                {/* A-08: flag = saved, pill = in progress. Per-floor status arrives with WBS 1.3. */}
                <StatusMark status="pill" size={30} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
