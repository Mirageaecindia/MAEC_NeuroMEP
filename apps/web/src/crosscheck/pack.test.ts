import {
  completenessIssues,
  parseProjectFile,
  serializeProject,
  sourceConnected,
} from '@neuromep/shared';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crossCheckCases } from './cases';
import { checkBlocks, packProject } from './pack';

const dir = resolve(__dirname, '../../../../docs/crosscheck');
const fileOf = (id: string) => {
  const names: Record<string, string> = {
    'CC-01': 'CC-01_Office_tower',
    'CC-02': 'CC-02_Residential_with_standby',
    'CC-03': 'CC-03_Retail_with_pumps',
    'CC-04': 'CC-04_Car_park_and_plant',
  };
  return join(dir, `${names[id]}.json`);
};

describe('#TASK-26 WBS 1.7.5 engineer cross-check pack', () => {
  const cases = crossCheckCases().map((c) => ({ c, p: packProject(c) }));

  it.each(cases.map(({ c, p }) => [c.id, c, p] as const))(
    '%s: a complete network that Cable Size sizes without a block',
    (_id, c, p) => {
      expect(sourceConnected(p.model)).toBe(true); // Cable Size enabled (A-07)
      expect(completenessIssues(p.model, p.building.floors)).toEqual([]);
      expect(p.model.results.filter((r) => r.status === 'blocked')).toEqual([]);
      expect(p.model.results.flatMap((r) => r.errors)).not.toContain('E1901');
      const blocks = checkBlocks(p, c.featured);
      expect(blocks.filter((b) => b.featured)).toHaveLength(c.featured.length);
    },
  );

  // The files in docs/crosscheck are what the engineer checks: they must match the engine.
  it.each(cases.map(({ c, p }) => [c.id, p] as const))(
    '%s: docs/crosscheck holds the current engine results (else: npm run crosscheck -w @neuromep/web)',
    (id, p) => {
      const text = readFileSync(fileOf(id), 'utf8');
      expect(parseProjectFile(text).ok).toBe(true);
      expect(text.replace(/\r\n/g, '\n')).toBe(serializeProject(p));
    },
  );
});
