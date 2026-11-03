import { inputsKey, type SizingScope } from '@neuromep/shared';
import { useState } from 'react';
import { useNotice } from '../layout/Shell';
import { runEngine } from './engineClient';
import type { EngineReply } from './engineRun';
import { useWorkspace } from './ProjectWorkspace';

/**
 * Cable Size (FR-21, WBS 1.7.1): runs the engine on the project as it is now and keeps the
 * results of the items in `scope`. Edits made while it runs leave those results Out of date.
 */
export function useCableSize() {
  const { project, editor } = useWorkspace();
  const notice = useNotice();
  const [running, setRunning] = useState(false);

  async function run(scope: SizingScope, name: string): Promise<EngineReply | null> {
    const at = new Date().toISOString();
    const key = inputsKey(project);
    setRunning(true);
    try {
      const reply = await runEngine(project);
      editor.dispatch({
        type: 'cableSize',
        scope,
        results: reply.results,
        run: { runId: crypto.randomUUID(), at, engineVersion: reply.engineVersion, inputsKey: key },
      });
      notice(`Cable Size ran on ${name}${reply.converged ? '' : ' - no stable size (E2601)'}.`);
      return reply;
    } catch (err) {
      notice(`Cable Size could not run: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setRunning(false);
    }
  }

  return { run, running };
}
