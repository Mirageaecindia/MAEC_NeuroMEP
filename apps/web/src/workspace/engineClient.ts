import type { Project } from '@neuromep/shared';
import type { EngineReply } from './engineRun';

type Answer =
  { id: number; ok: true; reply: EngineReply } | { id: number; ok: false; message: string };

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<
  number,
  { resolve: (r: EngineReply) => void; reject: (e: Error) => void }
>();

function engineWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Answer>) => {
    const w = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (!w) return;
    if (e.data.ok) w.resolve(e.data.reply);
    else w.reject(new Error(e.data.message));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'The calculation stopped.'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Runs Cable Size in the engine's Web Worker (WBS 1.7.1). Without Web Workers (unit tests in
 * jsdom) the same engine runs on this thread.
 */
export function runEngine(project: Project): Promise<EngineReply> {
  if (typeof Worker === 'undefined') {
    return import('./engineRun').then((m) => m.engineRun(project));
  }
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    engineWorker().postMessage({ id, project });
  });
}
