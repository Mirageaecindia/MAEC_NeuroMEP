import { createEmptyProject, setBoardRiser } from '@neuromep/shared';
import {
  completeProject,
  FIXED_NOW,
  modelledProject,
  testCable,
  testElement,
} from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { projectReducer, withUploadedPlan, type AuditMeta } from './projectReducer';

const audit: AuditMeta = { id: 'a1', at: FIXED_NOW, userId: 'u-lead' };
const empty = () => createEmptyProject({ id: 'p', userId: 'u-lead', now: FIXED_NOW });

describe('Page 1 project reducer', () => {
  it('selecting Dubai loads the rule pack defaults without overwriting edited fields', () => {
    let p = projectReducer(empty(), { type: 'site', key: 'ambientSoilC', value: 28 });
    p = projectReducer(p, { type: 'region', region: 'dubai' });
    expect(p.rulePackId).toBe('dubai');
    expect(p.site.ambientAirC).toEqual({ value: 50, source: 'rulepack' });
    expect(p.site.ambientSoilC).toEqual({ value: 28, source: 'user' });
  });

  it('a region without a rule pack changes nothing else', () => {
    const p = projectReducer(empty(), { type: 'region', region: 'abu-dhabi' });
    expect(p.rulePackId).toBeNull();
    expect(p.site.ambientAirC.value).toBeNull();
  });

  it('logs demand-factor changes in the audit log', () => {
    const p = projectReducer(empty(), {
      type: 'demandFactor',
      table: 'byLoadType',
      key: '1',
      value: 0.8,
      audit,
    });
    expect(p.calculation.demandFactors.byLoadType['1']).toEqual({ value: 0.8, source: 'user' });
    expect(p.auditLog).toEqual([
      { ...audit, area: 'demandFactor', key: 'byLoadType.1', from: null, to: 0.8 },
    ]);
    // unchanged value: no new entry
    expect(
      projectReducer(p, { type: 'demandFactor', table: 'byLoadType', key: '1', value: 0.8, audit })
        .auditLog,
    ).toHaveLength(1);
  });

  it('logs calculation-default overrides and their reset', () => {
    let p = projectReducer(empty(), {
      type: 'defaultOverride',
      key: 'targetPowerFactor',
      value: 0.95,
      ruleValue: 0.92,
      audit,
    });
    expect(p.calculation.defaultOverrides).toEqual({ targetPowerFactor: 0.95 });
    p = projectReducer(p, {
      type: 'defaultOverride',
      key: 'targetPowerFactor',
      value: undefined,
      ruleValue: 0.92,
      audit: { ...audit, id: 'a2' },
    });
    expect(p.calculation.defaultOverrides).toEqual({});
    expect(p.auditLog.map((e) => [e.key, e.from, e.to])).toEqual([
      ['targetPowerFactor', 0.92, 0.95],
      ['targetPowerFactor', 0.95, 0.92],
    ]);
  });

  it('replacing a calibrated plan resets it to Uncalibrated and keeps the old plan for alignment', () => {
    const p = completeProject();
    const gf = p.building.floors.find((f) => f.code === 'GF')!;
    const next = projectReducer(p, {
      type: 'planUploaded',
      floorId: gf.id,
      plan: {
        kind: 'pdf',
        fileId: 'file-2',
        fileName: 'GF rev B.pdf',
        uploadedAt: FIXED_NOW,
        uploadedBy: 'u-lead',
        page: { widthPt: 2384, heightPt: 1684 },
      },
      now: FIXED_NOW,
    });
    const plan = next.building.floors.find((f) => f.id === gf.id)!.plan!;
    expect(plan.fileId).toBe('file-2');
    expect(plan.calibration).toBeNull();
    expect(plan.replaced).toMatchObject({
      fileId: 'file-1',
      alignment: 'pending',
      calibration: gf.plan!.calibration,
    });
  });

  it('a first upload has no replaced plan', () => {
    const plan = withUploadedPlan(
      null,
      {
        kind: 'pdf',
        fileId: 'f',
        fileName: 'a.pdf',
        uploadedAt: FIXED_NOW,
        uploadedBy: 'u',
        page: { widthPt: 1, heightPt: 1 },
      },
      FIXED_NOW,
    );
    expect(plan).not.toHaveProperty('replaced');
  });

  it('importing a file keeps the open project identity and version', () => {
    const current = { ...empty(), id: 'open', version: 7 };
    const next = projectReducer(current, { type: 'replaceContent', source: completeProject() });
    expect(next.id).toBe('open');
    expect(next.version).toBe(7);
    expect(next.details.name).toBe('NeoTower');
    expect(next.meta).toEqual(current.meta);
  });
});

describe('#TASK-17 / #TASK-18 risers', () => {
  it('a removed board leaves the riser that fed it', () => {
    let p = modelledProject();
    p = projectReducer(p, { type: 'risers', risers: setBoardRiser([], 'db-1', 'riser-1') });
    expect(p.model.risers[0]!.feeds).toEqual(['db-1']);
    p = projectReducer(p, { type: 'removeElements', ids: ['db-1'] });
    expect(p.model.risers[0]!.feeds).toEqual([]);
  });
});

describe('floors, plans and group edits (user request 7 Nov 2026)', () => {
  const plan = {
    kind: 'pdf' as const,
    fileId: 'typ-1',
    fileName: 'Typical.pdf',
    uploadedAt: FIXED_NOW,
    uploadedBy: 'u-lead',
    page: { widthPt: 1191, heightPt: 842 },
  };

  it('gives one plan to the typical set and shares its calibration; a flagged floor keeps its own', () => {
    const p = completeProject();
    const [one, two] = p.building.floors.filter((f) => f.type === 'typical');
    let next = projectReducer(p, {
      type: 'planUploaded',
      floorId: one!.id,
      plan,
      now: FIXED_NOW,
      alsoFloorIds: [two!.id],
    });
    const plans = next.building.floors.filter((f) => f.plan?.fileId === 'typ-1');
    expect(plans.map((f) => f.id)).toEqual([one!.id, two!.id]);
    const cal = completeProject().building.floors.find((f) => f.plan)!.plan!.calibration;
    next = projectReducer(next, { type: 'calibration', floorId: one!.id, calibration: cal });
    expect(next.building.floors.find((f) => f.id === two!.id)!.plan!.calibration).toEqual(cal);

    const flagged = {
      ...next,
      model: {
        ...next.model,
        floorFlags: [
          { floorId: two!.id, discipline: 'electrical' as const, by: 'u', at: FIXED_NOW },
        ],
      },
    };
    const again = projectReducer(flagged, {
      type: 'calibration',
      floorId: one!.id,
      calibration: null,
    });
    expect(again.building.floors.find((f) => f.id === two!.id)!.plan!.calibration).toEqual(cal);
  });

  it('renames a floor (never empty) and sets a mechanical floor', () => {
    const p = completeProject();
    const first = p.building.floors.find((f) => f.code === '1')!;
    let next = projectReducer(p, { type: 'renameFloor', floorId: first.id, name: ' Office 1 ' });
    expect(next.building.floors.find((f) => f.id === first.id)!.name).toBe('Office 1');
    expect(projectReducer(next, { type: 'renameFloor', floorId: first.id, name: ' ' })).toBe(next);
    next = projectReducer(next, { type: 'mechanicalFloor', index: 1, floorId: first.id });
    expect(next.building.mechanicalFloorIds).toEqual([null, first.id]);
    next = projectReducer(next, { type: 'mechanicalFloors', ids: [first.id] });
    expect(next.building.mechanicalFloorIds).toEqual([first.id]);
  });

  it('moves a group with the feeders between them, and rotates in steps that wrap at 360', () => {
    const p = completeProject();
    const smdb = { ...testElement('smdb', 'smdb'), position: { x: 0, y: 0 } };
    const db = { ...testElement('db', 'db'), position: { x: 1, y: 0 } };
    p.model.elements = [smdb, db];
    p.model.cables = [testCable(smdb, db)];
    const moved = projectReducer(p, {
      type: 'moveElements',
      ids: ['smdb', 'db'],
      delta: { x: 2, y: 3 },
    });
    expect(moved.model.elements.map((e) => e.position)).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    expect(moved.model.cables[0]!.route).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    let turned = projectReducer(p, { type: 'rotateElements', ids: ['db'], to: 270 });
    turned = projectReducer(turned, { type: 'rotateElements', ids: ['db'], by: 90 });
    expect(turned.model.elements.find((e) => e.id === 'db')!.rotationDeg).toBe(0);
  });
});
