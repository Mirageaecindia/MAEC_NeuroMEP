import { describe, expect, it } from 'vitest';
import {
  drawingScaleMetresPerUnit,
  measureMetres,
  PDF_UNIT_M,
  pageMatchesSheet,
  twoPointMetresPerUnit,
} from './calibration.js';

describe('two-point calibration', () => {
  it('gives metres per PDF unit from two points and the real distance', () => {
    // 3-4-5 triangle: 500 units apart, 25 m real -> 0.05 m per unit
    expect(twoPointMetresPerUnit({ x: 100, y: 100 }, { x: 400, y: 500 }, 25)).toBeCloseTo(0.05, 12);
  });

  it('measures a second distance with the stored calibration (Verify)', () => {
    const mpu = twoPointMetresPerUnit({ x: 0, y: 0 }, { x: 720, y: 0 }, 8.4);
    expect(measureMetres({ x: 10, y: 10 }, { x: 10, y: 370 }, mpu)).toBeCloseTo(4.2, 12);
  });

  it('refuses coincident points and non-positive distances', () => {
    expect(() => twoPointMetresPerUnit({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toThrow(
      'two different points',
    );
    expect(() => twoPointMetresPerUnit({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toThrow();
    expect(() => twoPointMetresPerUnit({ x: 0, y: 0 }, { x: 10, y: 0 }, -2)).toThrow();
  });
});

describe('drawing-scale calibration', () => {
  it('converts 1:100 to metres per PDF unit (1 unit = 1/72 inch on paper)', () => {
    expect(drawingScaleMetresPerUnit(100)).toBeCloseTo(PDF_UNIT_M * 100, 15);
    expect(drawingScaleMetresPerUnit(100) * 72).toBeCloseTo(2.54, 12); // 1 inch on paper = 2.54 m
  });

  it('checks the PDF page has the nominal sheet size (either orientation)', () => {
    const a1Landscape = { widthPt: (841 * 72) / 25.4, heightPt: (594 * 72) / 25.4 };
    expect(pageMatchesSheet(a1Landscape, 'A1')).toBe(true);
    expect(pageMatchesSheet(a1Landscape, 'A0')).toBe(false);
  });
});
