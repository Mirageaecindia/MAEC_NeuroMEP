import type { Point } from './transform';

/**
 * Snapping for calibration clicks (#TASK-07): endpoints of the vector lines in the PDF.
 *
 * pdf.js (v6) delivers each path as `constructPath` with args [paintOp, [data], minMax], where
 * `data` is a flat list of drawing commands (DrawOPS) in the current user space. The current
 * transform comes from save / restore / transform operators and form XObjects, so it is tracked
 * here to return endpoints in PDF page units - the same space calibration points are stored in.
 */

/** pdf.js DrawOPS codes (src/shared/util.js). */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** The pdf.js OPS codes this needs (pass `pdfjs.OPS`). */
export interface SnapOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 then m2 (PDF concatenation: point x m1 x m2). */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

const apply = (m: Matrix, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** All line / curve endpoints of the page's vector paths, in PDF page units, de-duplicated. */
export function extractSnapPoints(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: SnapOps,
): Point[] {
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const seen = new Set<string>();
  const points: Point[] = [];
  const add = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(p);
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.transform && args) ctm = multiply(args as Matrix, ctm);
    else if (fn === ops.paintFormXObjectBegin && args) {
      stack.push(ctm);
      const m = args[0] as Matrix | null;
      if (m) ctm = multiply(m, ctm);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.constructPath && args) {
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      for (let j = 0; j < data.length;) {
        switch (data[j++]) {
          case DRAW.moveTo:
          case DRAW.lineTo:
            add(data[j]!, data[j + 1]!);
            j += 2;
            break;
          case DRAW.curveTo:
            add(data[j + 4]!, data[j + 5]!);
            j += 6;
            break;
          case DRAW.quadraticCurveTo:
            add(data[j + 2]!, data[j + 3]!);
            j += 4;
            break;
          case DRAW.closePath:
            break;
          default:
            j = data.length; // unknown command: stop reading this path
        }
      }
    }
  }
  return points;
}

/** Grid index for nearest-point queries (fast enough for mouse moves on large plans). */
export class SnapIndex {
  private readonly cells = new Map<string, Point[]>();

  constructor(
    points: readonly Point[],
    private readonly cell = 20,
  ) {
    for (const p of points) {
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = this.cells.get(k);
      if (list) list.push(p);
      else this.cells.set(k, [p]);
    }
  }

  get size(): number {
    let n = 0;
    for (const l of this.cells.values()) n += l.length;
    return n;
  }

  /** Nearest point within `maxDist` (PDF units), or null. */
  nearest(p: Point, maxDist: number): Point | null {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    let best: Point | null = null;
    let bestD = maxDist;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        for (const q of this.cells.get(this.key(gx, gy)) ?? []) {
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d <= bestD) {
            bestD = d;
            best = q;
          }
        }
      }
    }
    return best;
  }

  private key(gx: number, gy: number) {
    return `${gx}:${gy}`;
  }
}

/** Snap tolerance: 10 screen pixels, expressed in PDF units at the current zoom. */
export const SNAP_PIXELS = 10;
export const snapTolerance = (zoom: number) => SNAP_PIXELS / zoom;
