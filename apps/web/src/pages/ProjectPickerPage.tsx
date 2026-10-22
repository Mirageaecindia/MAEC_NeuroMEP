import {
  canCreateProject,
  DESIGN_STAGE_LABELS,
  parseProjectFile,
  type ProjectSummary,
} from '@neuromep/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useUser } from '../auth/AuthContext';
import { AppShell } from '../layout/AppShell';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** After login: choose, create or import a project (D-13). */
export function ProjectPickerPage() {
  const api = useApi();
  const user = useUser();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mayCreate = canCreateProject(user);

  useEffect(() => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));
  }, [api]);

  async function create(project?: Parameters<typeof api.createProject>[0]) {
    setBusy(true);
    setError(null);
    try {
      const created = (await api.createProject(project)).project;
      navigate(`/projects/${created.id}/setup`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    const parsed = parseProjectFile(await file.text());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    await create(parsed.project);
  }

  return (
    <AppShell>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Projects</h1>
          <p>Open a project, or start a new one.</p>
        </div>
        {mayCreate && (
          <>
            <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              Import Project (.json)
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
              New Project
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <section className="card">
        {projects === null ? (
          <p className="muted">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="muted">
            No projects yet.{' '}
            {mayCreate
              ? 'Use New Project to start one.'
              : 'Ask your Technical Lead to add you to a project.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Design stage</th>
                <th>Revision</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="row-link"
                  tabIndex={0}
                  onClick={() => navigate(`/projects/${p.id}/${p.lastPage}`)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && navigate(`/projects/${p.id}/${p.lastPage}`)
                  }
                >
                  <td>
                    <strong>{p.name || 'Untitled project'}</strong>
                  </td>
                  <td>{p.clientName || '—'}</td>
                  <td>
                    {p.designStage
                      ? `${p.designStage} – ${DESIGN_STAGE_LABELS[p.designStage]}`
                      : '—'}
                  </td>
                  <td>{p.revision || '—'}</td>
                  <td>{formatDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}
