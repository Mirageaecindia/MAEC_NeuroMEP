import { describe, expect, it } from 'vitest';
import { completeProject } from '../testing.js';
import { parseProjectFile, serializeProject } from './file.js';

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
    p.building.mechanicalFloorIds = [p.building.floors.at(-1)!.id, null, null];
    expect(parseProjectFile(serializeProject(p))).toEqual({ ok: true, project: p });
  });

  it('still reads files saved before D-18 (the working directory is ignored)', () => {
    const old = { ...completeProject(), workingDirectory: 'C:/NeuroMEP_Projects/NeoTower' };
    const result = parseProjectFile(JSON.stringify(old));
    expect(result).toEqual({ ok: true, project: completeProject() });
  });

  it('rejects a wrong schemaVersion', () => {
    const text = JSON.stringify({ ...completeProject(), schemaVersion: 2 });
    expect(parseProjectFile(text)).toEqual({
      ok: false,
      error: 'Unsupported project file version 2. This version of NeuroMEP reads version 1.',
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
