import { canOpenPage, reachedPage, type PageKey, type Project } from '@neuromep/shared';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { Modal } from '../components/fields';
import { ReachedTabContext, tabPath, useNotice, type TabKey } from '../layout/Shell';
import type { ToolKey, ToolbarProps } from '../layout/Toolbar';
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
 * and keeps it saved (useProjectEditor: autosave, save on leaving, conflicts).
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
                Leave and lose changes
              </button>
            </>
          }
        >
          <p>Your latest changes could not be saved: {editor.saveError}</p>
        </Modal>
      )}
    </WorkspaceContext.Provider>
  );
}

/** Save / conflict messages shown at the top of a project page. */
export function SaveBanner() {
  const { editor } = useWorkspace();
  if (editor.saveState === 'conflict') {
    return (
      <div className="banner banner-error save-banner" role="alert">
        {editor.saveError}{' '}
        <button className="btn btn-sm" onClick={() => void editor.reload()}>
          Reload (discards my changes)
        </button>
      </div>
    );
  }
  if (editor.saveState === 'error') {
    return (
      <div className="banner banner-warning save-banner" role="alert">
        Changes not saved yet (E0801): {editor.saveError} They are kept and saving is retried.
      </div>
    );
  }
  return null;
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
          void editor
            .save()
            .then(() =>
              editor.reload().then(() => notice('Project synchronised with the server.')),
            );
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
