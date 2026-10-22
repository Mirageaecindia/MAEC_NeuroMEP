import { twoPointMetresPerUnit } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { extractSnapPoints, SnapIndex, snapTolerance, type SnapOps } from './snap';

// Arbitrary operator codes for the test (the viewer passes pdfjs.OPS).
const OPS: SnapOps = {
  save: 10,
  restore: 11,
  transform: 12,
  constructPath: 91,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
};
const STROKE = 20;
const M = 0; // moveTo
const L = 1; // lineTo
const C = 2; // curveTo
const Z = 4; // closePath
const path = (...data: number[]) => [STROKE, [Float32Array.from(data)], null];

describe('calibration snap points', () => {
  it('collects line and curve endpoints, de-duplicated', () => {
    const pts = extractSnapPoints(
      [OPS.constructPath, OPS.constructPath],
      [path(M, 0, 0, L, 100, 0, L, 100, 50, Z), path(M, 100, 50, C, 110, 60, 120, 60, 130, 50)],
      OPS,
    );
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 130, y: 50 },
    ]);
  });

  it('applies transforms, save/restore and form XObject matrices', () => {
    const pts = extractSnapPoints(
      [
        OPS.save,
        OPS.transform,
        OPS.constructPath,
        OPS.restore,
        OPS.paintFormXObjectBegin,
        OPS.constructPath,
        OPS.paintFormXObjectEnd,
        OPS.constructPath,
      ],
      [
        null,
        [2, 0, 0, 2, 10, 20], // scale 2, then move by (10, 20)
        path(M, 5, 5),
        null,
        [
          [1, 0, 0, 1, 300, 0],
          [0, 0, 10, 10],
        ],
        path(M, 1, 1),
        null,
        path(M, 7, 7), // back to the page space
      ],
      OPS,
    );
    expect(pts).toEqual([
      { x: 20, y: 30 },
      { x: 301, y: 1 },
      { x: 7, y: 7 },
    ]);
  });

  it('finds the nearest endpoint within the screen tolerance at any zoom', () => {
    const index = new SnapIndex([
      { x: 110, y: 150 },
      { x: 348.11, y: 150 },
      { x: 110, y: 626.22 },
    ]);
    // A click 3 PDF units off grid point A snaps at 100 % (tolerance 10 units) ...
    expect(index.nearest({ x: 113, y: 151 }, snapTolerance(1))).toEqual({ x: 110, y: 150 });
    // ... but not when zoomed in to 800 % (tolerance 1.25 units): the click is taken as is.
    expect(index.nearest({ x: 113, y: 151 }, snapTolerance(8))).toBeNull();
    expect(index.size).toBe(3);
  });

  it('snapped clicks give the exact drawing distance', () => {
    const index = new SnapIndex([
      { x: 110, y: 150 },
      { x: 348.11, y: 150 },
    ]);
    const a = index.nearest({ x: 111.6, y: 148.9 }, snapTolerance(0.5))!;
    const b = index.nearest({ x: 346.2, y: 151.7 }, snapTolerance(0.5))!;
    // 8.4 m bay drawn at 1:100 = 238.11 PDF units
    expect(twoPointMetresPerUnit(a, b, 8.4)).toBeCloseTo(8.4 / 238.11, 12);
  });
});
