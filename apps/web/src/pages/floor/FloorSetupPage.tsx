import {
  closeRoute,
  connectionProblem,
  drawCable,
  fedFrom,
  isOutput,
  isPlaceable,
  itemOfElement,
  orthogonal,
  portsOf,
  type CableConstruction,
  type ModelPoint,
  LIBRARY_ITEMS,
  libraryItem,
  placeElement,
  planStatus,
  type Floor,
  type PdfPoint,
} from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { Modal } from '../../components/fields';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar, type ToolKey } from '../../layout/Toolbar';
import { readFirstPageSize } from '../../viewer/pdf';
import {
  LIBRARY_DRAG_TYPE,
  PlanViewer,
  type PlanCable,
  type PlanMarker,
  type ViewerControls,
} from '../../viewer/PlanViewer';
import { CableProperty } from './CableProperty';
import { ConstructionDialog } from './ConstructionDialog';
import { EngineeringProperty } from './EngineeringProperty';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { BuildingTab } from './BuildingTab';
import './floor.css';

const MAX_PLAN_BYTES = 20 * 1024 * 1024; // A-02

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
  const [params, setParams] = useSearchParams();
  const building = params.get('tab') === 'building';
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [zoom, setZoom] = useState(1);
  const [replace, setReplace] = useState<{ floor: Floor; file: File } | null>(null);
  const [uploading, setUploading] = useState(false);
  const viewer = useRef<ViewerControls>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const floor = project.building.floors.find((f) => f.id === floorId) ?? null;

  // ----- components (#TASK-11 / #TASK-12) -----
  const [symbols, setSymbols] = useState<Map<string, string>>(new Map());
  const [armed, setArmed] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const canPlace = editor.layers.includes('electrical');
  const calibration = floor?.plan?.calibration ?? null;
  const onFloor = floor ? project.model.elements.filter((e) => e.floorId === floor.id) : [];
  const selected = onFloor.find((e) => e.id === selectedId) ?? null;
  const floorCables = floor ? project.model.cables.filter((c) => c.floorId === floor.id) : [];
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
  const allowance = lengthAllowance(project);

  function cableClick(at: PdfPoint, componentId: string | null) {
    if (!floor || !calibration || !construction) {
      notice('Calibrate the plan before drawing cables (E0701).');
      return;
    }
    const m = calibration.metresPerUnit;
    const point = { x: at.x * m, y: at.y * m };
    const target = componentId ? onFloor.find((e) => e.id === componentId) : undefined;
    if (!draft) {
      if (!target) return notice('Click the component the cable starts from.');
      if (!portsOf(target).some(isOutput)) {
        return notice(`${target.tag} has no outgoing way: start from the board that feeds.`);
      }
      setDraft({ from: { elementId: target.id, port: 'out' }, points: [target.position] });
      return;
    }
    if (!target) {
      setDraft({ ...draft, points: [...draft.points, orthogonal(draft.points.at(-1)!, point)] });
      return;
    }
    const source = onFloor.find((e) => e.id === draft.from.elementId)!;
    // An ATS takes its normal input first, then standby.
    const inputs = portsOf(target).filter((p) => !isOutput(p));
    const fed = new Set(
      project.model.cables.filter((c) => c.to.elementId === target.id).map((c) => c.to.port),
    );
    const port = inputs.find((p) => !fed.has(p)) ?? inputs[0];
    const problem = port
      ? connectionProblem({ element: source, port: 'out' }, { element: target, port })
      : `${target.tag} has no incoming port.`;
    if (problem || !port) return notice(problem ?? '');
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

  // Delete removes the selected component; Escape drops the armed item and the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select');
      if (e.key === 'Escape') {
        setArmed(null);
        setSelectedId(null);
        setDraft(null);
      } else if (e.key === 'Backspace' && draft && !typing) {
        // While drawing, Backspace takes back the last bend.
        e.preventDefault();
        setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        e.preventDefault();
        const isCable = project.model.cables.some((c) => c.id === selectedId);
        editor.dispatch(
          isCable
            ? { type: 'removeCables', ids: [selectedId] }
            : { type: 'removeElements', ids: [selectedId] },
        );
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, selectedId, draft, project.model.cables]);

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

  // Positions are stored in metres; the plan shows them through its calibration.
  const markers: PlanMarker[] = calibration
    ? onFloor.map((e) => ({
        id: e.id,
        tag: e.tag,
        image: symbols.get(itemOfElement(e)?.key ?? '') ?? null,
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
    ? floorCables.map((c) => ({ id: c.id, tag: c.tag, points: c.route.map(toPdf) }))
    : [];

  async function upload(target: Floor, file: File) {
    setUploading(true);
    try {
      if (file.size > MAX_PLAN_BYTES) throw new Error('The plan is larger than 20 MB (E0603).');
      let info;
      try {
        info = await readFirstPageSize(file);
      } catch {
        throw new Error('Floor plan could not be opened (E0601).');
      }
      if (info.pages !== 1) throw new Error('The plan has more than one page (E0604).');
      const stored = await api.uploadPlan(project.id, file);
      editor.dispatch({
        type: 'planUploaded',
        floorId: target.id,
        plan: {
          kind: 'pdf',
          ...stored,
          uploadedBy: user.id,
          page: { widthPt: info.widthPt, heightPt: info.heightPt },
        },
        now: new Date().toISOString(),
      });
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function chosen(file: File | undefined) {
    if (!file || !floor) return;
    if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
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
    status: () => notice('Flagging a floor as done (A-08) is added with WBS 1.3.'),
    clear: () =>
      mine.length > 0
        ? setClearing(true)
        : notice('There is nothing of yours to clear on this floor.'),
  });

  const all: ToolKey[] = [
    'open',
    'save',
    'clear',
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
      !(k === 'open' && uploading),
  );

  return (
    <Shell
      tab="floor"
      projectId={project.id}
      sidebar={
        <div className={building ? 'library greyed' : 'library'} aria-label="Component Library">
          <p className="sidebar-title">Component Library</p>
          <DisciplineTabs value={tab} onChange={setTab} disabled={building} />
          <div className="library-chips">
            {LIBRARY_ITEMS.filter((i) => tab === 'All' || i.discipline === tab.toLowerCase()).map(
              (item) => (
                <button
                  key={item.key}
                  className={`lib-chip${armed === item.key ? ' armed' : ''}`}
                  disabled={building || !canPlace}
                  aria-pressed={armed === item.key}
                  draggable={!building && canPlace && isPlaceable(item)}
                  title={
                    isPlaceable(item)
                      ? `${item.label} (${item.cmpCode}, draft symbol): drag onto the plan, or click it and then click the plan`
                      : 'Draw a cable between two components'
                  }
                  onDragStart={(e) => {
                    e.dataTransfer.setData(LIBRARY_DRAG_TYPE, item.key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => {
                    setDraft(null);
                    if (isPlaceable(item)) setArmed((k) => (k === item.key ? null : item.key));
                    else if (armed === 'cable') setArmed(null);
                    else if (construction) setArmed('cable');
                    else setConstructionFor('tool');
                  }}
                >
                  {item.label}
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
          pressed={building ? ['building'] : []}
          hidden={building ? ['status'] : []}
        />
      }
    >
      <SaveBanner />
      {building ? (
        <BuildingTab
          floors={project.building.floors}
          zoom={zoom}
          readOnly={!editor.layers.includes('electrical')}
        />
      ) : (
        <div className="floor-layout">
          <section className="panel floor-canvas" aria-label="Floor view">
            {!floor ? (
              <p className="canvas-empty muted">
                Set the number of floors on Import File to start.
              </p>
            ) : floor.plan ? (
              <PlanViewer
                key={`${floor.id}:${floor.plan.fileId}`}
                controls={viewer}
                projectId={project.id}
                plan={floor.plan}
                floorLabel={floor.name}
                readOnly={!editor.canEdit}
                userId={user.id}
                onCalibration={(calibration) =>
                  editor.dispatch({ type: 'calibration', floorId: floor.id, calibration })
                }
                markers={markers}
                selectedId={selectedId}
                placing={armed !== null && armed !== 'cable'}
                cables={planCables}
                cableMode={armed === 'cable'}
                drawingPoints={draft ? draft.points.map(toPdf) : null}
                onCableClick={cableClick}
                onPlace={(at, key) => (canPlace ? place(at, key ?? armed) : undefined)}
                onSelect={setSelectedId}
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
            ) : (
              <p className="canvas-empty muted">
                No plan for {floor.name} yet. Use <strong>Open</strong> to upload its PDF (one page,
                up to 20 MB).
              </p>
            )}
          </section>
          <RightPanel
            floor={floor}
            property={
              selectedCable ? (
                <CableProperty
                  key={`${selectedCable.id}:${selectedCable.version}`}
                  cable={selectedCable}
                  elements={project.model.elements}
                  allowance={allowance}
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

/** Right panel (Figma 3.1 - 3.3): transformer capacity and connected load; Cable Size (A-07). */
function RightPanel(props: { floor: Floor | null; property: ReactNode }) {
  const { project } = useWorkspace();
  const pf = (() => {
    if (!project.rulePackId || !project.rulePackVersion) return null;
    const v = getRulePack(project.rulePackId, project.rulePackVersion).calculationDefaults.find(
      (d) => d.key === 'defaultLoadPowerFactor',
    )?.value;
    return typeof v === 'number' ? v : null;
  })();
  const transformers = project.model.elements.filter((e) => e.kind === 'transformer');
  const txKva = transformers.reduce((s, t) => s + (t.kind === 'transformer' ? (t.kva ?? 0) : 0), 0);
  const plot = project.details.plotLoad;
  // Allowable: installed transformer kVA, or the plot load allocation until a transformer is placed.
  const allowable =
    txKva > 0
      ? txKva
      : plot.value === null
        ? null
        : plot.unit === 'kVA'
          ? plot.value
          : pf
            ? plot.value / pf
            : null;
  const connected = 0; // load aggregation arrives with components (WBS 1.3.4)
  const loaded = allowable ? Math.round((connected / allowable) * 100) : 0;
  const sourceConnected = false; // set by the Building tab once the transformer feeds the risers (WBS 1.4)
  return (
    <aside className="panel right-panel" aria-label="Right panel">
      <div className="capacity">
        <div className="capacity-head">
          <strong>TRANSFORMER CAPACITY &amp; CONNECTED LOAD SCHEDULE</strong>
          <span className="loaded-badge">
            {loaded}%<small>Loaded</small>
          </span>
        </div>
        <div className="capacity-values">
          <span>
            Connected: <strong>{connected} kVA</strong>
          </span>
          <span>
            Allowable: <strong>{allowable === null ? '-' : `${Math.round(allowable)} kVA`}</strong>
          </span>
        </div>
      </div>
      <div className="right-body">
        {props.floor && props.floor.plan && planStatus(props.floor) !== 'Calibrated' && (
          <p className="field-hint">Calibrate the plan before placing components (E0701).</p>
        )}
        {props.property}
      </div>
      <button
        className="btn btn-primary cable-size"
        disabled={!sourceConnected}
        title={
          sourceConnected
            ? undefined
            : 'Connect the transformer to the risers in the Building tab first (A-07)'
        }
      >
        Cable Size
      </button>
    </aside>
  );
}

/**
 * Cable length allowance (12.2): the Technical Lead's override, else the rule-pack value, else its
 * interim default (OI-17: 10 %), labelled interim. Null without a rule pack.
 */
function lengthAllowance(project: {
  rulePackId: string | null;
  rulePackVersion: string | null;
  calculation: { defaultOverrides: Record<string, number | string> };
}): { pct: number; interim: boolean } | null {
  const override = project.calculation.defaultOverrides.cableLengthAllowancePct;
  if (typeof override === 'number') return { pct: override, interim: false };
  if (!project.rulePackId || !project.rulePackVersion) return null;
  const d = getRulePack(project.rulePackId, project.rulePackVersion).calculationDefaults.find(
    (x) => x.key === 'cableLengthAllowancePct',
  );
  if (typeof d?.value === 'number') return { pct: d.value, interim: false };
  if (typeof d?.interimDefault === 'number') return { pct: d.interimDefault, interim: true };
  return null;
}
