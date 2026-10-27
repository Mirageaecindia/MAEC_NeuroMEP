import {
  applyRegistryChange,
  canCreateProject,
  createEmptyProject,
  page1Issues,
  parseProjectFile,
  serializeProject,
  type Project,
} from '@neuromep/shared';
import { ACTIVE_REGIONS } from '@neuromep/rulepacks';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { Shell, useNotice } from '../../layout/Shell';
import { Toolbar, type OpenMenuItem } from '../../layout/Toolbar';
import type { CardProps } from '../../workspace/formProps';
import { projectReducer, type ProjectAction } from '../../workspace/projectReducer';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { ImportFileForm } from './ImportFileForm';

/** File name from the project name and design stage (Section 14; revision is not on the Figma form, A-10). */
export function exportFileName(p: Project): string {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const parts = [clean(p.details.name) || 'NeuroMEP_project', p.details.designStage ?? ''];
  return `${parts.filter(Boolean).join('_')}.json`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Validation display: a field shows its message once left, or all after Save / Next was tried. */
function useValidation(project: Project) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const issues = useMemo(() => page1Issues(project, { activeRegions: ACTIVE_REGIONS }), [project]);
  const byField = useMemo(() => new Map(issues.map((i) => [i.field, i.message])), [issues]);
  return {
    issues,
    showAll: () => setShowAll(true),
    errorFor: (f: string) => (showAll || touched.has(f) ? (byField.get(f) ?? null) : null),
    touch: (f: string) => setTouched((t) => (t.has(f) ? t : new Set(t).add(f))),
  };
}

/** "Open" on Import File: a project file (.json) always creates a new project (A-01). */
function useImportProject() {
  const api = useApi();
  const navigate = useNavigate();
  const notice = useNotice();
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept=".json,application/json"
      hidden
      aria-label="Project file"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const parsed = parseProjectFile(await file.text());
        if (!parsed.ok) return notice(`${parsed.error} (E0203)`);
        try {
          const created = (await api.createProject(parsed.project)).project;
          navigate(`/projects/${created.id}/import`);
        } catch (err) {
          notice((err as Error).message);
        }
      }}
    />
  );
  return { element, choose: () => input.current?.click() };
}

/** Import File (Figma screen 2) for the open project. */
export function ImportFilePage() {
  const { editor, project } = useWorkspace();
  const user = useUser();
  const v = useValidation(project);
  const importer = useImportProject();
  const valid = v.issues.length === 0;
  const toolbar = useProjectToolbar('import');
  const openMenu: OpenMenuItem[] = [
    {
      label: 'Open project file (.json)…',
      onSelect: importer.choose,
      disabled: !canCreateProject(user),
    },
    {
      label: 'Download this project (.json)',
      onSelect: () => download(exportFileName(project), serializeProject(project)),
    },
  ];
  const props: CardProps = {
    project,
    dispatch: editor.dispatch,
    readOnly: editor.readOnly,
    user,
    errorFor: v.errorFor,
    touch: v.touch,
  };
  return (
    <Shell
      tab="import"
      projectId={project.id}
      toolbar={
        <Toolbar
          {...toolbar}
          onAction={(k) => (k === 'next' && !valid ? v.showAll() : toolbar.onAction(k))}
          enabled={[
            'open',
            'back',
            'guide',
            // Next stays enabled: on an incomplete form it shows every missing field.
            'next',
            ...(editor.dirty && !editor.readOnly ? (['save'] as const) : []),
          ]}
          hidden={['status']}
          openMenu={openMenu}
        />
      }
    >
      <SaveBanner />
      {editor.readOnly && (
        <p className="banner banner-info">
          Only the Technical Lead can change this page; you are viewing it read-only.
        </p>
      )}
      <div className="panel import-panel">
        <ImportFileForm {...props} />
      </div>
      {importer.element}
    </Shell>
  );
}

/** Import File with no project open: a new project draft, created on Save (Technical Lead, A-01). */
export function NewProjectPage() {
  const user = useUser();
  const api = useApi();
  const navigate = useNavigate();
  const notice = useNotice();
  const importer = useImportProject();
  const [draft, setDraft] = useState<Project>(() => {
    const now = new Date().toISOString();
    let p = createEmptyProject({ id: 'new', userId: user.id, now });
    p = projectReducer(p, { type: 'region', region: 'dubai' });
    p = { ...p, details: { ...p.details, plotLoad: { value: null, unit: 'kW' } } };
    p = {
      ...p,
      building: applyRegistryChange(
        p.building,
        { basements: 0, podiums: 0, typicals: 0 },
        { floors: [], removed: [], removedWithPlans: [] },
      ),
    };
    return p;
  });
  const [busy, setBusy] = useState(false);
  const v = useValidation(draft);
  const valid = v.issues.length === 0;
  const allowed = canCreateProject(user);

  async function create(then: 'import' | 'floor') {
    if (!valid) {
      notice(`Complete the highlighted fields (${v.issues.length}).`);
      return v.showAll();
    }
    setBusy(true);
    try {
      const created = (await api.createProject(draft)).project;
      navigate(`/projects/${created.id}/${then}`);
    } catch (e) {
      notice((e as Error).message);
      setBusy(false);
    }
  }

  const dispatch = (a: ProjectAction) => setDraft((p) => projectReducer(p, a));
  return (
    <Shell
      tab="import"
      projectId={null}
      toolbar={
        <Toolbar
          enabled={
            // Save / Next stay enabled: a click on an incomplete form shows every missing field.
            allowed && !busy ? ['open', 'save', 'next', 'back', 'guide'] : ['back', 'guide']
          }
          hidden={['status']}
          openMenu={[{ label: 'Open project file (.json)…', onSelect: importer.choose }]}
          onAction={(k) => {
            if (k === 'save') void create('import');
            else if (k === 'next') void create('floor');
            else if (k === 'back') navigate('/projects');
            else if (k === 'guide') notice('The user guide will be added in a later release.');
          }}
          floorPicker={{ options: [], value: null, enabled: false }}
        />
      }
    >
      {!allowed ? (
        <p className="banner banner-info">
          Only the Technical Lead can create projects (A-01). Open a project from All Projects.
        </p>
      ) : (
        <div className="panel import-panel">
          <ImportFileForm
            project={draft}
            dispatch={dispatch}
            readOnly={false}
            user={user}
            errorFor={v.errorFor}
            touch={v.touch}
          />
        </div>
      )}
      {importer.element}
    </Shell>
  );
}
