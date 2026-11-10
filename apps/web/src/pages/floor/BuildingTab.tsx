import {
  completenessIssues,
  riserBoards,
  scenarioSupply,
  suppliedIn,
  supplyBreaks,
  fireRatedFlags,
  type Scenario,
  riserOf,
  riserRows,
  riserSources,
  setBoardRiser,
  setRiser,
  sourceConnected,
  onPlanOf,
  orthogonal,
  itemOfElement,
  usuallyFeeds,
  KIND_LABELS,
  floorStatus,
  type Element,
  type Project,
  type Floor,
  type Riser,
  type Discipline,
} from '@neuromep/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { EngineReply } from '../../workspace/engineRun';
import { Modal, NumberInput } from '../../components/fields';
import { StatusMark } from '../../layout/icons';
import { useNotice } from '../../layout/Shell';
import { DemandFactorsDialog } from './DemandFactorsDialog';
import { STATUS_ICON } from './FloorStatusDialog';

/** Height between floors in the riser diagram (doubled 8 Nov 2026: 70 was congested). */
const ROW = 140;
const TOP = 40;
const RISER_X = [330, 352, 374];
const BOARD_X = 760;
const BOARD_GAP = 74;
const SOURCE_X = 16;
const SOURCE_W = 78;
const SOURCE_GAP = 92;

/** The next item after `current` in `list`, then none, then the first again (click to cycle). */
function cycle<T>(list: readonly T[], current: T | null): T | null {
  const i = current === null ? -1 : list.indexOf(current);
  return i + 1 < list.length ? list[i + 1]! : null;
}

/**
 * Building tab (Figma 3.5 - 3.8, FR-19 / FR-20): floors stacked top-down (A-13) with the risers on
 * the left. Click a riser to choose what feeds it (transformer or LV panel / MDB), click a floor
 * board to choose the riser feeding it; both are stored in the project. Building Summary with
 * floor status, Busbar Riser Design, Cable Size Calculator (enabled once a transformer feeds something; was: a riser leads back to a
 * transformer, A-07) with the riser Cost (busbar rating x 2.2 AED per riser, 3 Nov 2026),
 * Save / Cancel.
 */
type Pt = { x: number; y: number };

export function BuildingTab(props: {
  floors: Floor[];
  model: Project['model'];
  zoom: number;
  readOnly: boolean;
  onRisers: (risers: Riser[]) => void;
  /** Rename a floor (Technical Lead; user request 7 Nov 2026); absent = names read-only. */
  onRename?: (floorId: string, name: string) => void;
  onSave: () => void;
  /** Cable Size Calculator: Cable Size for the whole project (FR-21, A-07); null if it failed. */
  onCableSize: () => Promise<EngineReply | null>;
  /**
   * Feeder tool armed in the Building tab (user request 8 Nov 2026): click a component on one
   * floor, then one on another, and type the feeder's length.
   */
  feederArmed?: boolean;
  /** A new feeder between two components with the length typed; returns why it cannot be. */
  onFeeder?: (
    from: Element,
    to: Element,
    lengthM: number,
    route: { x: number; y: number }[],
  ) => string | null;
  /** Library symbols by item key (data URLs), drawn as in the Component Library (9 Nov 2026). */
  symbols?: Map<string, string>;
  /** A feeder's typed length changed, or the feeder removed (null). */
  onFeederLength?: (cableId: string, lengthM: number | null) => void;
}) {
  const notice = useNotice();
  const { model } = props;
  const risers = riserRows(model.risers);
  /** Risers as they were when the tab opened (Cancel). */
  const [opened] = useState(model.risers);
  const [sized, setSized] = useState(false);
  const [running, setRunning] = useState(false);
  const [cost, setCost] = useState<Pick<
    EngineReply,
    'risers' | 'feeders' | 'risersAed' | 'feedersAed' | 'totalAed'
  > | null>(null);
  const [dfOpen, setDfOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('normal');
  /** The riser whose source is being chosen (click a component on any floor). */
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setPicking(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);
  /** What feeds each component by a feeder (cable-fed boards are drawn greyed). */
  const cableFrom = new Map(
    model.cables.map((c) => [
      c.to.elementId,
      model.elements.find((e) => e.id === c.from.elementId)?.tag,
    ]),
  );
  /** The floor whose name is being edited, and the name typed so far. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const finishRename = () => {
    if (renaming && renaming.name.trim()) props.onRename?.(renaming.id, renaming.name);
    setRenaming(null);
  };
  const change = (next: Riser[]) => {
    props.onRisers(next);
    setSized(false);
  };

  // Top floor first, then Ground, basements at the bottom - as in the building section (A-13).
  const rows = useMemo(() => [...props.floors].reverse(), [props.floors]);
  const floorY = (i: number) => TOP + i * ROW + 40;
  const bottomY = floorY(rows.length - 1);
  const boards = rows.map((f) => riserBoards(model, f.id));
  const width = BOARD_X + Math.max(1, ...boards.map((b) => b.length)) * BOARD_GAP + 20;
  /** Where each component is drawn (left of its box, floor line), for the feeders between them. */
  const boxAt = new Map(
    boards.flatMap((list, i) =>
      list.map((b, k) => [b.id, { x: BOARD_X + k * BOARD_GAP, y: floorY(i) }] as const),
    ),
  );
  /** Centre of a component's symbol: where its feeders start and end. */
  const centreOf = (id: string): Pt | null => {
    const b = boxAt.get(id);
    return b ? { x: b.x + 16, y: b.y - 1 } : null;
  };
  const maxLen = Math.max(0, ...risers.map((r) => r.lengthM ?? 0));
  const tag = (id: string | null) => model.elements.find((e) => e.id === id)?.tag ?? null;

  /** Up to the highest floor it feeds; a riser without tap-offs in proportion to its length. */
  function riserTop(r: Riser) {
    const fed = rows.flatMap((_, i) => (boards[i]!.some((b) => r.feeds.includes(b.id)) ? [i] : []));
    if (fed.length > 0) return floorY(Math.min(...fed)) - 34;
    return r.lengthM && maxLen ? bottomY - ((bottomY - TOP + 20) * r.lengthM) / maxLen : bottomY;
  }

  /**
   * Click a riser, then the component that feeds it, on any floor (manager feedback, 7 Nov
   * 2026: the transformer, LV panels and MDBs are drawn on their floors). Clicking the riser
   * again removes its source; Escape cancels.
   */
  function chooseSource(r: Riser, n: number) {
    if (props.readOnly) return;
    if (picking === r.id) {
      setPicking(null);
      if (r.fedFromId) {
        change(setRiser(model.risers, r.id, { fedFromId: null }));
        notice(`Riser ${n} is not fed.`);
      }
      return;
    }
    if (riserSources(model).length === 0) {
      notice('Place a transformer or an LV panel / MDB in Floor Setup to feed the risers.');
      return;
    }
    setPicking(r.id);
    notice(
      `Click the component that feeds Riser ${n} - usually the transformer, an LV panel or an MDB - on any floor. Click the riser again to remove its source.`,
    );
  }

  function pickSource(board: Element) {
    const n = risers.findIndex((r) => r.id === picking) + 1;
    change(setRiser(model.risers, picking!, { fedFromId: board.id }));
    setPicking(null);
    notice(`Riser ${n} is fed from ${board.tag}.`);
  }

  function chooseRiser(board: Element) {
    if (props.readOnly) return;
    if (picking) return pickSource(board);
    if (props.feederArmed) return feederClick(board);
    const usable = risers.filter((r) => r.lengthM).map((r) => r.id);
    if (usable.length === 0) {
      notice('Enter a riser length in Busbar Riser Design first.');
      return;
    }
    change(
      setBoardRiser(model.risers, board.id, cycle(usable, riserOf(risers, board.id)?.id ?? null)),
    );
  }

  // ----- feeders between floors (user request 8 Nov 2026; path drawn by hand, 9 Nov 2026) -----
  /** Feeder being drawn: its start component and the corners so far (diagram units). */
  const [draft, setDraft] = useState<{ from: Element; points: Pt[] } | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [askLength, setAskLength] = useState<{
    from: Element;
    to: Element;
    route: Pt[];
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [lengthText, setLengthText] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  // A feeder being drawn counts only while the Feeder tool is armed.
  const drawing = props.feederArmed ? draft : null;
  const floorName = (e: Element) => props.floors.find((f) => f.id === e.floorId)?.name ?? '';
  /** Diagram point under the mouse. */
  const at = (e: ReactMouseEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / props.zoom, y: (e.clientY - r.top) / props.zoom };
  };
  // Escape cancels the feeder being drawn; Backspace removes its last corner.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setDraft(null);
      if (e.key === 'Backspace' && drawing.points.length > 1) {
        e.preventDefault();
        setDraft({ ...drawing, points: drawing.points.slice(0, -1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing]);
  function feederClick(board: Element) {
    if (board.kind === 'equipment') {
      notice(`${board.tag} is linked to its isolator through Fed from, not by a feeder.`);
      return;
    }
    if (board.kind === 'meter') {
      notice(`${board.tag} is a meter: choose what it measures in its Engineering Property.`);
      return;
    }
    const centre = centreOf(board.id);
    if (!centre) return;
    if (!drawing) {
      setDraft({ from: board, points: [centre] });
      notice(
        `Feeder from ${board.tag} (${floorName(board)}): click on the diagram to make each corner, then click the component it feeds. Escape cancels, Backspace removes the last corner.`,
      );
      return;
    }
    if (drawing.from.id === board.id) {
      setDraft(null);
      return;
    }
    // The last leg ends on the component: a corner keeps it horizontal then vertical.
    const last = drawing.points.at(-1)!;
    const corner = last.x !== centre.x && last.y !== centre.y ? [{ x: centre.x, y: last.y }] : [];
    setLengthText('');
    setAskLength({ from: drawing.from, to: board, route: [...drawing.points.slice(1), ...corner] });
  }
  /** A click on the diagram while drawing adds a corner, kept horizontal or vertical. */
  function diagramClick(e: ReactMouseEvent) {
    if (!drawing || props.readOnly) return;
    const p = orthogonal(drawing.points.at(-1)!, at(e));
    setDraft({ ...drawing, points: [...drawing.points, p] });
  }
  const finishFeeder = () => {
    if (!askLength) return;
    const problem = props.onFeeder?.(askLength.from, askLength.to, typedLength, askLength.route);
    if (problem) notice(problem);
    setAskLength(null);
    setDraft(null);
  };
  const typedLength = Number(lengthText);
  const lengthOk = lengthText.trim() !== '' && Number.isFinite(typedLength) && typedLength > 0;
  /** Feeders not drawn on a floor plan: between floors, or drawn here with a typed length. */
  const buildingFeeders = model.cables.filter((c) => {
    const from = model.elements.find((e) => e.id === c.from.elementId);
    return from && !onPlanOf(c, model.elements, from.floorId);
  });

  const symbol = (e: Element) => props.symbols?.get(itemOfElement(e)?.key ?? '') ?? null;
  const status = (f: Floor, d: Discipline) => STATUS_ICON[floorStatus(model, f.id, d)];
  const connected = sourceConnected({ ...model, risers });
  const fedRisers = risers.flatMap((r, i) => (r.lengthM && r.fedFromId ? [i] : []));
  /** One box per source, in riser order; a source with no supply of its own is marked. */
  const sources = [...new Set(fedRisers.map((i) => risers[i]!.fedFromId!))];
  const supplied = new Set([
    ...suppliedIn({ ...model, risers }, 'normal'),
    ...suppliedIn({ ...model, risers }, 'standby'),
  ]);
  const whyNotReady = connected
    ? null
    : 'Connect the transformer: draw a feeder from it on its floor plan, or here with Feeder to a component on another floor. A busbar riser is optional - if you use one, feed it from the transformer or from a board fed from it.';

  return (
    <div className="building-tab">
      <div className="building-canvas" aria-label="Building view">
        <NetworkCheck
          model={{ ...model, risers }}
          floors={props.floors}
          scenario={scenario}
          onScenario={setScenario}
        />
        <svg
          width={width * props.zoom}
          height={(bottomY + 50) * props.zoom}
          viewBox={`0 0 ${width} ${bottomY + 50}`}
          role="img"
          aria-label="Riser diagram"
          ref={svgRef}
          className={drawing ? 'drawing-feeder' : undefined}
          onClick={diagramClick}
          onMouseMove={(e) => drawing && setPointer(at(e))}
        >
          {/* Feeders between floors, under the symbols (9 Nov 2026: the path the engineer drew). */}
          {buildingFeeders.map((c, i) => {
            const a = centreOf(c.from.elementId);
            const b = centreOf(c.to.elementId);
            if (!a || !b) return null;
            const lane = BOARD_X - 12 - (i % 8) * 6;
            const pts: Pt[] = c.buildingRoute?.length
              ? [a, ...c.buildingRoute, b]
              : // Drawn before paths could be drawn: an automatic lane left of the boards.
                [
                  a,
                  { x: a.x, y: a.y - 22 },
                  { x: lane, y: a.y - 22 },
                  { x: lane, y: b.y - 22 },
                  { x: b.x, y: b.y - 22 },
                  b,
                ];
            const d = pts.map((p, k) => `${k ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
            // Label on the longest leg.
            const legs = pts.slice(1).map((p, k) => [pts[k]!, p] as const);
            const len = (l: readonly [Pt, Pt]) => Math.hypot(l[1].x - l[0].x, l[1].y - l[0].y);
            const [p, q] = legs.reduce((best, l) => (len(l) > len(best) ? l : best));
            return (
              <g
                key={c.id}
                className="building-feeder"
                role="button"
                aria-label={`Feeder ${c.tag}, ${c.manualLengthM ?? '?'} m`}
                onClick={(e) => {
                  if (props.readOnly || drawing) return;
                  e.stopPropagation();
                  setLengthText(String(c.manualLengthM ?? ''));
                  setEditing(c.id);
                }}
              >
                <path d={d} className="building-feeder-hit" />
                <path d={d} />
                <text
                  x={(p.x + q.x) / 2 - 3}
                  y={(p.y + q.y) / 2 - 3}
                  className="building-feeder-tag"
                >
                  {c.tag} · {c.manualLengthM ?? '?'} m
                </text>
              </g>
            );
          })}
          {drawing && (
            <polyline
              className="building-feeder-draft"
              points={[
                ...drawing.points,
                ...(pointer ? [orthogonal(drawing.points.at(-1)!, pointer)] : []),
              ]
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
            />
          )}
          {rows.map((f, i) => {
            const y = floorY(i);
            const onFloor = boards[i]!;
            return (
              <g key={f.id}>
                <line x1={RISER_X[2]! + 24} y1={y} x2={BOARD_X} y2={y} className="floor-line" />
                {renaming?.id === f.id ? (
                  <foreignObject
                    x={RISER_X[2]! + 30}
                    y={y - 24}
                    width={BOARD_X - RISER_X[2]! - 36}
                    height={22}
                  >
                    <input
                      className="floor-name-input"
                      aria-label={`Name of ${f.name}`}
                      value={renaming.name}
                      autoFocus
                      onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={(RISER_X[2]! + BOARD_X) / 2}
                    y={y - 5}
                    className={`floor-label${props.onRename ? ' editable' : ''}`}
                    {...(props.onRename && {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `Rename ${f.name}`,
                      onClick: () => setRenaming({ id: f.id, name: f.name }),
                      onKeyDown: (e: KeyboardEvent) =>
                        e.key === 'Enter' && setRenaming({ id: f.id, name: f.name }),
                    })}
                  >
                    {f.name}
                    {props.onRename && <title>Click to rename this floor</title>}
                  </text>
                )}
                {onFloor.length === 0 ? (
                  <g
                    className="floor-board empty"
                    role="button"
                    aria-label={`${f.name} board`}
                    onClick={() =>
                      notice(`Place a board on ${f.name} in Floor Setup to connect it.`)
                    }
                  >
                    <rect x={BOARD_X} y={y - 9} width="32" height="16" />
                    <line x1={BOARD_X} y1={y + 7} x2={BOARD_X + 32} y2={y - 9} />
                  </g>
                ) : (
                  onFloor.map((b, k) => {
                    const x = BOARD_X + k * BOARD_GAP;
                    const riser = risers.findIndex((r) => r.feeds.includes(b.id));
                    const main = usuallyFeeds(b.kind, 'busbar');
                    const byCable = cableFrom.get(b.id);
                    const source = risers.some((r) => r.fedFromId === b.id);
                    const kind = [
                      main ? 'main' : '',
                      byCable && riser < 0 ? 'cable-fed' : '',
                      source ? 'riser-source' : '',
                      picking ? 'picking' : '',
                      drawing?.from.id === b.id ? 'feeder-from' : '',
                      props.feederArmed ? 'feeding' : '',
                      b.kind === 'equipment' || b.kind === 'meter' ? 'equipment' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <g key={b.id}>
                        {riser >= 0 && (
                          <path
                            className="riser-link"
                            d={`M ${RISER_X[riser]! + 6} ${y - 28} H ${x + 16} V ${y - 8}`}
                          />
                        )}
                        <g
                          className={`floor-board ${kind}`}
                          role="button"
                          aria-label={`${b.tag} board`}
                          onClick={(e) => {
                            e.stopPropagation();
                            chooseRiser(b);
                          }}
                        >
                          <title>
                            {`${b.tag} - ${KIND_LABELS[b.kind]}${byCable ? `, fed from ${byCable} by a feeder` : ''}${riser >= 0 ? `, on Riser ${riser + 1}` : ''}${source ? ', feeds a riser' : ''}`}
                          </title>
                          {/* The whole board and its tag take the click (no gaps). */}
                          <rect
                            className="board-hit"
                            x={x - 18}
                            y={y - 19}
                            width={68}
                            height={k % 2 ? 60 : 50}
                          />
                          {/* The symbol of the Component Library (9 Nov 2026). */}
                          <rect
                            className="board-frame"
                            x={x - 1}
                            y={y - 18}
                            width="34"
                            height="34"
                            rx="4"
                          />
                          {symbol(b) ? (
                            <image href={symbol(b)!} x={x} y={y - 17} width="32" height="32" />
                          ) : (
                            <>
                              <rect x={x} y={y - 9} width="32" height="16" />
                              <line x1={x} y1={y + 7} x2={x + 32} y2={y - 9} />
                            </>
                          )}
                          {/* Alternate heights so neighbouring tags never overlap. */}
                          <text x={x + 16} y={y + (k % 2 ? 36 : 26)} className="floor-label">
                            {b.tag}
                          </text>
                        </g>
                      </g>
                    );
                  })
                )}
              </g>
            );
          })}
          {risers.map((r, idx) =>
            r.lengthM ? (
              <rect
                key={r.id}
                className={`riser${picking === r.id ? ' picking' : ''}`}
                role="button"
                x={RISER_X[idx]}
                y={riserTop(r)}
                width="9"
                height={bottomY - riserTop(r)}
                aria-label={`Riser ${idx + 1}`}
                onClick={() => chooseSource(r, idx + 1)}
              >
                <title>
                  {r.fedFromId
                    ? `Riser ${idx + 1}: fed from ${tag(r.fedFromId)} (click, then click its new source)`
                    : `Riser ${idx + 1}: no source - click it, then click what feeds it`}
                </title>
              </rect>
            ) : null,
          )}
          {risers.map((r, idx) =>
            r.lengthM ? (
              <text
                key={`label-${r.id}`}
                x={RISER_X[idx]! + 4.5}
                y={riserTop(r) - 4}
                className={`riser-label${r.fedFromId ? '' : ' unfed'}`}
              >
                R{idx + 1}
              </text>
            ) : null,
          )}
          {sources.map((id, k) => {
            const x = SOURCE_X + k * SOURCE_GAP;
            const source = model.elements.find((e) => e.id === id);
            const dead = source?.kind !== 'transformer' && !supplied.has(id);
            const label = tag(id) ?? '?';
            const fed = fedRisers.filter((i) => risers[i]!.fedFromId === id);
            return (
              <g key={id} aria-label={`Source ${label}`}>
                {fed.map((i) => (
                  <path
                    key={i}
                    className={`source-link${dead ? ' dead' : ''}`}
                    d={`M ${x + SOURCE_W / 2} ${bottomY + 16} V ${bottomY + 24 + k * 6} H ${RISER_X[i]! + 4.5} V ${bottomY}`}
                  />
                ))}
                <rect
                  x={x}
                  y={bottomY - 16}
                  width={SOURCE_W}
                  height="32"
                  rx="6"
                  className={`tx-box${dead ? ' dead' : ''}`}
                >
                  <title>
                    {dead
                      ? `${label} has no supply itself: draw a feeder to it from the transformer in Floor Setup.`
                      : `${label} feeds ${fed.map((i) => `Riser ${i + 1}`).join(', ')}`}
                  </title>
                </rect>
                <text
                  x={x + SOURCE_W / 2}
                  y={bottomY + 4}
                  className="tx-text"
                  {...(label.length > 10
                    ? { textLength: SOURCE_W - 8, lengthAdjust: 'spacingAndGlyphs' }
                    : {})}
                >
                  {label}
                </text>
                {dead && (
                  <text x={x + SOURCE_W / 2} y={bottomY - 21} className="source-warning">
                    no supply
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="building-summary" aria-label="Building Summary">
        <h2>Building Summary</h2>
        <p className="summary-count">
          <strong>Number of Floors :</strong> {props.floors.length}
          {props.floors.length > 0 && (
            <span className="muted">
              {' '}
              (
              {[
                ['basement', 'basement'],
                ['ground', 'ground'],
                ['podium', 'podium'],
                ['typical', 'upper'],
              ]
                .map(([type, label]) => [label, props.floors.filter((f) => f.type === type).length])
                .filter(([, n]) => n)
                .map(([label, n]) => `${n} ${label}`)
                .join(', ')}
              )
            </span>
          )}
        </p>
        <hr />
        <table className="summary-status">
          <thead>
            <tr>
              <th />
              <th>Elect</th>
              <th>Mech</th>
              <th>PHE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name} :</th>
                <td>
                  <StatusMark status={status(f, 'electrical')} size={16} />
                </td>
                <td>
                  <StatusMark status={status(f, 'mechanical')} size={16} />
                </td>
                <td>
                  <StatusMark status={status(f, 'phe')} size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        <h3>Busbar Riser Design</h3>
        <table className="riser-design">
          <thead>
            <tr>
              <th />
              <th>Length (m)</th>
              <th>Width (m)</th>
            </tr>
          </thead>
          <tbody>
            {risers.map((r, i) => (
              <tr key={r.id}>
                <th scope="row">Riser {i + 1}</th>
                {(['lengthM', 'widthM'] as const).map((k) => (
                  <td key={k}>
                    <NumberInput
                      className="riser-input"
                      ariaLabel={`Riser ${i + 1} ${k === 'lengthM' ? 'length' : 'width'}`}
                      value={r[k]}
                      disabled={props.readOnly}
                      onChange={(v) => {
                        if (v !== null && v <= 0) {
                          notice('Riser length and width are more than 0 m.');
                          return;
                        }
                        change(setRiser(model.risers, r.id, { [k]: v }));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className={`summary-btn${connected ? ' ready' : ''}`}
          disabled={!connected || props.readOnly || running}
          title={whyNotReady ?? undefined}
          onClick={async () => {
            setRunning(true);
            const reply = await props.onCableSize();
            setRunning(false);
            if (!reply) return;
            setCost(reply);
            setSized(true);
          }}
        >
          {running ? 'Sizing…' : 'Cable Size Calculator'}
        </button>
        {whyNotReady && !props.readOnly && <p className="summary-hint">{whyNotReady}</p>}
        {/* Cost (8 Nov 2026): busbar risers at their rating and every feeder at its breaker
            rating In, x 2.2 AED per ampere. */}
        <p
          className="summary-cost"
          title={
            cost ? [...cost.risers, ...cost.feeders].map((r) => r.detail).join('\n') : undefined
          }
        >
          <strong>Cost :</strong>{' '}
          {sized && cost ? (cost.totalAed === null ? '-' : formatAed(cost.totalAed)) : ''} AED
        </p>
        {sized && cost && (
          <p className="summary-hint" aria-label="Cost breakdown">
            Busbar risers: {cost.risersAed === null ? '-' : formatAed(cost.risersAed)} AED (
            {cost.risers.length}) · Feeders:{' '}
            {cost.feedersAed === null ? '-' : formatAed(cost.feedersAed)} AED ({cost.feeders.length}
            ) - rating (A) x 2.2 AED each
          </p>
        )}
        {sized && cost && cost.totalAed === null && (
          <div className="summary-hint" aria-label="Why there is no cost">
            <p>No total yet - every riser and feeder needs a rating:</p>
            <ul>
              {[...cost.risers, ...cost.feeders]
                .flatMap((r) => r.reasons)
                .slice(0, 12)
                .map((why) => (
                  <li key={why}>{why}</li>
                ))}
            </ul>
          </div>
        )}
        <hr />
        <div className="summary-actions">
          <button
            className={`summary-btn${sized ? ' ready' : ''}`}
            disabled={!sized}
            onClick={props.onSave}
          >
            Save
          </button>
          <button className="summary-btn" disabled={props.readOnly} onClick={() => change(opened)}>
            Cancel
          </button>
        </div>
        {sized && (
          <button className="summary-btn demand-btn" onClick={() => setDfOpen(true)}>
            Demand Factors
          </button>
        )}
        {askLength && (
          <Modal
            title="Feeder length"
            onClose={() => {
              setAskLength(null);
              setDraft(null);
            }}
            actions={
              <>
                <button
                  className="btn"
                  onClick={() => {
                    setAskLength(null);
                    setDraft(null);
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={!lengthOk} onClick={finishFeeder}>
                  Connect
                </button>
              </>
            }
          >
            <p>
              {askLength.from.tag} ({floorName(askLength.from)}) to {askLength.to.tag} (
              {floorName(askLength.to)}).
            </p>
            <label className="feeder-length">
              Total length (m) - horizontal runs and the rise between floors
              <input
                type="number"
                min={0}
                step="any"
                value={lengthText}
                autoFocus
                aria-label="Feeder length (m)"
                onChange={(e) => setLengthText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && lengthOk) finishFeeder();
                }}
              />
            </label>
            <p className="muted">
              Nothing can be measured between floors, so Cable Size uses this length as it is.
            </p>
          </Modal>
        )}
        {editing && (
          <Modal
            title={`Feeder ${model.cables.find((c) => c.id === editing)?.tag ?? ''}`}
            onClose={() => setEditing(null)}
            actions={
              <>
                <button
                  className="btn btn-danger-outline"
                  onClick={() => {
                    props.onFeederLength?.(editing, null);
                    setEditing(null);
                  }}
                >
                  Delete feeder
                </button>
                <button className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!lengthOk}
                  onClick={() => {
                    props.onFeederLength?.(editing, typedLength);
                    setEditing(null);
                  }}
                >
                  Save length
                </button>
              </>
            }
          >
            <label className="feeder-length">
              Total length (m)
              <input
                type="number"
                min={0}
                step="any"
                value={lengthText}
                autoFocus
                aria-label="Feeder length (m)"
                onChange={(e) => setLengthText(e.target.value)}
              />
            </label>
          </Modal>
        )}
        {dfOpen && (
          <DemandFactorsDialog onClose={() => setDfOpen(false)} onChanged={() => setSized(false)} />
        )}
      </aside>
    </div>
  );
}

const formatAed = (aed: number) =>
  aed.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: false });

/**
 * Network check above the riser diagram (FR-20, WBS 1.4.3): the scenario switch and, for normal
 * supply, the completeness warnings (E1801 / E1802); for standby, what the generator supplies.
 */
function NetworkCheck(props: {
  model: Parameters<typeof completenessIssues>[0];
  floors: Floor[];
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}) {
  // E1802 per floor; E1801 grouped by where the supply chain breaks, with the fix.
  const floorIssues = completenessIssues(props.model, props.floors).filter(
    (i) => i.code === 'E1802' || i.code === 'E1803',
  );
  const breaks = supplyBreaks(props.model);
  const fire = fireRatedFlags(props.model);
  const count = floorIssues.length + breaks.length + fire.length;
  const standby = scenarioSupply(props.model, 'standby');
  return (
    <section className="network-check" aria-label="Network check">
      <div className="scenario-switch" role="radiogroup" aria-label="Scenario">
        {(['normal', 'standby'] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={props.scenario === s}
            className={props.scenario === s ? 'on' : ''}
            onClick={() => props.onScenario(s)}
          >
            {s === 'normal' ? 'Normal' : 'Standby'}
          </button>
        ))}
      </div>
      {props.scenario === 'normal' ? (
        count === 0 ? (
          <p className="muted">
            Every component has a path to a source; fire-rated feeders are where needed.
          </p>
        ) : (
          <ul className="network-issues" aria-label="Network warnings">
            {breaks.map((b) => (
              <li key={b.at.kind === 'riser' ? `riser-${b.at.index}` : b.at.id}>
                <strong>E1801</strong> {b.message}
                {b.cutOff.length > 0 &&
                  ` - ${b.cutOff.length} component${b.cutOff.length === 1 ? '' : 's'} below it ${b.cutOff.length === 1 ? 'has' : 'have'} no supply: ${b.cutOff.join(', ')}`}
                .<span className="issue-fix"> {b.fix}</span>
              </li>
            ))}
            {fire.map((f) => (
              <li key={f.cableId}>
                <strong>{f.code}</strong> {f.message}.<span className="issue-fix"> {f.fix}</span>
              </li>
            ))}
            {floorIssues.map((i) => (
              <li key={`${i.code}-${i.elementId ?? i.floorId}`}>
                <strong>{i.code}</strong> {i.message}
                {i.code === 'E1802' && (
                  <span className="issue-fix">
                    {' '}
                    Click a board on that floor in this diagram to put it on a riser tap-off.
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="muted">
          On generator supply: {standby.supplied.length} of{' '}
          {standby.supplied.length + standby.notSupplied.length} components
          {standby.notSupplied.length > 0 &&
            ` - not on standby: ${standby.notSupplied.map((e) => e.tag).join(', ')}`}
          . Which loads must be on standby is open (OI-11).
        </p>
      )}
    </section>
  );
}
