import { sldTree } from '@neuromep/shared';
import { useRef, useState } from 'react';
import { useApi } from '../../auth/AuthContext';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { safeFileName } from '../../workspace/fileNames';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { SldDiagram } from './SldDiagram';
import './schematic.css';

/**
 * Downloads the drawn diagrams as one PDF, a page per transformer (Section 14), named
 * <project>_SLD_v<n>.pdf with the next export number from the server (never overwritten).
 * jsPDF and svg2pdf.js load only when Download is pressed.
 */
async function downloadPdf(svgs: SVGSVGElement[], fileName: string) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  let doc: InstanceType<typeof jsPDF> | null = null;
  for (const svg of svgs) {
    const { width, height } = svg.viewBox.baseVal;
    const orientation = width > height ? 'landscape' : 'portrait';
    if (!doc) doc = new jsPDF({ orientation, unit: 'pt', format: [width, height] });
    else doc.addPage([width, height], orientation);
    await doc.svg(svg, { x: 0, y: 0, width, height });
  }
  doc?.save(fileName);
}

/** Schematic (Figma screen 4): single-line diagrams of the selected transformers, from the model. */
export function SchematicPage() {
  const { project } = useWorkspace();
  const api = useApi();
  const notice = useNotice();
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const transformers = project.model.elements.filter((e) => e.kind === 'transformer');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(transformers.slice(0, 1).map((t) => t.id)),
  );
  const svgs = useRef(new Map<string, SVGSVGElement>());
  const toolbar = useProjectToolbar('schematic', {
    zoomIn: () => setZoom((z) => Math.min(4, z * 1.25)),
    zoomOut: () => setZoom((z) => Math.max(0.25, z / 1.25)),
    reset: () => setZoom(1),
    status: () => notice('Floor status (A-08) is shown on Floor Setup.'),
  });
  const all = transformers.length > 0 && selected.size === transformers.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Phase 1 is electrical distribution; mechanical and PHE components supply electrical data only.
  const electrical = tab === 'All' || tab === 'Electrical';
  const shown = electrical ? transformers.filter((t) => selected.has(t.id)) : [];

  async function download() {
    setBusy(true);
    try {
      const { version } = await api.nextExportVersion(project.id, 'sld');
      const name = `${safeFileName(project.details.name) || 'NeuroMEP'}_SLD_v${version}.pdf`;
      await downloadPdf(
        shown.map((t) => svgs.current.get(t.id)).filter((s): s is SVGSVGElement => !!s),
        name,
      );
      notice(`Downloaded ${name}.`);
    } catch (e) {
      notice(`The PDF could not be made: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tab="schematic"
      projectId={project.id}
      sidebar={
        <div aria-label="Architecture Details">
          <p className="sidebar-title">Architecture Details</p>
          <DisciplineTabs value={tab} onChange={setTab} />
          {transformers.length === 0 ? (
            <p className="muted">No transformer placed yet - add one on Floor Setup.</p>
          ) : (
            <ul className="check-list">
              <li>
                <label>
                  All Transformer
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={() =>
                      setSelected(all ? new Set() : new Set(transformers.map((t) => t.id)))
                    }
                  />
                </label>
              </li>
              {transformers.map((t) => (
                <li key={t.id}>
                  <label>
                    {t.tag}
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      sidebarFooter={
        <button
          className="btn btn-primary download-btn"
          disabled={shown.length === 0 || busy}
          onClick={() => void download()}
        >
          {busy ? 'Preparing PDF…' : 'Download'}
        </button>
      }
      toolbar={
        <Toolbar
          {...toolbar}
          enabled={[
            'open',
            'save',
            'zoomIn',
            'zoomOut',
            'reset',
            'sync',
            'status',
            'back',
            'next',
            'guide',
          ]}
        />
      }
    >
      <SaveBanner />
      <section className="panel drawing-area" aria-label="Single-line diagram">
        {!electrical ? (
          <p className="muted canvas-empty">
            Phase 1 draws the electrical distribution only; {tab.toLowerCase()} components supply
            electrical data.
          </p>
        ) : shown.length === 0 ? (
          <p className="muted canvas-empty">
            {transformers.length === 0
              ? 'Place a transformer on Floor Setup to draw its single-line diagram.'
              : 'Select a transformer on the left.'}
          </p>
        ) : (
          <div className="sld-stack">
            {shown.map((t) => (
              <SldDiagram
                key={t.id}
                ref={(el) => {
                  if (el) svgs.current.set(t.id, el);
                  else svgs.current.delete(t.id);
                }}
                project={project}
                tree={sldTree(project.model, t.id)!}
                zoom={zoom}
              />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
