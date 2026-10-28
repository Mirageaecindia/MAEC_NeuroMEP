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
import { projectReducer, type ProjectAction } from './projectReducer';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** WBS 1.2.5: unsaved changes are saved at most 10 s after the first of them. */
export const AUTOSAVE_INTERVAL_MS = 10_000;

/** Actions that change the floor plans and their calibration (any engineer of the project). */
const PLAN_ACTIONS = new Set<ProjectAction['type']>(['planUploaded', 'calibration']);
/** Bookkeeping every editor may record. */
const ALWAYS = new Set<ProjectAction['type']>(['saved', 'lastPage']);

/**
 * May this user apply this action (Section 2)? Project Set-up: the Technical Lead; plans: the
 * engineers of the project; anything else: the Technical Lead. The API checks the same on save.
 */
export function mayApply(user: UserSummary, project: Project, action: ProjectAction): boolean {
  if (canEditProjectSetup(user)) return true;
  if (!canEditFloorPlans(user, project)) return false;
  if (ALWAYS.has(action.type) || PLAN_ACTIONS.has(action.type)) return true;
  return false;
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

  const applyLoaded = useCallback((p: Project) => {
    projectRef.current = p;
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

  const dispatch = useCallback(
    (action: ProjectAction) => {
      if (!projectRef.current || !mayApply(user, projectRef.current, action)) return;
      projectRef.current = projectReducer(projectRef.current, action);
      setProject(projectRef.current);
      changeSeq.current += 1;
      setChangeCount(changeSeq.current);
    },
    [user],
  );

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
