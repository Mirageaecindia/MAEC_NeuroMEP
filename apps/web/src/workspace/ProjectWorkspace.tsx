import {
  canOpenPage,
  reachedPage,
  serializeProject,
  type PageKey,
  type Project,
} from '@neuromep/shared';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { Modal } from '../components/fields';
import { ReachedTabContext, tabPath, useNotice, type TabKey } from '../layout/Shell';
import type { ToolKey, ToolbarProps } from '../layout/Toolbar';
import { safeFileName, saveBlob } from './fileNames';
import { useProjectEditor } from './useProjectEditor';
import { openGuide, SECTION_OF_PAGE } from '../guide/openGuide';

type Editor = ReturnType<typeof useProjectEditor>;

interface Workspace {
  editor: Editor;
  project: Project;
  floorId: string | null;
  setFloorId: (id: string) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside ProjectWorkspace');
  return ws;
}

/** Stored last page (D-13) <-> top tab (A-03). */
export const TAB_OF_PAGE: Record<PageKey, TabKey> = {
  setup: 'import',
  modelling: 'floor',
  architecture: 'schematic',
  'simulation-report': 'output',
};
export const PAGE_OF_TAB: Partial<Record<TabKey, PageKey>> = {
  import: 'setup',
  floor: 'modelling',
  schematic: 'architecture',
  output: 'simulation-report',
};

/**
 * Loads the open project once for the project tabs (Import File, Floor Setup, Schematic, Output)
 * and saves it on Save (useProjectEditor: no autosave, asks before leaving, conflicts).
 */
export function ProjectWorkspace() {
  const { projectId = '' } = useParams();
  const editor = useProjectEditor(projectId);
  const [chosenFloor, setFloorId] = useState<string | null>(null);
  const project = editor.project;

  const floorId = useMemo(() => {
    if (!project) return null;
    const floors = project.building.floors;
    if (chosenFloor && floors.some((f) => f.id === chosenFloor)) return chosenFloor;
    return (
      (floors.find((f) => f.plan) ?? floors.find((f) => f.type === 'ground') ?? floors[0])?.id ??
      null
    );
  }, [project, chosenFloor]);

  if (editor.loadError) {
    return (
      <div className="banner banner-error" style={{ margin: 24 }}>
        {editor.loadError}
      </div>
    );
  }
  if (!project)
    return (
      <p className="muted" style={{ padding: 24 }}>
        Loading project…
      </p>
    );

  return (
    <WorkspaceContext.Provider value={{ editor, project, floorId, setFloorId }}>
      <ReachedTabContext.Provider value={TAB_OF_PAGE[reachedPage(project.meta)]}>
        <Outlet />
      </ReachedTabContext.Provider>
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
                Leave without saving
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void editor.leavePrompt?.saveAndLeave()}
              >
                Save and leave
              </button>
            </>
          }
        >
          <p>
            This project has changes that are not saved. NeuroMEP saves only when you click Save.
          </p>
        </Modal>
      )}
    </WorkspaceContext.Provider>
  );
}

/** Downloads this tab's copy of the project, with everything not saved yet (.json). */
function downloadCopy(project: Project) {
  const name = `${safeFileName(project.details.name) || 'NeuroMEP_project'}_my_copy.json`;
  saveBlob(new Blob([serializeProject(project)], { type: 'application/json' }), name);
}

/**
 * Save / conflict messages shown at the top of a project page. On a conflict (E0802) the work in
 * this tab is kept and can be saved: over the server copy, as a new project, or to a file
 * (user request 7 Nov 2026); Reload is the only choice that discards it, after a confirmation.
 */
export function SaveBanner() {
  const { editor, project } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = useNotice();
  const [dialog, setDialog] = useState<'overwrite' | 'saveAs' | 'reload' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setDialog(null);
    setProblem(null);
  };

  const overwrite = async () => {
    setBusy(true);
    const ok = await editor.save({ overwrite: true });
    setBusy(false);
    close();
    if (ok) notice('Your version is saved as the latest version of the project.');
  };
  const saveAs = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const id = await editor.saveAsNew(name.trim());
      const tab = location.pathname.split('/').pop() ?? 'import';
      void navigate(`/projects/${id}/${tab}`, {
        state: { notice: `Saved as the new project "${name.trim()}" with all your changes.` },
      });
    } catch (e) {
      setProblem((e as Error).message);
      setBusy(false);
    }
  };

  let banner = null;
  if (editor.saveState === 'conflict') {
    banner = (
      <div className="banner banner-error save-banner" role="alert">
        {editor.saveError} Your changes are kept in this tab.{' '}
        <span className="save-actions">
          <button className="btn btn-sm" onClick={() => setDialog('overwrite')}>
            Save my version (overwrite)
          </button>
          {editor.canSaveAsNew && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setName(`${project.details.name}_duplicated`);
                setDialog('saveAs');
              }}
            >
              Save as new project
            </button>
          )}
          <button className="btn btn-sm" onClick={() => downloadCopy(project)}>
            Download my copy (.json)
          </button>
          <button className="btn btn-sm" onClick={() => setDialog('reload')}>
            Reload (discards my changes)
          </button>
        </span>
      </div>
    );
  } else if (editor.saveState === 'error') {
    banner = (
      <div className="banner banner-warning save-banner" role="alert">
        Changes not saved (E0801): {editor.saveError} They are kept in this tab: click Save to try
        again.
      </div>
    );
  } else if (editor.dirty && editor.canEdit) {
    banner = (
      <div className="banner banner-info save-banner" role="status">
        Unsaved changes - click Save to keep them.
      </div>
    );
  }

  return (
    <>
      {banner}
      {dialog === 'overwrite' && (
        <Modal
          title="Save my version over the server copy?"
          onClose={close}
          actions={
            <>
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => void overwrite()} disabled={busy}>
                Save my version
              </button>
            </>
          }
        >
          <p>
            Everything in this tab, including the changes not saved yet, becomes the latest version
            of the project. Changes that others saved since you opened it are replaced.
          </p>
          <p className="muted">To keep both, use Save as new project or Download my copy.</p>
        </Modal>
      )}
      {dialog === 'saveAs' && (
        <Modal
          title="Save as new project"
          onClose={close}
          actions={
            <>
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void saveAs()}
                disabled={busy || !name.trim()}
              >
                Save as new project
              </button>
            </>
          }
        >
          <p>
            A new project is made from everything in this tab, including the changes not saved yet,
            with its floor plans. &quot;{project.details.name}&quot; stays as it is on the server.
          </p>
          <label className="save-as-name">
            New project name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {problem && <p className="banner banner-error">{problem}</p>}
        </Modal>
      )}
      {dialog === 'reload' && (
        <Modal
          title="Discard my changes?"
          onClose={close}
          actions={
            <>
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button
                className="btn btn-danger-outline"
                onClick={() => {
                  close();
                  void editor.reload();
                }}
              >
                Reload and discard
              </button>
            </>
          }
        >
          <p>
            The project is loaded again from the server and the changes not saved in this tab are
            lost. Use Download my copy first if you may need them.
          </p>
        </Modal>
      )}
    </>
  );
}

const ORDER: TabKey[] = ['projects', 'import', 'floor', 'schematic', 'output'];

/**
 * Toolbar wiring shared by the project tabs: floor picker, Back / Next between tabs, Save, Sync,
 * Help and the inactive Bot / Smart-AI buttons (A-09). Pages add their own actions.
 */
export function useProjectToolbar(
  tab: TabKey,
  own: Partial<Record<ToolKey, () => void>> = {},
): Pick<ToolbarProps, 'onAction' | 'floorPicker' | 'statusIcon'> {
  const { editor, project, floorId, setFloorId } = useWorkspace();
  const navigate = useNavigate();
  const notice = useNotice();

  // A tab not reached yet (e.g. an old link) falls back to the furthest one reached (A-12);
  // otherwise remember the page for "open on its last page" (D-13).
  const page = PAGE_OF_TAB[tab];
  const allowed = !page || canOpenPage(project.meta, page);
  useEffect(() => {
    if (!allowed) {
      void navigate(tabPath(TAB_OF_PAGE[reachedPage(project.meta)], project.id)!, {
        replace: true,
      });
    } else if (page && editor.canEdit && project.meta.lastPage !== page) {
      editor.dispatch({ type: 'lastPage', page });
    }
  }, [allowed, page, editor, project.meta, project.id, navigate]);

  const go = (step: number) => {
    const next = ORDER[ORDER.indexOf(tab) + step];
    const to = next ? tabPath(next, project.id) : null;
    if (!next || !to) return;
    const nextPage = PAGE_OF_TAB[next];
    // Next opens the following tab (A-12); a read-only user can only follow the editors.
    if (step > 0 && nextPage && !canOpenPage(project.meta, nextPage)) {
      if (!editor.canEdit) return notice('The Technical Lead has not opened the next page yet.');
      editor.dispatch({ type: 'lastPage', page: nextPage });
    }
    void navigate(to);
  };

  return {
    floorPicker: {
      options: [...project.building.floors].reverse().map((f) => ({
        id: f.id,
        label: f.plan ? `${f.plan.fileName}` : `${f.name} (no plan)`,
      })),
      value: floorId,
      onChange: setFloorId,
      enabled: tab === 'floor' || tab === 'schematic',
    },
    // A-08: floor flagging arrives with WBS 1.3; until then every floor shows 'in progress'.
    statusIcon: 'pill',
    onAction: (key) => {
      const handler = own[key];
      if (handler) return handler();
      switch (key) {
        case 'save':
          void editor
            .save()
            .then((ok) =>
              notice(ok ? 'Project saved.' : 'Could not save - see the message above.'),
            );
          return;
        case 'sync':
          // Sync loads the latest saved project; it never discards changes not saved yet.
          if (editor.dirty || editor.saveState === 'conflict') {
            notice('Save your changes first: Sync loads the latest saved project.');
            return;
          }
          void editor.reload().then(() => notice('Project synchronised with the server.'));
          return;
        case 'undo':
          return editor.undo();
        case 'redo':
          return editor.redo();
        case 'back':
          return go(-1);
        case 'next':
          return go(1);
        case 'bot':
        case 'smartAi':
          return notice(
            `${key === 'bot' ? 'Bot' : 'Smart-AI'} will be available in a later release.`,
          );
        case 'guide':
          return openGuide(SECTION_OF_PAGE[tab]);
        default:
          return notice('This tool is added in a later WBS step.');
      }
    },
  };
}
