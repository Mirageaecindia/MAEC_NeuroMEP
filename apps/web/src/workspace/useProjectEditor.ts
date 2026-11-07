import {
  canCreateProject,
  canEditFloorPlans,
  canEditProjectSetup,
  editableDisciplines,
  type Project,
  type UserSummary,
} from '@neuromep/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { ApiError } from '../api/client';
import { useApi, useUser } from '../auth/AuthContext';
import { touchesLockedFloor } from './floorLock';
import { projectReducer, type ProjectAction } from './projectReducer';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** Actions that change the floor plans and their calibration (any engineer of the project). */
const PLAN_ACTIONS = new Set<ProjectAction['type']>(['planUploaded', 'calibration']);
/** Undo keeps the last 50 changes. */
const HISTORY_LIMIT = 50;
/** Bookkeeping every editor may record. */
const ALWAYS = new Set<ProjectAction['type']>(['saved', 'lastPage']);
/** Bookkeeping that is kept with the next save but is not an unsaved change by itself. */
const NOT_A_CHANGE = new Set<ProjectAction['type']>(['saved', 'lastPage']);

/**
 * May this user apply this action (Section 2)? Project Set-up: the Technical Lead; plans: the
 * engineers of the project; components: their own discipline layer; a floor flagged done is
 * locked for everyone (A-08). The API checks the same.
 */
export function mayApply(user: UserSummary, project: Project, action: ProjectAction): boolean {
  if (touchesLockedFloor(project, action)) return false;
  if (canEditProjectSetup(user)) return true;
  if (!canEditFloorPlans(user, project)) return false;
  if (ALWAYS.has(action.type) || PLAN_ACTIONS.has(action.type)) return true;
  // Components: only those of the user's own discipline layers (old and new version).
  const layers = editableDisciplines(user, project);
  const own = (id: string) => {
    const e = project.model.elements.find((x) => x.id === id);
    return !e || layers.includes(e.discipline);
  };
  switch (action.type) {
    case 'placeElement':
      return layers.includes(action.element.discipline);
    case 'moveElement':
    case 'updateElement':
      return own(action.id);
    case 'removeElements':
      return action.ids.every(own);
    case 'addCable':
    case 'updateCable':
    case 'removeCables':
    case 'loadImport':
    case 'risers':
    case 'cableSize':
      return layers.includes('electrical');
    case 'floorFlag':
      // Engineers flag their own layer; only the Technical Lead reopens (A-08).
      return action.flag !== null && layers.includes(action.discipline);
    default:
      return false;
  }
}

/** A state from the history, with the bookkeeping (version, save time, pages) of `now`. */
function restore(snapshot: Project, now: Project): Project {
  const { updatedAt, lastPage, reachedPage } = now.meta;
  return {
    ...snapshot,
    version: now.version,
    meta: { ...snapshot.meta, updatedAt, lastPage, reachedPage },
  };
}

/**
 * Loads a project and saves it when the user clicks Save (no autosave: user decision 7 Nov 2026,
 * after autosaves of two open copies kept refusing each other with E0802). On a conflict the
 * user's work is never lost: overwrite the server copy with it, save it as a new project, or
 * download it. Leaving the project (or the browser) with unsaved changes asks first.
 * Each action is checked against the user's rights (mayApply); `readOnly` = Project Set-up is
 * read-only for this user, `canEdit` = they may change anything at all in this project.
 */
export function useProjectEditor(projectId: string) {
  const api = useApi();
  const user = useUser();
  const readOnly = !canEditProjectSetup(user);

  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);

  const projectRef = useRef<Project | null>(null);
  const changeSeq = useRef(0);
  const savedSeq = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  /** Undo / Redo: earlier and undone project states of this session. */
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const [historyLength, setHistoryLength] = useState({ past: 0, future: 0 });
  const syncHistory = () =>
    setHistoryLength({ past: past.current.length, future: future.current.length });

  const applyLoaded = useCallback((p: Project) => {
    projectRef.current = p;
    past.current = [];
    future.current = [];
    setHistoryLength({ past: 0, future: 0 });
    changeSeq.current = savedSeq.current = 0;
    setLoadError(null);
    setProject(p);
    setChangeCount(0);
    setSavedCount(0);
    setSaveState('idle');
  }, []);

  useEffect(() => {
    let live = true;
    api.getProject(projectId).then(
      (r) => live && applyLoaded(r.project),
      (e: Error) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, applyLoaded]);

  /** Reloads from the server, discarding local changes (used after a save conflict). */
  const load = useCallback(
    () =>
      api.getProject(projectId).then(
        (r) => applyLoaded(r.project),
        (e: Error) => setLoadError(e.message),
      ),
    [api, projectId, applyLoaded],
  );

  const canEdit = project ? canEditFloorPlans(user, project) : false;
  const layers = project ? editableDisciplines(user, project) : [];
  /** The same right, for callbacks: read from the latest project. */
  const mayEdit = useCallback(
    () => projectRef.current !== null && canEditFloorPlans(user, projectRef.current),
    [user],
  );

  const commit = (next: Project, change = true) => {
    projectRef.current = next;
    setProject(next);
    if (!change) return;
    changeSeq.current += 1;
    setChangeCount(changeSeq.current);
  };

  const dispatch = useCallback(
    (action: ProjectAction) => {
      const before = projectRef.current;
      if (!before || !mayApply(user, before, action)) return;
      if (action.type === 'floorFlag') {
        // A flag locks the floor: changes before it are not undone past it (A-08).
        past.current = [];
        future.current = [];
      } else if (!ALWAYS.has(action.type)) {
        past.current = [...past.current, before].slice(-HISTORY_LIMIT);
        future.current = [];
      }
      syncHistory();
      commit(projectReducer(before, action), !NOT_A_CHANGE.has(action.type));
    },
    [user],
  );

  /** Undo / Redo the latest change of this session; saved like any other change. */
  const step = useCallback((from: typeof past, to: typeof past) => {
    const now = projectRef.current;
    const snapshot = from.current.at(-1);
    if (!now || !snapshot) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, now];
    syncHistory();
    commit(restore(snapshot, now));
  }, []);
  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  const isDirty = () => changeSeq.current !== savedSeq.current;

  /**
   * Saves this tab's copy. `overwrite` (after a conflict, E0802): the copy becomes the next
   * version, replacing what others saved since it was opened; the API still checks the user's
   * rights (an engineer cannot replace another layer, E1002).
   */
  const save = useCallback(
    async (opts: { overwrite?: boolean } = {}): Promise<boolean> => {
      if (!mayEdit() || !projectRef.current) return true;
      if (inFlight.current) await inFlight.current;
      if (!isDirty() && !opts.overwrite) return true;
      const seq = changeSeq.current;
      setSaveState('saving');
      const run = (async () => {
        try {
          let snapshot = projectRef.current!;
          if (opts.overwrite) {
            const latest = (await api.getProject(snapshot.id)).project;
            snapshot = { ...snapshot, version: latest.version };
          }
          const saved = (await api.saveProject(snapshot)).project;
          savedSeq.current = seq;
          setSavedCount(seq);
          // Keep edits made while saving; take the new version from the server.
          projectRef.current = projectReducer(projectRef.current!, {
            type: 'saved',
            version: saved.version,
            updatedAt: saved.meta.updatedAt,
          });
          setProject(projectRef.current);
          setSaveState(isDirty() ? 'idle' : 'saved');
          setSaveError(null);
          return true;
        } catch (e) {
          const conflict = e instanceof ApiError && e.status === 409;
          setSaveState(conflict ? 'conflict' : 'error');
          setSaveError((e as Error).message);
          return false;
        }
      })();
      inFlight.current = run;
      const ok = await run;
      inFlight.current = null;
      return ok;
    },
    [api, mayEdit],
  );

  /**
   * "Save as new project" (Technical Lead, A-01): this tab's copy, with everything not saved yet,
   * becomes a new project named `name`; its floor plans are copied on the server. Returns the
   * new project's id. The open project is left as it is on the server.
   */
  const saveAsNew = useCallback(
    async (name: string): Promise<string> => {
      const current = projectRef.current!;
      const copy = { ...current, details: { ...current.details, name } };
      const created = (await api.createProject(copy, current.id)).project;
      // The work is kept in the new project: leaving this one must not ask again.
      savedSeq.current = changeSeq.current;
      setSavedCount(changeSeq.current);
      return created.id;
    },
    [api],
  );

  // Browser close / reload with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Leaving the project inside the app with unsaved changes asks first (Save / Leave / Stay).
  // Moving between the project's own tabs keeps the copy in memory, so it is not asked.
  const blocker = useBlocker(({ nextLocation }) => {
    const inside = `/projects/${projectId}`;
    const staying =
      nextLocation.pathname === inside || nextLocation.pathname.startsWith(`${inside}/`);
    return !staying && mayEdit() && isDirty();
  });
  const blocked = blocker.state === 'blocked';

  return {
    project,
    loadError,
    readOnly,
    canEdit,
    layers,
    dispatch,
    undo,
    redo,
    canUndo: historyLength.past > 0,
    canRedo: historyLength.future > 0,
    save,
    saveAsNew,
    canSaveAsNew: canCreateProject(user),
    reload: load,
    saveState,
    saveError,
    dirty: changeCount !== savedCount || saveState === 'saving',
    leavePrompt: blocked
      ? {
          leave: () => blocker.proceed?.(),
          stay: () => blocker.reset?.(),
          saveAndLeave: async () => {
            if (await save()) blocker.proceed?.();
            else blocker.reset?.();
          },
        }
      : null,
  };
}
