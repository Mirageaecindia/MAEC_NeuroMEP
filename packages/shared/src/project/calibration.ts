import { SHEET_SIZES_MM, type SheetSize } from './enums.js';
import type { PdfPoint } from './schema.js';

/** One PDF user-space unit is 1/72 inch on the sheet. */
export const PDF_UNIT_M = 0.0254 / 72;

export function pdfDistance(a: PdfPoint, b: PdfPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Two-point calibration (FR-08): metres per PDF unit from two picked points and the real
 * distance between them. Points are in PDF page units, so zoom and pan never affect the result.
 */
export function twoPointMetresPerUnit(a: PdfPoint, b: PdfPoint, realDistanceM: number): number {
  if (!(realDistanceM > 0)) throw new Error('The real distance must be greater than 0 m.');
  const d = pdfDistance(a, b);
  if (d < 1e-6) throw new Error('Pick two different points.');
  return realDistanceM / d;
}

/** Real length (m) between two PDF points with a given calibration. */
export function measureMetres(a: PdfPoint, b: PdfPoint, metresPerUnit: number): number {
  return pdfDistance(a, b) * metresPerUnit;
}

/** Drawing-scale calibration: 1:N means one unit on paper is N units real. Less reliable. */
export function drawingScaleMetresPerUnit(scaleDenominator: number): number {
  if (!(scaleDenominator > 0)) throw new Error('The scale must be greater than 0.');
  return PDF_UNIT_M * scaleDenominator;
}

/**
 * Whether the PDF page has the nominal size of the chosen sheet (either orientation). If not, the
 * PDF was probably scaled when it was produced and drawing-scale calibration will be wrong.
 */
export function pageMatchesSheet(
  page: { widthPt: number; heightPt: number },
  sheet: SheetSize,
  tolerance = 0.03,
): boolean {
  const toMm = (pt: number) => (pt * 25.4) / 72;
  const [pw, ph] = [toMm(page.widthPt), toMm(page.heightPt)].sort((x, y) => x - y) as [
    number,
    number,
  ];
  const { w, h } = SHEET_SIZES_MM[sheet];
  return Math.abs(pw - w) / w <= tolerance && Math.abs(ph - h) / h <= tolerance;
}
