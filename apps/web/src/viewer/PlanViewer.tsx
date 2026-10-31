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
  orthogonal,
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

/** A placed component drawn on the plan (#TASK-12): its symbol and tag at a PDF point. */
export interface PlanMarker {
  id: string;
  tag: string;
  /** Symbol image (data URL); a plain box when missing. */
  image: string | null;
  at: PdfPoint;
  /** Symbol size, 1 = standard; changed by dragging a corner of the selected symbol. */
  scale?: number;
}

/** A cable drawn on the plan (#TASK-13): its tag and route in PDF points. */
export interface PlanCable {
  id: string;
  tag: string;
  points: PdfPoint[];
  /** A busbar feeder, drawn thicker than a cable. */
  busbar?: boolean;
}

/** Data type of a library item dragged onto the plan. */
export const LIBRARY_DRAG_TYPE = 'application/x-neuromep-item';
/** Symbol size on screen (px), and how close a click must be to hit one. */
const MARKER_PX = 32;
const HIT_PX = 20;
/** Corner handles of the selected symbol: size and grab distance (px); allowed scale range. */
const HANDLE_PX = 7;
const SCALE_MIN = 0.5;
const SCALE_MAX = 4;
const half = (m: PlanMarker) => (MARKER_PX * (m.scale ?? 1)) / 2;

/** Driven from the shared toolbar (Zoom In / Zoom Out / Reset). */
export interface ViewerControls {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}
const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Floor-plan viewer (FR-07) with two-point and drawing-scale calibration (FR-08).
 * Renders page 1 with pdf.js; wheel zooms; dragging pans (left button outside calibration, middle
 * button or Shift + right button always). Picked points are converted
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
  /** Components on this floor (#TASK-12). */
  markers?: PlanMarker[];
  selectedId?: string | null;
  /** A library item is armed: the next click on the plan places it. */
  placing?: boolean;
  /** A click while placing, or a library item dropped (itemKey). */
  onPlace?: (at: PdfPoint, itemKey?: string) => void;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, at: PdfPoint) => void;
  /** A selected component resized by a corner handle. */
  onResize?: (id: string, scale: number) => void;
  /** Cables on this floor (#TASK-13); selectable like components. */
  cables?: PlanCable[];
  /** Cable tool armed: clicks go to onCableClick instead of selecting or panning. */
  cableMode?: boolean;
  /** Route of the cable being drawn so far; a preview leg follows the pointer. */
  drawingPoints?: PdfPoint[] | null;
  onCableClick?: (at: PdfPoint, componentId: string | null) => void;
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
  const [panning, setPanning] = useState(false);
  /** A component being dragged: where it is now (PDF point), until the mouse is released. */
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragAt, setDragAt] = useState<{ id: string; at: PdfPoint } | null>(null);
  /** Corner resize of the selected component in progress, and its scale so far. */
  const [resizing, setResizing] = useState<{ id: string; scale: number } | null>(null);
  const [overHandle, setOverHandle] = useState(false);
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

  /** Calibration points: snapped, and B kept on a horizontal or vertical line from A. */
  const pickAt = (free: PdfPoint): PdfPoint => {
    const p = snapTarget(free) ?? free;
    return points.length === 1 ? orthogonal(points[0]!, p) : p;
  };

  const local = (e: ReactMouseEvent) => {
    const r = container.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const markers = props.markers ?? [];
  const cables = props.cables ?? [];
  /** Pointer position while drawing a cable (preview leg). */
  const [pointer, setPointer] = useState<PdfPoint | null>(null);
  /** The cable under a screen point (within 6 px of a leg), if any. */
  const hitCable = (s: { x: number; y: number }) =>
    page
      ? cables.find((c) =>
          c.points.slice(1).some((b, i) => {
            const a = pdfToScreen(c.points[i]!, view, page.transform);
            const q = pdfToScreen(b, view, page.transform);
            return distanceToSegment(s, a, q) <= 6;
          }),
        )
      : undefined;
  /** The component under a screen point, if any. */
  const hit = (s: { x: number; y: number }) =>
    page
      ? markers.find((m) => {
          const p = pdfToScreen(m.at, view, page.transform);
          return Math.hypot(p.x - s.x, p.y - s.y) <= Math.max(HIT_PX, half(m));
        })
      : undefined;
  /** The selected component, when a screen point is on one of its corner handles. */
  const onHandle = (s: { x: number; y: number }) => {
    const m = markers.find((x) => x.id === props.selectedId);
    if (!m || !page || !props.onResize) return undefined;
    const c = pdfToScreen(m.at, view, page.transform);
    const h = half(m) + 4;
    const near = (a: number, b: number) => Math.abs(a - b) <= HANDLE_PX;
    return (near(s.x, c.x - h) || near(s.x, c.x + h)) && (near(s.y, c.y - h) || near(s.y, c.y + h))
      ? m
      : undefined;
  };

  function onMouseDown(e: ReactMouseEvent) {
    // Outside calibration the left button places (armed item), selects / moves a component, or
    // pans the empty plan. Middle or Shift + right button always pan.
    if (e.button === 0 && !picking && page) {
      const s = local(e);
      if (props.cableMode) {
        props.onCableClick?.(screenToPdf(s, view, page.transform), hit(s)?.id ?? null);
        return;
      }
      if (props.placing) {
        props.onPlace?.(screenToPdf(s, view, page.transform));
        return;
      }
      const corner = onHandle(s);
      if (corner) {
        e.preventDefault();
        setResizing({ id: corner.id, scale: corner.scale ?? 1 });
        return;
      }
      const m = hit(s);
      const c = m ? undefined : hitCable(s);
      props.onSelect?.(m?.id ?? c?.id ?? null);
      if (c) return;
      if (m && props.onMove) {
        e.preventDefault();
        drag.current = { id: m.id, moved: false };
        return;
      }
    }
    const panStart =
      e.button === 1 || (e.button === 2 && e.shiftKey) || (e.button === 0 && !picking);
    if (panStart) {
      e.preventDefault();
      pan.current = { ...local(e), view };
      setPanning(true);
      return;
    }
    if (e.button !== 0 || !page || !picking) return;
    if (points.length >= 2) return;
    const picked = pickAt(screenToPdf(local(e), view, page.transform));
    setPoints((p) => [...p, picked]);
    setPointer(null);
  }
  function onMouseMove(e: ReactMouseEvent) {
    if ((props.drawingPoints || picking) && page) {
      setPointer(screenToPdf(local(e), view, page.transform));
    }
    if (resizing && page) {
      const m = markers.find((x) => x.id === resizing.id);
      if (!m) return;
      const c = pdfToScreen(m.at, view, page.transform);
      const p = local(e);
      const reach = Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) - 4;
      const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, (2 * reach) / MARKER_PX));
      setResizing({ id: m.id, scale: Math.round(scale * 20) / 20 });
      return;
    }
    if (!pan.current && !drag.current && page) setOverHandle(!!onHandle(local(e)));
    if (drag.current && page) {
      drag.current.moved = true;
      setDragAt({ id: drag.current.id, at: screenToPdf(local(e), view, page.transform) });
      return;
    }
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

  function endPan() {
    if (resizing) props.onResize?.(resizing.id, resizing.scale);
    setResizing(null);
    if (drag.current?.moved && dragAt) props.onMove?.(dragAt.id, dragAt.at);
    drag.current = null;
    setDragAt(null);
    pan.current = null;
    setPanning(false);
  }

  function onDrop(e: React.DragEvent) {
    const key = e.dataTransfer.getData(LIBRARY_DRAG_TYPE);
    if (!key || !page || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    e.preventDefault();
    const r = container.current!.getBoundingClientRect();
    props.onPlace?.(
      screenToPdf({ x: e.clientX - r.left, y: e.clientY - r.top }, view, page.transform),
      key,
    );
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
  // A saved calibration shows no A / B; Recalibrate picks them again.
  const shownLine =
    picking && points.length === 1 && pointer ? [points[0]!, pickAt(pointer)] : points;
  /** Length of the line being picked: metres on a calibrated plan, else millimetres on the sheet. */
  const lineLength = (() => {
    if (shownLine.length !== 2) return null;
    const [a, b] = shownLine as [PdfPoint, PdfPoint];
    if (calibration) return `${measureMetres(a, b, calibration.metresPerUnit).toFixed(2)} m`;
    return `${((Math.hypot(b.x - a.x, b.y - a.y) * 25.4) / 72).toFixed(1)} mm on the sheet`;
  })();
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
        className={`viewer-canvas${picking || props.placing || props.cableMode ? ' picking' : ''}${panning ? ' panning' : ''}${overHandle || resizing ? ' resizing' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={onDrop}
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
          <svg className="viewer-overlay" width={size.width} height={size.height}>
            {cables.map((c) => {
              const pts = c.points.map(toScreen);
              const selected = c.id === props.selectedId;
              const label = longestLegMiddle(pts);
              return (
                <g
                  key={c.id}
                  className={`plan-cable${c.busbar ? ' busbar' : ''}${selected ? ' selected' : ''}`}
                  role="img"
                  aria-label={`Cable ${c.tag}${selected ? ' (selected)' : ''}`}
                >
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
                  <text x={label.x} y={label.y - 5} textAnchor="middle" className="cable-tag">
                    {c.tag}
                  </text>
                </g>
              );
            })}
            {props.drawingPoints && props.drawingPoints.length > 0 && (
              <polyline
                className="cable-preview"
                points={[
                  ...props.drawingPoints,
                  ...(pointer ? [orthogonal(props.drawingPoints.at(-1)!, pointer)] : []),
                ]
                  .map(toScreen)
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
              />
            )}
            {markers.map((m) => {
              const s = toScreen(dragAt?.id === m.id ? dragAt.at : m.at);
              const selected = m.id === props.selectedId;
              const size = MARKER_PX * (resizing?.id === m.id ? resizing.scale : (m.scale ?? 1));
              return (
                <g
                  key={m.id}
                  className={`plan-marker${selected ? ' selected' : ''}`}
                  role="img"
                  aria-label={`${m.tag}${selected ? ' (selected)' : ''}`}
                >
                  {selected && (
                    <rect
                      x={s.x - size / 2 - 4}
                      y={s.y - size / 2 - 4}
                      width={size + 8}
                      height={size + 8}
                      rx={4}
                      className="marker-selection"
                    />
                  )}
                  {selected &&
                    props.onResize &&
                    [-1, 1].flatMap((dx) =>
                      [-1, 1].map((dy) => (
                        <rect
                          key={`${dx}${dy}`}
                          className="marker-handle"
                          x={s.x + dx * (size / 2 + 4) - HANDLE_PX / 2}
                          y={s.y + dy * (size / 2 + 4) - HANDLE_PX / 2}
                          width={HANDLE_PX}
                          height={HANDLE_PX}
                        />
                      )),
                    )}
                  {m.image ? (
                    <image
                      href={m.image}
                      x={s.x - size / 2}
                      y={s.y - size / 2}
                      width={size}
                      height={size}
                    />
                  ) : (
                    <rect
                      x={s.x - size / 2}
                      y={s.y - size / 4}
                      width={size}
                      height={size / 2}
                      className="marker-fallback"
                    />
                  )}
                  <text x={s.x} y={s.y + size / 2 + 11} textAnchor="middle" className="marker-tag">
                    {m.tag}
                  </text>
                </g>
              );
            })}
            {shownLine.length === 2 && (
              <line
                x1={toScreen(shownLine[0]!).x}
                y1={toScreen(shownLine[0]!).y}
                x2={toScreen(shownLine[1]!).x}
                y2={toScreen(shownLine[1]!).y}
                className="cal-line"
              />
            )}
            {lineLength && (
              <text
                className="cal-length"
                x={(toScreen(shownLine[0]!).x + toScreen(shownLine[1]!).x) / 2 + 6}
                y={(toScreen(shownLine[0]!).y + toScreen(shownLine[1]!).y) / 2 - 6}
              >
                {lineLength}
              </text>
            )}
            {shownLine.map((p, i) => {
              const s = toScreen(p);
              return (
                <g key={i} className="cal-point">
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
          Zoom: {Math.round(view.zoom * 100)}% · Wheel to zoom ·{' '}
          {picking ? 'Middle button or Shift + right-drag to pan' : 'Drag to pan'}
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

type ScreenPoint = { x: number; y: number };

/** Distance from a point to a line segment (screen px), for selecting cables. */
function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Middle of the longest leg of a polyline: where the cable tag is written. */
function longestLegMiddle(pts: ScreenPoint[]): ScreenPoint {
  let best = { len: -1, mid: pts[0] ?? { x: 0, y: 0 } };
  pts.slice(1).forEach((b, i) => {
    const a = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best.len) best = { len, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  });
  return best.mid;
}
