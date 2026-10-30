import {
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

/** WBS 1.2.5: unsaved changes are saved at most 10 s after the first of them. */
export const AUTOSAVE_INTERVAL_MS = 10_000;

/** Actions that change the floor plans and their calibration (any engineer of the project). */
const PLAN_ACTIONS = new Set<ProjectAction['type']>(['planUploaded', 'calibration']);
/** Undo keeps the last 50 changes. */
const HISTORY_LIMIT = 50;
/** Bookkeeping every editor may record. */
const ALWAYS = new Set<ProjectAction['type']>(['saved', 'lastPage']);

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
 * Loads a project and keeps it saved: autosave every 10 s while there are unsaved changes, save
 * on leaving the page,
 * optimistic-lock conflicts reported, and a warning before leaving with unsaved changes.
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

  const commit = (next: Project) => {
    projectRef.current = next;
    setProject(next);
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
      commit(projectReducer(before, action));
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

  const save = useCallback(async (): Promise<boolean> => {
    if (!mayEdit() || !projectRef.current) return true;
    if (inFlight.current) await inFlight.current;
    if (!isDirty()) return true;
    const seq = changeSeq.current;
    const snapshot = projectRef.current;
    setSaveState('saving');
    const run = (async () => {
      try {
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
  }, [api, mayEdit]);

  // Autosave every 10 s (WBS 1.2.5): the timer starts with the first unsaved change and is not
  // pushed back by later ones, so at most 10 s of work is ever unsaved. After a save (or a
  // failed one, which is retried) the next change or the remaining changes start it again.
  const unsaved = changeCount !== savedCount;
  useEffect(() => {
    if (!canEdit || !unsaved || saveState === 'conflict' || saveState === 'saving') return;
    const t = setTimeout(() => void save(), AUTOSAVE_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [unsaved, savedCount, canEdit, save, saveState]);

  // Browser close / reload with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Leaving the page inside the app: save first; if that fails, the page asks the user.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      mayEdit() && isDirty() && currentLocation.pathname !== nextLocation.pathname,
  );
  const [leaveFailed, setLeaveFailed] = useState(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // Respond to the router's block from a callback, not synchronously in the effect.
    void Promise.resolve()
      .then(save)
      .then((ok) => (ok ? blocker.proceed() : setLeaveFailed(true)));
  }, [blocker, save]);

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
    reload: load,
    saveState,
    saveError,
    dirty: changeCount !== savedCount || saveState === 'saving',
    leavePrompt: leaveFailed
      ? {
          leave: () => {
            setLeaveFailed(false);
            blocker.proceed?.();
          },
          stay: () => {
            setLeaveFailed(false);
            blocker.reset?.();
          },
        }
      : null,
  };
}
