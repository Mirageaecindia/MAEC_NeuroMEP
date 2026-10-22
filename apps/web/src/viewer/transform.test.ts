import { measureMetres, twoPointMetresPerUnit } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import {
  fitToView,
  pdfToScreen,
  screenToPdf,
  zoomAround,
  type Affine,
  type ViewState,
} from './transform';

/** pdf.js PageViewport transform at scale 1 for viewBox [x0, y0, x1, y1] and a page rotation. */
function pageTransform(
  viewBox: [number, number, number, number],
  rotation: 0 | 90 | 180 | 270,
): Affine {
  const [x0, y0, x1, y1] = viewBox;
  switch (rotation) {
    case 0:
      return [1, 0, 0, -1, -x0, y1];
    case 90:
      return [0, 1, 1, 0, -y0, -x0];
    case 180:
      return [-1, 0, 0, 1, x1, -y0];
    case 270:
      return [0, -1, -1, 0, y1, x1];
  }
}

const A3 = pageTransform([0, 0, 1191, 842], 0);
const views: ViewState[] = [
  { zoom: 1, panX: 0, panY: 0 },
  { zoom: 0.25, panX: 40, panY: -12 },
  { zoom: 3.7, panX: -900, panY: -420 },
];

describe('plan viewer coordinates', () => {
  it('maps a PDF point to the screen and back at any zoom and pan', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const m = pageTransform([10, 20, 1201, 862], rotation);
      for (const view of views) {
        const p = { x: 333.3, y: 512.25 };
        const back = screenToPdf(pdfToScreen(p, view, m), view, m);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it('puts the PDF origin at the bottom-left of an unrotated page', () => {
    expect(pdfToScreen({ x: 0, y: 0 }, views[0]!, A3)).toEqual({ x: 0, y: 842 });
  });

  it('calibration from picked points does not depend on zoom or pan', () => {
    // The engineer clicks the same two grid intersections at three zoom levels.
    const gridA = { x: 150, y: 600 };
    const gridB = { x: 870, y: 600 };
    const results = views.map((view) => {
      const a = screenToPdf(pdfToScreen(gridA, view, A3), view, A3);
      const b = screenToPdf(pdfToScreen(gridB, view, A3), view, A3);
      return twoPointMetresPerUnit(a, b, 25.4);
    });
    for (const r of results) expect(r).toBeCloseTo(25.4 / 720, 12);
    // and a stored calibration measures the same at any zoom
    const mpu = results[0]!;
    expect(measureMetres({ x: 150, y: 100 }, { x: 150, y: 460 }, mpu)).toBeCloseTo(12.7, 9);
  });

  it('zooms around the cursor without moving the point under it', () => {
    const view = { zoom: 1, panX: 10, panY: 20 };
    const cursor = { x: 300, y: 200 };
    const before = screenToPdf(cursor, view, A3);
    const after = screenToPdf(cursor, zoomAround(view, 2, cursor), A3);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('fits a page inside the viewer, centred', () => {
    const v = fitToView({ width: 1191, height: 842 }, { width: 800, height: 600 }, 0);
    expect(v.zoom).toBeCloseTo(800 / 1191, 9);
    expect(v.panX).toBeCloseTo(0, 9);
    expect(v.panY).toBeCloseTo((600 - 842 * v.zoom) / 2, 9);
  });
});
