import type { Project } from '@neuromep/shared';
import { engineRun } from './engineRun';

/** The calculation engine off the screen thread (Section 7, layer 04): one run per message. */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; project: Project }>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (e) => {
  const { id, project } = e.data;
  try {
    scope.postMessage({ id, ok: true, reply: engineRun(project) });
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
