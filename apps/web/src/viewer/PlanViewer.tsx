import {
  drawingScaleMetresPerUnit,
  measureMetres,
  pageMatchesSheet,
  SheetSizeSchema,
  twoPointMetresPerUnit,
  type Calibration,
  type PdfPlan,
  type PdfPoint,
  type SheetSize,
} from '@neuromep/shared';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react';
import { useApi } from '../auth/AuthContext';
import { NumberInput } from '../components/fields';
import { loadSnapIndex, openPdf } from './pdf';
import { snapTolerance, type SnapIndex } from './snap';
import {
  fitToView,
  pdfToScreen,
  screenToPdf,
  zoomAround,
  type Affine,
  type ViewState,
} from './transform';
import './viewer.css';

type Mode = 'view' | 'calibrate' | 'verify' | 'scale';

/** Driven from the shared toolbar (Zoom In / Zoom Out / Reset). */
export interface ViewerControls {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}
const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Floor-plan viewer (FR-07) with two-point and drawing-scale calibration (FR-08).
 * Renders page 1 with pdf.js; wheel zooms, Shift + right-drag pans. Picked points are converted
 * to PDF page units, so zoom and pan never change a calibration. Clicks snap to the nearest
 * vector line endpoint within 10 screen pixels (can be turned off).
 */
export function PlanViewer(props: {
  projectId: string;
  plan: PdfPlan;
  floorLabel: string;
  readOnly: boolean;
  userId: string;
  onCalibration: (c: Calibration) => void;
  controls?: Ref<ViewerControls>;
}) {
  const { plan } = props;
  const api = useApi();
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<{
    proxy: PDFPageProxy;
    transform: Affine;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>(
    props.plan.calibration || props.readOnly ? 'view' : 'calibrate',
  );
  const [points, setPoints] = useState<PdfPoint[]>([]);
  const [distance, setDistance] = useState<number | null>(null);
  const [scaleDen, setScaleDen] = useState<number | null>(100);
  const [sheet, setSheet] = useState<SheetSize>('A1');
  const pan = useRef<{ x: number; y: number; view: ViewState } | null>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  /** Snap target under the cursor while picking points. */
  const [hover, setHover] = useState<PdfPoint | null>(null);

  // Load the PDF.
  useEffect(() => {
    // The parent remounts this viewer per file, so state starts empty for each plan.
    let doc: PDFDocumentProxy | null = null;
    let live = true;
    (async () => {
      try {
        doc = await openPdf(await api.downloadPlan(props.projectId, plan.fileId));
        const proxy = await doc.getPage(1);
        const vp = proxy.getViewport({ scale: 1 });
        if (!live) return;
        setPage({
          proxy,
          transform: vp.transform as unknown as Affine,
          width: vp.width,
          height: vp.height,
        });
        const el = container.current;
        if (el) setView(fitToView(vp, { width: el.clientWidth, height: el.clientHeight }));
        loadSnapIndex(proxy).then(
          (index) => live && setSnapIndex(index),
          () => undefined, // snapping is optional; free clicks still work
        );
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'The plan could not be opened.');
      }
    })();
    return () => {
      live = false;
      void doc?.loadingTask.destroy();
    };
  }, [api, props.projectId, plan.fileId]);

  // Track the viewer size.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (page && size.width > 0) setView(fitToView(page, size));
  }, [page, size]);

  useImperativeHandle(
    props.controls,
    () => ({
      zoomIn: () => setView((v) => zoomAround(v, 1.25, { x: size.width / 2, y: size.height / 2 })),
      zoomOut: () =>
        setView((v) => zoomAround(v, 1 / 1.25, { x: size.width / 2, y: size.height / 2 })),
      fit,
    }),
    [fit, size],
  );

  // Render at the current zoom (debounced) - vector, so it stays sharp when zoomed.
  useEffect(() => {
    if (!page || !canvas.current) return;
    let task: RenderTask | null = null;
    const t = setTimeout(() => {
      const dpr = window.devicePixelRatio || 1;
      let scale = view.zoom * dpr;
      const pixels = page.width * page.height * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = page.proxy.getViewport({ scale });
      const c = canvas.current!;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.proxy.render({ canvas: c, viewport });
      task.promise.catch(() => undefined);
    }, 120);
    return () => {
      clearTimeout(t);
      task?.cancel();
    };
  }, [page, view.zoom]);

  // Wheel zoom (non-passive listener so the page does not scroll).
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) =>
        zoomAround(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        }),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Escape leaves a tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('view');
        setPoints([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const picking = mode === 'calibrate' || mode === 'verify';
  const snapTarget = (p: PdfPoint): PdfPoint | null =>
    snapOn && snapIndex ? snapIndex.nearest(p, snapTolerance(view.zoom)) : null;

  const local = (e: ReactMouseEvent) => {
    const r = container.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onMouseDown(e: ReactMouseEvent) {
    if (e.button === 2 && e.shiftKey) {
      pan.current = { ...local(e), view };
      return;
    }
    if (e.button !== 0 || !page || !picking) return;
    if (points.length >= 2) return;
    const free = screenToPdf(local(e), view, page.transform);
    setPoints((p) => [...p, snapTarget(free) ?? free]);
  }
  function onMouseMove(e: ReactMouseEvent) {
    if (!pan.current) {
      if (picking && page && points.length < 2) {
        setHover(snapTarget(screenToPdf(local(e), view, page.transform)));
      }
      return;
    }
    const p = local(e);
    const start = pan.current;
    setView({
      ...start.view,
      panX: start.view.panX + p.x - start.x,
      panY: start.view.panY + p.y - start.y,
    });
  }

  function startMode(m: Mode) {
    setMode(m);
    setPoints([]);
    setDistance(null);
    setHover(null);
  }

  const calibration = plan.calibration;
  const now = () => new Date().toISOString();

  function applyTwoPoint() {
    const [a, b] = points;
    if (!a || !b || distance === null) return;
    try {
      props.onCalibration({
        method: 'two-point',
        pointA: a,
        pointB: b,
        realDistanceM: distance,
        metresPerUnit: twoPointMetresPerUnit(a, b, distance),
        calibratedAt: now(),
        calibratedBy: props.userId,
      });
      startMode('view');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function saveVerification(measuredM: number) {
    const [a, b] = points;
    if (!a || !b || calibration?.method !== 'two-point') return;
    props.onCalibration({
      ...calibration,
      verification: { pointA: a, pointB: b, measuredM, at: now() },
    });
    startMode('view');
  }

  function applyScale() {
    if (scaleDen === null || !(scaleDen > 0)) return;
    props.onCalibration({
      method: 'drawing-scale',
      scaleDenominator: scaleDen,
      sheetSize: sheet,
      metresPerUnit: drawingScaleMetresPerUnit(scaleDen),
      calibratedAt: now(),
      calibratedBy: props.userId,
    });
    startMode('view');
  }

  const toScreen = (p: PdfPoint) => (page ? pdfToScreen(p, view, page.transform) : { x: 0, y: 0 });
  const shownLine =
    mode === 'view' && calibration?.method === 'two-point'
      ? [calibration.pointA, calibration.pointB]
      : points;
  const measured =
    mode === 'verify' && points.length === 2 && calibration
      ? measureMetres(points[0]!, points[1]!, calibration.metresPerUnit)
      : null;

  return (
    <div className="viewer">
      {picking && (
        <div className={`viewer-guidance${view.zoom < 1 ? ' low-zoom' : ''}`}>
          <span>
            <strong>Zoom in for accurate calibration.</strong> At {Math.round(view.zoom * 100)} %
            one screen pixel is about {(25.4 / 72 / view.zoom).toFixed(2)} mm on the sheet.
          </span>
          <label className="check">
            <input
              type="checkbox"
              checked={snapOn}
              onChange={(e) => {
                setSnapOn(e.target.checked);
                setHover(null);
              }}
            />
            Snap to line ends{snapIndex ? '' : ' (loading…)'}
          </label>
          {hover && <span className="tag tag-ok">Snapped to a line end</span>}
        </div>
      )}
      {mode === 'calibrate' && (
        <div className="viewer-panel">
          {points.length < 2 ? (
            <span>
              <strong>Calibrate this plan</strong> - components can be placed only on a calibrated
              plan (E0701). Click point <strong>{points.length === 0 ? 'A' : 'B'}</strong> on a
              known dimension (for example the distance between two grid lines).{' '}
              <button className="btn-link" onClick={() => startMode('scale')}>
                Use the drawing scale instead
              </button>
            </span>
          ) : (
            <>
              <label htmlFor="real-distance">Real distance A–B (m)</label>
              <div style={{ width: 120 }}>
                <NumberInput
                  id="real-distance"
                  value={distance}
                  onChange={setDistance}
                  placeholder="e.g. 8.4"
                />
              </div>
              <button
                className="btn btn-sm btn-primary"
                disabled={!(distance !== null && distance > 0)}
                onClick={applyTwoPoint}
              >
                Apply calibration
              </button>
              <button className="btn btn-sm" onClick={() => startMode('calibrate')}>
                Pick again
              </button>
            </>
          )}
        </div>
      )}
      {mode === 'verify' && (
        <div className="viewer-panel">
          {measured === null ? (
            <span>Click two points of another known distance to check the calibration.</span>
          ) : (
            <>
              <span>
                Measured: <strong>{measured.toFixed(3)} m</strong> – does this match the drawing?
              </span>
              {calibration?.method === 'two-point' && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => saveVerification(measured)}
                >
                  Record check
                </button>
              )}
              <button className="btn btn-sm" onClick={() => startMode('verify')}>
                Measure again
              </button>
            </>
          )}
        </div>
      )}
      {mode === 'scale' && (
        <div className="viewer-panel">
          <span className="tag tag-tbc">Less reliable</span>
          <label htmlFor="scale-den">Scale 1 :</label>
          <div style={{ width: 90 }}>
            <NumberInput id="scale-den" value={scaleDen} onChange={setScaleDen} />
          </div>
          <label htmlFor="sheet">Sheet</label>
          <select
            id="sheet"
            className="select"
            style={{ width: 80 }}
            value={sheet}
            onChange={(e) => setSheet(e.target.value as SheetSize)}
          >
            {SheetSizeSchema.options.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className="btn btn-sm btn-primary"
            disabled={!(scaleDen !== null && scaleDen > 0)}
            onClick={applyScale}
          >
            Apply
          </button>
          {!pageMatchesSheet(plan.page, sheet) && (
            <span className="field-error">
              The PDF page is not {sheet} size, so it was probably scaled – prefer two-point
              calibration.
            </span>
          )}
        </div>
      )}

      <div
        ref={container}
        className={`viewer-canvas${mode === 'calibrate' || mode === 'verify' ? ' picking' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => (pan.current = null)}
        onMouseLeave={() => (pan.current = null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {error && <div className="banner banner-error viewer-error">{error}</div>}
        {!page && !error && <div className="viewer-empty muted">Loading plan…</div>}
        <canvas
          ref={canvas}
          className="viewer-page"
          style={
            page
              ? {
                  left: view.panX,
                  top: view.panY,
                  width: page.width * view.zoom,
                  height: page.height * view.zoom,
                }
              : { display: 'none' }
          }
        />
        {page && (
          <svg className="viewer-overlay" width={size.width} height={size.height} aria-hidden>
            {shownLine.length === 2 && (
              <line
                x1={toScreen(shownLine[0]!).x}
                y1={toScreen(shownLine[0]!).y}
                x2={toScreen(shownLine[1]!).x}
                y2={toScreen(shownLine[1]!).y}
                className={mode === 'view' ? 'cal-line saved' : 'cal-line'}
              />
            )}
            {shownLine.map((p, i) => {
              const s = toScreen(p);
              return (
                <g key={i} className={mode === 'view' ? 'cal-point saved' : 'cal-point'}>
                  <circle cx={s.x} cy={s.y} r={5} />
                  <text x={s.x + 8} y={s.y - 8}>
                    {i === 0 ? 'A' : 'B'}
                  </text>
                </g>
              );
            })}
            {picking && hover && (
              <circle className="snap-ring" cx={toScreen(hover).x} cy={toScreen(hover).y} r={9} />
            )}
          </svg>
        )}
        <span className="viewer-hint">
          Zoom: {Math.round(view.zoom * 100)}% · Wheel to zoom · Shift + Right-Click to pan
        </span>
      </div>
      <div className="viewer-status">
        {calibration ? (
          <>
            <span className="tag tag-ok">Calibrated</span>{' '}
            {calibration.method === 'two-point'
              ? `Two points, ${calibration.realDistanceM} m`
              : `Drawing scale 1:${calibration.scaleDenominator} on ${calibration.sheetSize} (less reliable)`}
            {' · '}
            {(calibration.metresPerUnit * 1000).toPrecision(5)} mm per PDF unit
            {calibration.method === 'two-point' && calibration.verification && (
              <> · checked: {calibration.verification.measuredM.toFixed(3)} m</>
            )}
            {!props.readOnly && mode === 'view' && (
              <span className="viewer-actions">
                <button className="btn-link" onClick={() => startMode('verify')}>
                  Verify
                </button>
                <button className="btn-link" onClick={() => startMode('calibrate')}>
                  Recalibrate
                </button>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="tag tag-tbc">Uncalibrated</span> Calibrate the scale before modelling
            this floor.
            {!props.readOnly && mode === 'view' && (
              <button className="btn-link viewer-actions" onClick={() => startMode('calibrate')}>
                Calibrate
              </button>
            )}
            {plan.replaced &&
              ' The plan was replaced – re-calibrate it; alignment to the previous plan follows in Floor Modelling (FR-09).'}
          </>
        )}
      </div>
    </div>
  );
}
