import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// Page changes (save before leaving, then the next page renders) can take over the default 1 s
// when the whole suite runs in parallel; findBy / waitFor wait up to 3 s.
configure({ asyncUtilTimeout: 3000 });

// jsdom has no ResizeObserver; the plan viewer only needs it to exist.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom draws nothing on a canvas; the plan viewer copies pdf.js output with a 2D context.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
