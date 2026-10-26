import type { ProjectSummary } from '@neuromep/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../auth/AuthContext';
import { StatusMark } from '../../layout/icons';
import { Shell, tabPath } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { TAB_OF_PAGE } from '../../workspace/ProjectWorkspace';
import './projects.css';

/** All Projects (Figma screen 1): project cards with their status (A-08). */
export function AllProjectsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));
  }, [api]);

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
          {error}
        </div>
      )}
      {projects === null ? (
        <p className="muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="muted projects-empty">No projects yet. Start one from Import File.</p>
      ) : (
        <ul className="project-cards" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="project-card" onClick={() => open(p)}>
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
