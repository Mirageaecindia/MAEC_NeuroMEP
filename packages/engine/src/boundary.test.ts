import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Architecture rule (CLAUDE.md): the engine stays pure, with no UI, database or server imports.
const ALLOWED_DEPENDENCIES = new Set(['@neuromep/shared', '@neuromep/rulepacks', 'zod']);

describe('engine boundary', () => {
  it('depends only on shared types, rule packs and zod', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const disallowed = Object.keys(pkg.dependencies ?? {}).filter(
      (d) => !ALLOWED_DEPENDENCIES.has(d),
    );
    expect(disallowed).toEqual([]);
  });
});
