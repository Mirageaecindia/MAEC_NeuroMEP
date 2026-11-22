// Types of the jest-dom matchers (toBeInTheDocument ...) for Vitest's expect.
import '@testing-library/jest-dom/vitest';
import * as domMatchers from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Register the matchers on the very expect the tests import (23 Nov 2026): jest-dom's own
// registration sometimes reached another Vitest instance, and whole screen suites then failed
// with "Invalid Chai property: toBeInTheDocument".
expect.extend(domMatchers);

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
