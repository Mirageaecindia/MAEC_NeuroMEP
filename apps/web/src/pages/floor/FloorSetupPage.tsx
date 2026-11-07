import {
  type SizingScope,
  categoryFactorsPending,
  parseLoadSheet,
  planLoadImport,
  type LoadImportPlan,
  closeRoute,
  capacitySummary,
  loadCategoryOf,
  unlinkedEquipment,
  EQUIPMENT_FEEDERS,
  fireRatedFlags,
  type FireRatedFlag,
  loadSummaries,
  type Cable,
  type CapacitySummary,
  connectionProblem,
  drawCable,
  fedFrom,
  isOutput,
  isPlaceable,
  itemOfElement,
  orthogonal,
  portsOf,
  topologyCheck,
  unusualConnections,
  KIND_LABELS,
  sourceConnected,
  isFlagged,
  floorStatus,
  type CableConstruction,
  type ModelPoint,
  copyComponents,
  drawBuildingFeeder,
  onPlanOf,
  sheetMapping,
  resultOf,
  DisciplineSchema,
  typicalSet,
  LIBRARY_ITEMS,
  libraryItem,
  placeElement,
  planStatus,
  type Floor,
  type PdfPoint,
} from '@neuromep/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { Modal } from '../../components/fields';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar, type OpenMenuItem, type ToolKey } from '../../layout/Toolbar';
import { newAudit } from '../../workspace/formProps';
import { useCableSize } from '../../workspace/useCableSize';
import { LoadImportDialog } from './LoadImportDialog';
import { loadTemplate, readSheetRows } from './loadSheet';
import { isPdf, uploadPlanFile } from '../../workspace/planUpload';
import {
  LIBRARY_DRAG_TYPE,
  PlanViewer,
  type PlanCable,
  type PlanMarker,
  type ViewerControls,
} from '../../viewer/PlanViewer';
import { CableProperty } from './CableProperty';
import { SizingResult } from './SizingResult';
import { tooltipLines } from './tooltip';
import {
  defaultPf,
  lengthRule,
  loadingLimitPct,
  powerFactors,
} from '../../workspace/projectDefaults';
import { ConstructionDialog } from './ConstructionDialog';
import { EngineeringProperty } from './EngineeringProperty';
import { LoadTable } from './LoadTable';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { BuildingTab } from './BuildingTab';
import { FloorStatusDialog, STATUS_ICON } from './FloorStatusDialog';
import { ReplicateDialog, SelectionBar, replicate } from './SelectionTools';
import './floor.css';
import { openGuide, SECTION_OF_PAGE } from '../../guide/openGuide';

/** The last cable construction used in a project, kept in this browser (D-05). */
const constructionKey = (projectId: string) => `neuromep.construction.${projectId}`;
function loadConstruction(projectId: string): CableConstruction | null {
  try {
    const raw = localStorage.getItem(constructionKey(projectId));
    return raw ? (JSON.parse(raw) as CableConstruction) : null;
  } catch {
    return null;
  }
}
function saveConstruction(projectId: string, c: CableConstruction) {
  try {
    localStorage.setItem(constructionKey(projectId), JSON.stringify(c));
  } catch {
    /* a convenience only */
  }
}

/** Floor Setup (Figma 3.1 - 3.8): floor plan canvas, and the Building tab via the toolbar. */
export function FloorSetupPage() {
  const { editor, project, floorId } = useWorkspace();
  const api = useApi();
  const user = useUser();
  const notice = useNotice();
  const cableSize = useCableSize();
  const [params, setParams] = useSearchParams();
  const building = params.get('tab') === 'building';
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [zoom, setZoom] = useState(1);
  const [replace, setReplace] = useState<{ floor: Floor; file: File } | null>(null);
  const [uploading, setUploading] = useState(false);
  const viewer = useRef<ViewerControls>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  /** DB load upload being previewed (FR-35). */
  const [loadImport, setLoadImport] = useState<{
    fileName: string;
    plan: LoadImportPlan;
    problems: { row: number; message: string }[];
  } | null>(null);

  async function readLoadSheet(file: File) {
    try {
      const { rows, problems } = parseLoadSheet(await readSheetRows(file));
      setLoadImport({
        fileName: file.name,
        plan: planLoadImport(project.model.elements, rows),
        problems,
      });
    } catch {
      notice('This file could not be read as an Excel workbook (.xlsx).');
    }
  }

  async function downloadTemplate() {
    const dbs = project.model.elements.filter((e) => e.kind === 'db');
    const url = URL.createObjectURL(await loadTemplate(dbs));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NeuroMEP_DB_loads.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  const openMenu: OpenMenuItem[] = [
    {
      label: 'Floor plan (PDF)…',
      onSelect: () =>
        floor
          ? fileInput.current?.click()
          : notice('Set the number of floors on Import File first.'),
    },
    {
      label: 'DB loads from Excel…',
      onSelect: () => sheetInput.current?.click(),
      disabled: !editor.layers.includes('electrical'),
    },
    { label: 'Download the DB load template', onSelect: () => void downloadTemplate() },
  ];
  const floor = project.building.floors.find((f) => f.id === floorId) ?? null;

  // ----- components (#TASK-11 / #TASK-12) -----
  const [symbols, setSymbols] = useState<Map<string, string>>(new Map());
  const [armed, setArmed] = useState<string | null>(null);
  /** Selected components (several with Shift / Ctrl + click or a box), or one feeder. */
  const [selection, setSelection] = useState<string[]>([]);
  const selectedId = selection.length === 1 ? selection[0]! : null;
  const setSelectedId = (id: string | null) => setSelection(id ? [id] : []);
  /** Copied components (Ctrl + C) and how many times they were pasted on their own floor. */
  const clipboard = useRef<{ ids: string[]; floorId: string; pasted: number } | null>(null);
  const [clipCount, setClipCount] = useState(0);
  const [replicating, setReplicating] = useState(false);
  /** A plan just uploaded on a typical floor: offer it to the whole typical set. */
  const [sharePlan, setSharePlan] = useState<{
    floor: Floor;
    plan: Awaited<ReturnType<typeof uploadPlanFile>>;
    others: Floor[];
  } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  // A-08: a layer flagged done on this floor is locked until the Lead reopens it.
  const lockedLayers = floor
    ? editor.layers.filter((d) => isFlagged(project.model.floorFlags, floor.id, d))
    : [];
  const canPlace = editor.layers.includes('electrical') && !lockedLayers.includes('electrical');
  const statusLayer = editor.layers[0] ?? 'electrical';
  const calibration = floor?.plan?.calibration ?? null;
  const onFloor = floor ? project.model.elements.filter((e) => e.floorId === floor.id) : [];
  const selected = onFloor.find((e) => e.id === selectedId) ?? null;
  // Feeders drawn on this plan; feeders between floors are drawn in the Building tab.
  const floorCables = floor
    ? project.model.cables.filter((c) => onPlanOf(c, project.model.elements, floor.id))
    : [];
  const selectedCable = floorCables.find((c) => c.id === selectedId) ?? null;

  // ----- cables (#TASK-13) -----
  const [construction, setConstruction] = useState<CableConstruction | null>(() =>
    loadConstruction(project.id),
  );
  /** Construction dialog: before the cable tool, or to change a selected cable. */
  const [constructionFor, setConstructionFor] = useState<'tool' | string | null>(null);
  /** The cable being drawn: its source port and route so far (metres). */
  const [draft, setDraft] = useState<{
    from: { elementId: string; port: 'out' };
    points: ModelPoint[];
  } | null>(null);
  const length = lengthRule(project);

  function cableClick(at: PdfPoint, componentId: string | null) {
    if (!floor || !calibration || !construction) {
      notice('Calibrate the plan before drawing cables (E0701).');
      return;
    }
    const m = calibration.metresPerUnit;
    const point = { x: at.x * m, y: at.y * m };
    const target = componentId ? onFloor.find((e) => e.id === componentId) : undefined;
    if (target?.kind === 'equipment') {
      return notice(
        `${target.tag} is linked to its isolator or connection unit through Fed from in its Engineering Property, not by a feeder.`,
      );
    }
    if (!draft) {
      if (!target) return notice('Click the component the cable starts from.');
      setDraft({ from: { elementId: target.id, port: 'out' }, points: [target.position] });
      return;
    }
    if (!target) {
      setDraft({ ...draft, points: [...draft.points, orthogonal(draft.points.at(-1)!, point)] });
      return;
    }
    const source = onFloor.find((e) => e.id === draft.from.elementId)!;
    // Any component may feed any other (A-20). An ATS takes its normal input first, then standby.
    const inputs = portsOf(target).filter((p) => !isOutput(p));
    const fed = new Set(
      project.model.cables.filter((c) => c.to.elementId === target.id).map((c) => c.to.port),
    );
    const port = inputs.find((p) => !fed.has(p)) ?? inputs[0];
    const problem = port
      ? connectionProblem({ element: source, port: 'out' }, { element: target, port })
      : `${target.tag} has no incoming port.`;
    if (problem || !port) return notice(problem ?? '');
    // Only a loop is refused (E1401): Cable Size cannot calculate a circular network.
    const topology = topologyCheck(project.model, source, target, port);
    if (!topology.ok) return notice(`${topology.message} (${topology.code})`);
    const cable = drawCable({
      id: crypto.randomUUID(),
      cables: project.model.cables,
      from: { element: source, port: 'out' },
      to: { element: target, port },
      route: closeRoute(draft.points, target.position),
      floorCode: floor.code,
      construction,
    });
    editor.dispatch({ type: 'addCable', cable });
    setDraft(null);
    setArmed(null);
    setSelectedId(cable.id);
  }

  useEffect(() => {
    api.symbols().then(
      (r) =>
        setSymbols(
          new Map(
            r.symbols.map((s) => [
              s.key,
              `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`,
            ]),
          ),
        ),
      () => undefined, // components then show as plain boxes
    );
  }, [api]);

  // Delete removes the selection; Escape drops the armed item and the selection; Ctrl + C / V
  // copy and paste, Ctrl + A selects your components on the floor, R rotates 90 degrees.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select');
      if (typing || building) {
        if (e.key === 'Escape') setDraft(null);
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        setArmed(null);
        setSelectedId(null);
        setDraft(null);
      } else if (e.key === 'Backspace' && draft) {
        // While drawing, Backspace takes back the last bend.
        e.preventDefault();
        setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
        e.preventDefault();
        removeSelection();
      } else if (ctrl && e.key.toLowerCase() === 'c' && selection.length > 0) {
        e.preventDefault();
        copySelection();
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        paste();
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(mine.map((x) => x.id));
      } else if (!ctrl && e.key.toLowerCase() === 'r' && selection.length > 0) {
        e.preventDefault();
        rotateSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** The selected components of your layers (others are read-only). */
  const ownSelected = () =>
    selection.filter((id) =>
      project.model.elements.some((e) => e.id === id && editor.layers.includes(e.discipline)),
    );
  function removeSelection() {
    const isCable =
      selection.length === 1 && project.model.cables.some((c) => c.id === selection[0]);
    if (isCable) editor.dispatch({ type: 'removeCables', ids: selection });
    else editor.dispatch({ type: 'removeElements', ids: ownSelected() });
    setSelectedId(null);
  }
  function rotateSelection(to?: number) {
    const ids = ownSelected();
    if (ids.length)
      editor.dispatch({ type: 'rotateElements', ids, ...(to === undefined ? { by: 90 } : { to }) });
  }
  function copySelection() {
    const ids = ownSelected();
    if (!floor || ids.length === 0) {
      notice('Select components of your layer to copy.');
      return;
    }
    clipboard.current = { ids, floorId: floor.id, pasted: 0 };
    setClipCount(ids.length);
    notice(
      `${ids.length} component${ids.length === 1 ? '' : 's'} copied. Choose a floor and Paste (Ctrl + V).`,
    );
  }
  function paste() {
    const clip = clipboard.current;
    if (!clip || !floor) return;
    if (!calibration) {
      notice('Calibrate the plan before placing components (E0701).');
      return;
    }
    const ids = clip.ids.filter((id) => project.model.elements.some((e) => e.id === id));
    if (ids.length === 0) {
      notice('The copied components no longer exist.');
      return;
    }
    // On its own floor a paste lands 2 m further down and right each time; on another floor at
    // the same place on the sheet (its own calibration, user request 8 Nov 2026).
    const same = clip.floorId === floor.id;
    const step = same ? 2 * (clip.pasted + 1) : 0;
    const map = same
      ? null
      : sheetMapping(
          project.building.floors.find((f) => f.id === clip.floorId),
          floor,
        );
    const copy = copyComponents(project, {
      ids,
      targetFloorId: floor.id,
      offset: { x: step, y: step },
      newId: () => crypto.randomUUID(),
      ...(map && { map }),
    });
    const cables = editor.layers.includes('electrical') ? copy.cables : [];
    editor.dispatch({ type: 'pasteComponents', elements: copy.elements, cables });
    if (clip.floorId === floor.id) clip.pasted += 1;
    setSelection(copy.elements.map((e) => e.id));
    notice(
      `Pasted ${copy.elements.length} component${copy.elements.length === 1 ? '' : 's'}` +
        (cables.length ? ` and ${cables.length} feeder${cables.length === 1 ? '' : 's'}` : '') +
        ` on ${floor.name}.`,
    );
  }

  function place(at: PdfPoint, key: string | null) {
    if (!key || !floor) return;
    if (!calibration) {
      notice('Calibrate the plan before placing components (E0701).');
      return;
    }
    const item = libraryItem(key);
    if (!item || !isPlaceable(item)) return;
    const element = placeElement(item, {
      id: crypto.randomUUID(),
      floorId: floor.id,
      floorCode: floor.code,
      position: { x: at.x * calibration.metresPerUnit, y: at.y * calibration.metresPerUnit },
      taken: project.model.elements.map((e) => e.tag),
    });
    editor.dispatch({ type: 'placeElement', element });
    setSelectedId(element.id);
    setArmed(null);
  }

  /**
   * Isolator / connection unit label (manager feedback, 7 Nov 2026): rating and poles, the
   * equipment it feeds and its source. The rating is the breaker of the last Cable Size run
   * ("- A" until sized or when out of date).
   */
  function loadPointLabel(e: (typeof onFloor)[number]): string[] | undefined {
    if (e.kind !== 'isolator' && e.kind !== 'connection-unit') return undefined;
    const found = resultOf(project, e.id);
    const rating = found && !found.outOfDate ? found.result.device?.ratingA : undefined;
    const poles = e.poles === 'SP' || e.poles === 'SPN' ? 'SP' : 'TP';
    const fed = project.model.elements
      .filter((x) => x.kind === 'equipment' && x.fedFromId === e.id)
      .map((x) => x.tag);
    const what = fed.length ? fed.join(', ') : e.description;
    const source = fedFrom(e, project.model);
    return [
      `${rating ? `${rating} A` : '- A'} ${poles}${what ? ` · ${what}` : ''}`,
      ...(source ? [`from ${source}`] : []),
    ];
  }

  // Positions are stored in metres; the plan shows them through its calibration.
  const markers: PlanMarker[] = calibration
    ? onFloor.map((e) => ({
        id: e.id,
        tag: e.tag,
        image: symbols.get(itemOfElement(e)?.key ?? '') ?? null,
        scale: e.symbolScale,
        rotation: e.rotationDeg,
        detail: loadPointLabel(e),
        at: {
          x: e.position.x / calibration.metresPerUnit,
          y: e.position.y / calibration.metresPerUnit,
        },
      }))
    : [];
  const mine = onFloor.filter((e) => editor.layers.includes(e.discipline));
  const toPdf = (p: ModelPoint) =>
    calibration ? { x: p.x / calibration.metresPerUnit, y: p.y / calibration.metresPerUnit } : p;
  const planCables: PlanCable[] = calibration
    ? [
        ...floorCables.map((c) => ({
          id: c.id,
          tag: c.tag,
          points: c.route.map(toPdf),
          busbar: c.feederType === 'busbar',
        })),
        // Equipment to the isolator it is fed from, when both are on this floor (dashed).
        ...onFloor.flatMap((e) => {
          const to = e.kind === 'equipment' && onFloor.find((x) => x.id === e.fedFromId);
          return to
            ? [
                {
                  id: `link-${e.id}`,
                  tag: `${e.tag} - ${to.tag}`,
                  points: [e.position, to.position].map(toPdf),
                  link: true,
                },
              ]
            : [];
        }),
      ]
    : [];

  async function upload(target: Floor, file: File) {
    setUploading(true);
    try {
      const plan = await uploadPlanFile(api, project.id, file, user.id);
      // A typical floor: the other typical floors (not flagged done) may take the same plan.
      const set = typicalSet(project.building);
      const others = set.filter(
        (f) =>
          f.id !== target.id &&
          !DisciplineSchema.options.some((d) => isFlagged(project.model.floorFlags, f.id, d)),
      );
      if (set.some((f) => f.id === target.id) && others.length > 0) {
        setSharePlan({ floor: target, plan, others });
      } else {
        editor.dispatch({
          type: 'planUploaded',
          floorId: target.id,
          plan,
          now: new Date().toISOString(),
        });
      }
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function chosen(file: File | undefined) {
    if (!file || !floor) return;
    if (!isPdf(file)) {
      notice('Only PDF files can be uploaded (E0602).');
      return;
    }
    if (floor.plan) setReplace({ floor, file });
    else void upload(floor, file);
  }

  const zoomBy = (f: number) => setZoom((z) => Math.min(4, Math.max(0.25, z * f)));
  const toolbar = useProjectToolbar('floor', {
    open: () =>
      floor ? fileInput.current?.click() : notice('Set the number of floors on Import File first.'),
    zoomIn: () => (building ? zoomBy(1.25) : viewer.current?.zoomIn()),
    zoomOut: () => (building ? zoomBy(1 / 1.25) : viewer.current?.zoomOut()),
    reset: () => (building ? setZoom(1) : viewer.current?.fit()),
    building: () => setParams(building ? {} : { tab: 'building' }),
    guide: () => openGuide(building ? SECTION_OF_PAGE.building : SECTION_OF_PAGE.floor),
    status: () =>
      floor ? setStatusOpen(true) : notice('Set the number of floors on Import File first.'),
    clear: () =>
      mine.length > 0
        ? setClearing(true)
        : notice('There is nothing of yours to clear on this floor.'),
  });

  const all: ToolKey[] = [
    'open',
    'save',
    'clear',
    'undo',
    'redo',
    'zoomIn',
    'zoomOut',
    'reset',
    'bot',
    'smartAi',
    'building',
    'sync',
    'status',
    'back',
    'next',
    'guide',
  ];
  const enabled = all.filter(
    (k) =>
      // Plans and the model: the Technical Lead and the engineers of the project (Section 2).
      !(!editor.canEdit && (k === 'open' || k === 'save' || k === 'clear')) &&
      !(k === 'open' && uploading) &&
      !(k === 'undo' && !editor.canUndo) &&
      !(k === 'redo' && !editor.canRedo),
  );

  return (
    <Shell
      tab="floor"
      projectId={project.id}
      sidebar={
        <div className={building ? 'library building' : 'library'} aria-label="Component Library">
          <p className="sidebar-title">Component Library</p>
          <DisciplineTabs value={tab} onChange={setTab} disabled={building} />
          <div className="library-chips">
            {LIBRARY_ITEMS.filter((i) => tab === 'All' || i.discipline === tab.toLowerCase()).map(
              (item) => (
                <button
                  key={item.key}
                  className={`lib-chip${armed === item.key ? ' armed' : ''}`}
                  // The Building tab keeps only the Feeder: between floors (8 Nov 2026).
                  disabled={(building && item.key !== 'cable') || !canPlace}
                  aria-pressed={armed === item.key}
                  draggable={!building && canPlace && isPlaceable(item)}
                  title={
                    isPlaceable(item)
                      ? `${item.label} (${item.cmpCode ?? 'no CMP code yet'}, draft symbol): drag onto the plan, or click it and then click the plan`
                      : 'Draw a feeder (cable or busbar) between two components'
                  }
                  onDragStart={(e) => {
                    e.dataTransfer.setData(LIBRARY_DRAG_TYPE, item.key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => {
                    setDraft(null);
                    if (isPlaceable(item)) setArmed((k) => (k === item.key ? null : item.key));
                    else if (armed === 'cable') setArmed(null);
                    else if (construction) {
                      setArmed('cable');
                      if (building) {
                        notice(
                          'Click the component the feeder starts from, then the one it feeds - on any floor.',
                        );
                      }
                    } else setConstructionFor('tool');
                  }}
                >
                  <span className="lib-icon" aria-hidden>
                    {symbols.get(item.key) ? (
                      <img src={symbols.get(item.key)} alt="" draggable={false} />
                    ) : item.key === 'cable' ? (
                      <svg viewBox="0 0 24 24">
                        <path d="M3 18h7V6h11" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="lib-label">{item.label}</span>
                </button>
              ),
            )}
            {tab !== 'All' && tab !== 'Electrical' && (
              <p className="muted">No {tab.toLowerCase()} components yet.</p>
            )}
          </div>
        </div>
      }
      toolbar={
        <Toolbar
          {...toolbar}
          enabled={enabled}
          openMenu={openMenu}
          pressed={building ? ['building'] : []}
          hidden={building ? ['status'] : []}
          statusIcon={
            floor ? STATUS_ICON[floorStatus(project.model, floor.id, statusLayer)] : undefined
          }
        />
      }
    >
      <SaveBanner />
      {!building && floor && lockedLayers.length > 0 && (
        <div className="banner banner-info" role="status">
          {floor.name} is flagged done for {lockedLayers.join(', ')} and locked (E1003). Only the
          Technical Lead can reopen it.
        </div>
      )}
      {building ? (
        <BuildingTab
          floors={project.building.floors}
          model={project.model}
          zoom={zoom}
          readOnly={!editor.layers.includes('electrical')}
          onRisers={(risers) => editor.dispatch({ type: 'risers', risers })}
          onRename={
            editor.readOnly
              ? undefined
              : (floorId, name) => editor.dispatch({ type: 'renameFloor', floorId, name })
          }
          onSave={() => void editor.save()}
          feederArmed={armed === 'cable'}
          onFeeder={(from, to, lengthM) => {
            if (!construction)
              return 'Choose the cable construction first (Feeder in the library).';
            const topology = topologyCheck(project.model, from, to);
            if (!topology.ok) return `${topology.message} (${topology.code})`;
            const sourceFloor = project.building.floors.find((f) => f.id === from.floorId);
            const cable = drawBuildingFeeder({
              id: crypto.randomUUID(),
              cables: project.model.cables,
              from,
              to,
              lengthM,
              floorCode: sourceFloor?.code ?? '',
              construction,
            });
            editor.dispatch({ type: 'addCable', cable });
            setArmed(null);
            notice(`Feeder ${cable.tag} from ${from.tag} to ${to.tag}, ${lengthM} m.`);
            return null;
          }}
          onFeederLength={(id, lengthM) =>
            editor.dispatch(
              lengthM === null
                ? { type: 'removeCables', ids: [id] }
                : { type: 'updateCable', id, patch: { manualLengthM: lengthM } },
            )
          }
          onCableSize={() =>
            cableSize.run({ kind: 'project' }, 'the whole project').then((r) => r?.reply ?? null)
          }
        />
      ) : (
        <div className="floor-layout">
          <section className="panel floor-canvas" aria-label="Floor view">
            {!floor ? (
              <p className="canvas-empty muted">
                Set the number of floors on Import File to start.
              </p>
            ) : floor.plan ? (
              <>
                <SelectionBar
                  count={selection.filter((id) => onFloor.some((e) => e.id === id)).length}
                  clipboard={clipCount}
                  canEdit={editor.layers.length > 0}
                  onRotate={() => rotateSelection()}
                  onCopy={copySelection}
                  onPaste={paste}
                  onDelete={removeSelection}
                  onReplicate={() =>
                    mine.length > 0
                      ? setReplicating(true)
                      : notice(
                          `There are no components of your layer on ${floor.name} to replicate.`,
                        )
                  }
                />
                <PlanViewer
                  key={`${floor.id}:${floor.plan.fileId}`}
                  controls={viewer}
                  projectId={project.id}
                  plan={floor.plan}
                  floorLabel={floor.name}
                  readOnly={!editor.canEdit || lockedLayers.includes('electrical')}
                  userId={user.id}
                  onCalibration={(calibration) =>
                    editor.dispatch({ type: 'calibration', floorId: floor.id, calibration })
                  }
                  markers={markers}
                  selectedId={selectedId}
                  selectedIds={selection}
                  onSelectBox={(ids) => setSelection([...new Set([...selection, ...ids])])}
                  onMoveGroup={(ids, delta) => {
                    if (!calibration) return;
                    const m = calibration.metresPerUnit;
                    const own = ids.filter((id) =>
                      project.model.elements.some(
                        (e) => e.id === id && editor.layers.includes(e.discipline),
                      ),
                    );
                    editor.dispatch({
                      type: 'moveElements',
                      ids: own,
                      delta: { x: delta.x * m, y: delta.y * m },
                    });
                  }}
                  placing={armed !== null && armed !== 'cable'}
                  cables={planCables}
                  cableMode={armed === 'cable'}
                  drawingPoints={draft ? draft.points.map(toPdf) : null}
                  onCableClick={cableClick}
                  onPlace={(at, key) => (canPlace ? place(at, key ?? armed) : undefined)}
                  onSelect={(id, add) => {
                    const isCable = !!id && project.model.cables.some((c) => c.id === id);
                    if (!add || !id || isCable) return setSelectedId(id);
                    const onlyComponents = selection.filter(
                      (x) => !project.model.cables.some((c) => c.id === x),
                    );
                    setSelection(
                      onlyComponents.includes(id)
                        ? onlyComponents.filter((x) => x !== id)
                        : [...onlyComponents, id],
                    );
                  }}
                  tooltip={(id) =>
                    tooltipLines(
                      project,
                      loadSummaries(project, powerFactors(project)),
                      length ?? { allowancePct: 0, additionM: null },
                      id,
                    )
                  }
                  onRotate={(id, deg) =>
                    editor.dispatch({ type: 'rotateElements', ids: [id], to: deg })
                  }
                  onResize={(id, symbolScale) =>
                    editor.dispatch({ type: 'updateElement', id, patch: { symbolScale } })
                  }
                  onMove={(id, at) => {
                    if (!calibration) return;
                    const m = calibration.metresPerUnit;
                    editor.dispatch({
                      type: 'moveElement',
                      id,
                      position: { x: at.x * m, y: at.y * m },
                    });
                  }}
                />
              </>
            ) : (
              <p className="canvas-empty muted">
                No plan for {floor.name} yet. Use <strong>Open</strong> to upload its PDF (one page,
                up to 20 MB).
              </p>
            )}
          </section>
          <RightPanel
            floor={floor}
            selectedId={selectedId}
            property={
              selectedCable ? (
                <CableProperty
                  key={`${selectedCable.id}:${selectedCable.version}`}
                  cable={selectedCable}
                  elements={project.model.elements}
                  length={length}
                  editable={editor.layers.includes('electrical')}
                  takenTags={project.model.cables
                    .filter((c) => c.id !== selectedCable.id)
                    .map((c) => c.tag)}
                  onChange={(patch) =>
                    editor.dispatch({ type: 'updateCable', id: selectedCable.id, patch })
                  }
                  onEditConstruction={() => setConstructionFor(selectedCable.id)}
                  onDelete={() => {
                    editor.dispatch({ type: 'removeCables', ids: [selectedCable.id] });
                    setSelectedId(null);
                  }}
                />
              ) : (
                selected && (
                  <EngineeringProperty
                    key={`${selected.id}:${selected.version}`}
                    element={selected}
                    editable={editor.layers.includes(selected.discipline)}
                    takenTags={project.model.elements
                      .filter((e) => e.id !== selected.id)
                      .map((e) => e.tag)}
                    onChange={(patch) =>
                      editor.dispatch({ type: 'updateElement', id: selected.id, patch })
                    }
                    fedFrom={fedFrom(selected, project.model)}
                    connectionNotes={unusualConnections(project.model, selected)}
                    onChangeKind={(kind) => {
                      editor.dispatch({ type: 'changeKind', id: selected.id, kind });
                      notice(
                        `${selected.tag} is now ${/^[AEIOU]/.test(KIND_LABELS[kind]) ? 'an' : 'a'} ${KIND_LABELS[kind]}; its feeders and loads are kept.`,
                      );
                    }}
                    flsEquipment={
                      'loadCategory' in selected &&
                      selected.loadCategory !== 'fls' &&
                      loadCategoryOf(selected, project.model.elements) === 'fls'
                        ? project.model.elements
                            .filter(
                              (e) => e.kind === 'equipment' && e.fedFromId === selected.id && e.fls,
                            )
                            .map((e) => e.tag)
                        : []
                    }
                    feeders={project.model.elements
                      .filter((e) => EQUIPMENT_FEEDERS.includes(e.kind))
                      .map((e) => ({ id: e.id, tag: e.tag }))
                      .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }))}
                    onDelete={() => {
                      editor.dispatch({ type: 'removeElements', ids: [selected.id] });
                      setSelectedId(null);
                    }}
                  />
                )
              )
            }
          />
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Floor plan PDF"
        onChange={(e) => {
          chosen(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {constructionFor && (
        <ConstructionDialog
          title={constructionFor === 'tool' ? 'Cable construction' : 'Change cable construction'}
          initial={
            constructionFor === 'tool'
              ? construction
              : (project.model.cables.find((c) => c.id === constructionFor)?.construction ??
                construction)
          }
          onCancel={() => setConstructionFor(null)}
          onConfirm={(c) => {
            if (constructionFor === 'tool') {
              setConstruction(c);
              saveConstruction(project.id, c);
              setArmed('cable');
            } else {
              editor.dispatch({
                type: 'updateCable',
                id: constructionFor,
                patch: { construction: c },
              });
            }
            setConstructionFor(null);
          }}
        />
      )}
      <input
        ref={sheetInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        aria-label="DB load sheet"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void readLoadSheet(file);
        }}
      />
      {loadImport && (
        <LoadImportDialog
          fileName={loadImport.fileName}
          plan={loadImport.plan}
          problems={loadImport.problems}
          onCancel={() => setLoadImport(null)}
          onImport={() => {
            const changes = loadImport.plan.matched
              .filter((m) => m.changed)
              .map((m) => ({
                id: m.element.id,
                tag: m.element.tag,
                loads: m.lines,
                beforeKw: m.beforeKw,
                afterKw: m.afterKw,
              }));
            editor.dispatch({ type: 'loadImport', changes, audit: newAudit(user) });
            notice(`Loads of ${changes.length} DB${changes.length === 1 ? '' : 's'} imported.`);
            setLoadImport(null);
          }}
        />
      )}
      {statusOpen && floor && (
        <FloorStatusDialog
          floor={floor}
          project={project}
          layers={editor.layers}
          isLead={user.role === 'TECHNICAL_LEAD'}
          onFlag={(discipline) => {
            const flag = { by: user.id, at: new Date().toISOString() };
            editor.dispatch({ type: 'floorFlag', floorId: floor.id, discipline, flag });
            void editor.save(); // flagged = saved and locked (A-08)
            notice(`${floor.name} flagged done for ${discipline}.`);
          }}
          onReopen={(discipline) => {
            editor.dispatch({ type: 'floorFlag', floorId: floor.id, discipline, flag: null });
            notice(`${floor.name} reopened for ${discipline}.`);
          }}
          onClose={() => setStatusOpen(false)}
        />
      )}
      {replicating && floor && (
        <ReplicateDialog
          project={project}
          source={floor}
          layers={editor.layers}
          onCancel={() => setReplicating(false)}
          onConfirm={(targets) => {
            const plan = replicate(project, floor, editor.layers, targets, () =>
              crypto.randomUUID(),
            );
            const cables = editor.layers.includes('electrical') ? plan.cables : [];
            editor.dispatch({
              type: 'pasteComponents',
              elements: plan.elements,
              cables,
              replaceIds: plan.replaceIds,
            });
            setReplicating(false);
            notice(
              `${floor.name} replicated to ${plan.floors} floor${plan.floors === 1 ? '' : 's'}: ` +
                `${plan.elements.length} components, ${cables.length} feeders.`,
            );
          }}
        />
      )}
      {sharePlan && (
        <Modal
          title="Use this plan for all typical floors?"
          onClose={() => setSharePlan(null)}
          actions={
            <>
              <button
                className="btn"
                onClick={() => {
                  editor.dispatch({
                    type: 'planUploaded',
                    floorId: sharePlan.floor.id,
                    plan: sharePlan.plan,
                    now: new Date().toISOString(),
                  });
                  setSharePlan(null);
                }}
              >
                {sharePlan.floor.name} only
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  editor.dispatch({
                    type: 'planUploaded',
                    floorId: sharePlan.floor.id,
                    plan: sharePlan.plan,
                    now: new Date().toISOString(),
                    alsoFloorIds: sharePlan.others.map((f) => f.id),
                  });
                  notice(
                    `The plan is used on ${sharePlan.others.length + 1} typical floors. Calibrate it once; the calibration applies to all of them.`,
                  );
                  setSharePlan(null);
                }}
              >
                All {sharePlan.others.length + 1} typical floors
              </button>
            </>
          }
        >
          <p>
            {sharePlan.floor.name} is a typical floor. Typical floors are identical, so the same
            plan can be used for {sharePlan.others.map((f) => f.name).join(', ')} as well. Plans
            already on those floors are replaced. Mechanical floors keep their own plan.
          </p>
        </Modal>
      )}
      {clearing && floor && (
        <Modal
          title={`Clear ${floor.name}?`}
          onClose={() => setClearing(false)}
          actions={
            <>
              <button className="btn" onClick={() => setClearing(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger-outline"
                onClick={() => {
                  editor.dispatch({ type: 'removeElements', ids: mine.map((e) => e.id) });
                  setSelectedId(null);
                  setClearing(false);
                }}
              >
                Clear {mine.length} component{mine.length === 1 ? '' : 's'}
              </button>
            </>
          }
        >
          <p>
            This removes the {mine.length} component{mine.length === 1 ? '' : 's'} of your
            discipline on {floor.name}, with their cables. The plan and its calibration stay.
          </p>
        </Modal>
      )}
      {replace && (
        <Modal
          title={`Replace the plan of ${replace.floor.name}?`}
          onClose={() => setReplace(null)}
          actions={
            <>
              <button className="btn" onClick={() => setReplace(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void upload(replace.floor, replace.file);
                  setReplace(null);
                }}
              >
                Replace plan
              </button>
            </>
          }
        >
          <p>
            {replace.file.name} replaces {replace.floor.plan?.fileName}. The floor must be
            calibrated again; components placed on it are kept (FR-09).
          </p>
        </Modal>
      )}
    </Shell>
  );
}

/**
 * Each transformer's maximum demand against its rating x the loading limit (E2801) and the whole
 * project's against the plot allocation (E2802) - briefing page 9, design doc 10.15.
 */
function CapacityChecks({ capacity }: { capacity: CapacitySummary }) {
  const { transformers, plot, limitPct } = capacity;
  if (transformers.length === 0 && !plot?.over) return null;
  return (
    <ul className="capacity-checks" aria-label="Transformer loading">
      {transformers.map((t) => (
        <li key={t.id} className={t.over ? 'over' : undefined}>
          {t.over && <strong>E2801 </strong>}
          {t.tag}:{' '}
          {t.ratingKva === null
            ? 'enter its kVA rating'
            : `${Math.round(t.demandKva ?? 0)} of ${t.ratingKva} kVA (${Math.round(t.loadedPct ?? 0)} %)`}
          {t.over && ` - above the ${limitPct} % limit (${Math.round(t.limitKva!)} kVA)`}
        </li>
      ))}
      {plot?.over && (
        <li className="over">
          <strong>E2802 </strong>Project demand {Math.round(plot.demand)} {plot.unit} is above the
          plot allocation of {plot.allocation} {plot.unit}
        </li>
      )}
    </ul>
  );
}

/** Equipment not connected to a panel (E1803, briefing page 9): live, per floor or selection. */
function UnlinkedEquipment({ items }: { items: { id: string; tag: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="capacity-checks fire-checks" aria-label="Equipment not connected">
      {items.map((e) => (
        <li key={e.id} className="over">
          <strong>E1803 </strong>
          {e.tag} is not connected to a panel: choose its isolator or connection unit in Fed from.
        </li>
      ))}
    </ul>
  );
}

/** Fire-rated feeder flags (E2701 / E2702, briefing page 9): live, the cable is never changed. */
function FireRatedChecks({ flags }: { flags: FireRatedFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="capacity-checks fire-checks" aria-label="Fire-rated feeders">
      {flags.map((f) => (
        <li key={f.cableId} className="over">
          <strong>{f.code} </strong>
          {f.message}. {f.fix}
        </li>
      ))}
    </ul>
  );
}

/** Right panel (Figma 3.1 - 3.3): transformer capacity and connected load; Cable Size (A-07). */
function RightPanel(props: {
  floor: Floor | null;
  selectedId: string | null;
  property: ReactNode;
}) {
  const { project, editor } = useWorkspace();
  const cableSize = useCableSize();
  // Live loads (FR-18, 10.2 step 2 only) and transformer loading / plot allocation (10.15).
  const summaries = loadSummaries(project, powerFactors(project));
  const capacity = capacitySummary(project, summaries, {
    limitPct: loadingLimitPct(project),
    defaultPf: defaultPf(project),
  });
  const loaded = Math.round(capacity.loadedPct ?? 0);
  const warn =
    capacity.transformers.some((t) => t.over) ||
    !!capacity.plot?.over ||
    loaded > capacity.limitPct;

  // The table: below the selected board, else the components of this floor.
  const selected = project.model.elements.find((e) => e.id === props.selectedId);
  const below = (id: string): string[] =>
    project.model.cables
      .filter((c) => c.from.elementId === id)
      .flatMap((c) => [c.to.elementId, ...below(c.to.elementId)]);
  const scope =
    selected &&
    summaries.get(selected.id)!.connectedKw > 0 &&
    project.model.cables.some((c) => c.from.elementId === selected.id)
      ? {
          title: `LOAD TABLE - below ${selected.tag}`,
          ids: new Set([selected.id, ...below(selected.id)]),
          tops: [selected],
        }
      : props.floor
        ? (() => {
            const onFloor = project.model.elements.filter((e) => e.floorId === props.floor!.id);
            const ids = new Set(onFloor.map((e) => e.id));
            const fedOnFloor = new Set(
              project.model.cables
                .filter((c) => ids.has(c.from.elementId))
                .map((c) => c.to.elementId),
            );
            return {
              title: `LOAD TABLE - ${props.floor!.name}`,
              ids,
              tops: onFloor.filter((e) => !fedOnFloor.has(e.id)),
            };
          })()
        : null;
  const rows = scope
    ? project.model.elements
        .filter((e) => scope.ids.has(e.id))
        .map((element) => ({ element, summary: summaries.get(element.id)! }))
        .filter((r) => r.summary.connectedKw > 0)
    : [];
  const tops = scope ? scope.tops.map((e) => summaries.get(e.id)!) : [];
  const fedFromSource = sourceConnected(project.model);
  const floorOf = new Map(project.model.elements.map((e) => [e.id, e.floorId]));
  const onFloor = (c: Cable) =>
    !!props.floor &&
    [c.from.elementId, c.to.elementId].some((id) => floorOf.get(id) === props.floor!.id);
  // Cable Size scope (FR-21, decision 1 Nov 2026): the selected component or feeder, else the floor.
  const selectedItem =
    selected ?? project.model.cables.find((c) => c.id === props.selectedId) ?? null;
  const sizingScope: SizingScope | null = selectedItem
    ? { kind: 'element', id: selectedItem.id }
    : props.floor
      ? { kind: 'floor', floorId: props.floor.id }
      : null;
  const scopeName = selectedItem?.tag ?? props.floor?.name;
  const canSize =
    fedFromSource &&
    sizingScope !== null &&
    editor.layers.includes('electrical') &&
    !cableSize.running;
  return (
    <aside className="panel right-panel" aria-label="Right panel">
      <div className="capacity">
        <div className="capacity-head">
          <strong>TRANSFORMER CAPACITY &amp; CONNECTED LOAD SCHEDULE</strong>
          <span
            className={`loaded-badge${warn ? ' over' : ''}`}
            title="Maximum demand / installed transformer kVA (10.15)"
          >
            {loaded}%<small>Loaded</small>
          </span>
        </div>
        <div className="capacity-values">
          <span>
            Connected: <strong>{Math.round(capacity.connectedKva)} kVA</strong>
          </span>
          <span>
            Demand: <strong>{Math.round(capacity.demandKva)} kVA</strong>
          </span>
          <span
            title={`Installed transformer kVA x loading limit ${capacity.limitPct} % - the transformers' capacity, not a load`}
          >
            Allowable:{' '}
            <strong>
              {capacity.allowableKva === null ? '-' : `${Math.round(capacity.allowableKva)} kVA`}
            </strong>
          </span>
        </div>
        {capacity.notConnected.count > 0 && (
          <p className="capacity-note">
            Not connected yet: {Math.round(capacity.notConnected.kva)} kVA on{' '}
            {capacity.notConnected.count} component
            {capacity.notConnected.count === 1 ? '' : 's'} with no supply - not in Connected or
            Loaded.
          </p>
        )}
        <CapacityChecks capacity={capacity} />
      </div>
      <div className="right-body">
        {props.floor && props.floor.plan && planStatus(props.floor) !== 'Calibrated' && (
          <p className="field-hint">Calibrate the plan before placing components (E0701).</p>
        )}
        {props.property}
        <UnlinkedEquipment
          items={unlinkedEquipment(project.model).filter((e) =>
            selectedItem ? e.id === selectedItem.id : e.floorId === props.floor?.id,
          )}
        />
        <FireRatedChecks
          flags={fireRatedFlags(project.model).filter((f) =>
            selectedItem
              ? f.cableId === selectedItem.id
              : onFloor(project.model.cables.find((c) => c.id === f.cableId)!),
          )}
        />
        {selectedItem && <SizingResult project={project} id={selectedItem.id} />}
        {scope && (
          <LoadTable
            title={scope.title}
            rows={rows}
            total={{
              connectedKw: tops.reduce((s, x) => s + x.connectedKw, 0),
              maxDemandKw: tops.reduce((s, x) => s + x.maxDemandKw, 0),
            }}
            tbcFactors={rows.some((r) => r.summary.tbcFactors.length > 0)}
            categoriesPending={categoryFactorsPending(project)}
          />
        )}
      </div>
      <button
        className="btn btn-primary cable-size"
        aria-label={scopeName ? `Cable Size ${scopeName}` : 'Cable Size'}
        disabled={!canSize}
        title={
          fedFromSource
            ? `Size ${scopeName ?? ''}`
            : 'Connect the transformer to the risers in the Building tab first (A-07)'
        }
        onClick={() => {
          if (sizingScope) void cableSize.run(sizingScope, scopeName ?? 'the floor');
        }}
      >
        {cableSize.running ? 'Sizing…' : 'Cable Size'}
        {scopeName && <small className="cable-size-scope">{scopeName}</small>}
      </button>
    </aside>
  );
}
