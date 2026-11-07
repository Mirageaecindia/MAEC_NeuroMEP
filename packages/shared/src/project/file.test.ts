import { describe, expect, it } from 'vitest';
import { completeProject } from '../testing.js';
import { parseProjectFile, serializeProject, uniqueProjectName } from './file.js';

describe('project file (.json)', () => {
  it('round-trips the full model', () => {
    const p = completeProject();
    p.auditLog.push({
      id: 'a1',
      at: '2026-10-22T09:00:00.000Z',
      userId: 'u-lead',
      area: 'demandFactor',
      key: 'byLoadType.1',
      from: null,
      to: 0.8,
    });
    p.calculation.defaultOverrides = { targetPowerFactor: 0.95 };
    p.building.mechanicalFloorIds = [p.building.floors.at(-1)!.id];
    expect(parseProjectFile(serializeProject(p))).toEqual({ ok: true, project: p });
  });

  it('upgrades version-1 files to version 2 (v0.3 baseline)', () => {
    const v2 = completeProject();
    const { workingDirectory: _w, model: _m, ...rest } = v2;
    const v1 = {
      ...rest,
      schemaVersion: 1,
      calculation: {
        ...v2.calculation,
        system: undefined,
        checks: { ...v2.calculation.checks, currentCarryingCapacity: false },
      },
      meta: { ...v2.meta, lastPage: 'building-modelling' },
    };
    const result = parseProjectFile(JSON.stringify(v1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.schemaVersion).toBe(2);
    expect(result.project.calculation.checks.currentCarryingCapacity).toBe(true);
    expect(result.project.calculation.system.frequencyHz).toEqual({
      value: null,
      source: 'rulepack',
    });
    expect(result.project.workingDirectory).toBe('');
    expect(result.project.model).toEqual({
      elements: [],
      cables: [],
      risers: [],
      floorFlags: [],
      results: [],
      generatorFactors: [],
    });
    expect(result.project.meta.lastPage).toBe('modelling');
  });

  it('rejects a wrong schemaVersion', () => {
    const text = JSON.stringify({ ...completeProject(), schemaVersion: 3 });
    expect(parseProjectFile(text)).toEqual({
      ok: false,
      error: 'Unsupported project file version 3. This version of NeuroMEP reads version 2.',
    });
  });

  it('rejects files that are not JSON or not project files', () => {
    expect(parseProjectFile('{oops').ok).toBe(false);
    expect(parseProjectFile('{"name":"x"}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('no schemaVersion'),
    });
  });

  it('rejects a damaged project file and says where', () => {
    const p = JSON.parse(serializeProject(completeProject()));
    p.details.designStage = 'XX';
    expect(parseProjectFile(JSON.stringify(p))).toMatchObject({
      ok: false,
      error: expect.stringContaining('details.designStage'),
    });
  });
});

describe('uniqueProjectName (copies get their own name, 7 Nov 2026)', () => {
  it('keeps a free name and adds _duplicated, then a number', () => {
    expect(uniqueProjectName('Tower', ['Mall'])).toBe('Tower');
    expect(uniqueProjectName('Tower', ['tower '])).toBe('Tower_duplicated');
    expect(uniqueProjectName('Tower', ['Tower', 'Tower_duplicated'])).toBe('Tower_duplicated_2');
    expect(uniqueProjectName('', [''])).toBe('');
  });
});
