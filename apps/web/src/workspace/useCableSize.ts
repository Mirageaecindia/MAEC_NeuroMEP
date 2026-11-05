import {
  inputsKey,
  mergeRun,
  scopeItems,
  type ElementResult,
  type Project,
  type SizingScope,
} from '@neuromep/shared';
import { useState } from 'react';
import { useNotice } from '../layout/Shell';
import { runEngine } from './engineClient';
import type { EngineReply } from './engineRun';
import { useWorkspace } from './ProjectWorkspace';

/**
 * What a run found for the feeders and risers in scope, e.g. ": 4 sized, 1 blocked - select an
 * item to see why" - empty when everything was sized and passes.
 */
function outcome(p: Project, scope: SizingScope, reply: EngineReply): string {
  const ids = new Set(
    scopeItems(p, scope)
      .filter((x) => !('kind' in x))
      .map((x) => x.id),
  );
  const results = reply.results.filter((r) => ids.has(r.elementId));
  const failing = (r: ElementResult) => Object.values(r.checks).some((c) => c?.state === 'fail');
  const counts: [number, string][] = [
    [results.filter((r) => r.status === 'blocked').length, 'blocked'],
    [results.filter((r) => r.status !== 'blocked' && failing(r)).length, 'failing a check'],
    [results.filter((r) => r.status === 'awaiting-load').length, 'waiting for load'],
  ];
  const problems = counts.filter(([n]) => n > 0);
  if (problems.length === 0) return '';
  const sized = results.length - problems.reduce((t, [n]) => t + n, 0);
  const parts = [
    ...(sized > 0 ? [`${sized} sized`] : []),
    ...problems.map(([n, what]) => `${n} ${what}`),
  ];
  return `: ${parts.join(', ')} - select an item to see why in the right panel`;
}

/** A finished run: the engine's reply and the project with the scope's results merged in. */
export interface CableSizeRun {
  reply: EngineReply;
  project: Project;
}

/**
 * Cable Size (FR-21, WBS 1.7.1): runs the engine on the project as it is now and keeps the
 * results of the items in `scope` (users with the electrical layer; others only see them, e.g.
 * the run before an export). Edits made while it runs leave those results Out of date.
 */
export function useCableSize() {
  const { project, editor } = useWorkspace();
  const notice = useNotice();
  const [running, setRunning] = useState(false);

  async function run(scope: SizingScope, name: string): Promise<CableSizeRun | null> {
    const at = new Date().toISOString();
    const key = inputsKey(project);
    setRunning(true);
    try {
      const reply = await runEngine(project);
      const info = {
        runId: crypto.randomUUID(),
        at,
        engineVersion: reply.engineVersion,
        inputsKey: key,
      };
      if (editor.layers.includes('electrical')) {
        editor.dispatch({ type: 'cableSize', scope, results: reply.results, run: info });
      }
      notice(
        `Cable Size ran on ${name}${reply.converged ? '' : ' - no stable size (E2601)'}${outcome(project, scope, reply)}.`,
      );
      const results = mergeRun(project, scope, reply.results, info);
      return { reply, project: { ...project, model: { ...project.model, results } } };
    } catch (err) {
      notice(`Cable Size could not run: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setRunning(false);
    }
  }

  return { run, running };
}
