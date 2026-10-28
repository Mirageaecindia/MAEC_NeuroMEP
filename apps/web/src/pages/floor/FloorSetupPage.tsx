import { planStatus, type Floor } from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApi, useUser } from '../../auth/AuthContext';
import { Modal } from '../../components/fields';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar, type ToolKey } from '../../layout/Toolbar';
import { readFirstPageSize } from '../../viewer/pdf';
import { PlanViewer, type ViewerControls } from '../../viewer/PlanViewer';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { BuildingTab } from './BuildingTab';
import './floor.css';

/**
 * Component library: the Figma items (A-11). Legend symbols and drag-and-drop placement arrive with
 * WBS 1.3.1; Cable is the cable-drawing tool.
 */
const LIBRARY: Record<'Electrical' | 'Mechanical' | 'PHE', string[]> = {
  Electrical: [
    'ATS',
    'Generator',
    'EB Utility',
    'Transformer',
    'RMU',
    'LV Panel',
    'ACB',
    'MDB',
    'SMDB',
    'MCC',
    'DB',
    'Busbar',
    'Cable',
    'Lighting',
  ],
  Mechanical: [],
  PHE: [],
};
const MAX_PLAN_BYTES = 20 * 1024 * 1024; // A-02

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
    clear: () => notice('Clear removes your drawing on this floor - added with WBS 1.3.'),
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
            {(tab === 'All'
              ? [...LIBRARY.Electrical, ...LIBRARY.Mechanical, ...LIBRARY.PHE]
              : LIBRARY[tab]
            ).map((item) => (
              <button
                key={item}
                className="lib-chip"
                disabled={building}
                title="Drag-and-drop placement comes with WBS 1.3.1"
                onClick={() => notice('Drag-and-drop placement comes with WBS 1.3.1.')}
              >
                {item}
              </button>
            ))}
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
              />
            ) : (
              <p className="canvas-empty muted">
                No plan for {floor.name} yet. Use <strong>Open</strong> to upload its PDF (one page,
                up to 20 MB).
              </p>
            )}
          </section>
          <RightPanel floor={floor} />
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
function RightPanel(props: { floor: Floor | null }) {
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
