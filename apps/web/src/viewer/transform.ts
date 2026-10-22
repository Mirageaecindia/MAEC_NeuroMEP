/**
 * Screen <-> PDF coordinate conversion for the plan viewer.
 *
 * pdf.js gives the page transform at scale 1 as an affine matrix [a, b, c, d, e, f] mapping PDF
 * user space (points, y up) to "view" space (CSS px at 100 %, y down, rotation applied). The
 * viewer then shows the page at `zoom`, offset by `pan`. Calibration points are always stored in
 * PDF user space, so zooming and panning never change them.
 */
export type Affine = readonly [number, number, number, number, number, number];
export interface Point {
  x: number;
  y: number;
}
export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('Page transform is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Screen point (relative to the viewer's top-left) -> PDF user-space point. */
export function screenToPdf(screen: Point, view: ViewState, pageTransform: Affine): Point {
  const v1 = { x: (screen.x - view.panX) / view.zoom, y: (screen.y - view.panY) / view.zoom };
  return applyAffine(invertAffine(pageTransform), v1);
}

/** PDF user-space point -> screen point. */
export function pdfToScreen(pdf: Point, view: ViewState, pageTransform: Affine): Point {
  const v1 = applyAffine(pageTransform, pdf);
  return { x: v1.x * view.zoom + view.panX, y: v1.y * view.zoom + view.panY };
}

/** Zoom by `factor` keeping the point under the cursor fixed. */
export function zoomAround(
  view: ViewState,
  factor: number,
  at: Point,
  min = 0.05,
  max = 16,
): ViewState {
  const zoom = Math.min(max, Math.max(min, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, panX: at.x - (at.x - view.panX) * k, panY: at.y - (at.y - view.panY) * k };
}

/** Zoom and pan that fit a page of `page` CSS px (at 100 %) inside the viewer, centred. */
export function fitToView(
  page: { width: number; height: number },
  viewer: { width: number; height: number },
  margin = 16,
): ViewState {
  const zoom = Math.max(
    0.01,
    Math.min((viewer.width - 2 * margin) / page.width, (viewer.height - 2 * margin) / page.height),
  );
  return {
    zoom,
    panX: (viewer.width - page.width * zoom) / 2,
    panY: (viewer.height - page.height * zoom) / 2,
  };
}
