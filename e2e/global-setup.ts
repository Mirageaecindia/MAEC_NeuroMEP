import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const FIXTURE = join(import.meta.dirname, '.fixture', 'SmokeTower.json');

/** Generates the project file the smoke tests import (from the shared test fixtures). */
export default function globalSetup() {
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--conditions=source',
      join(import.meta.dirname, 'make-fixture.ts'),
      FIXTURE,
    ],
    { stdio: 'inherit' },
  );
}
