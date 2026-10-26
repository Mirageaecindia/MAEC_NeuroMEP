import { useState } from 'react';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { SAMPLE_SLD, SAMPLE_TRANSFORMERS } from '../../sample/sampleData';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import './schematic.css';

/** Schematic (Figma screen 4): single-line diagram from the selected transformers. */
export function SchematicPage() {
  const { project } = useWorkspace();
  const notice = useNotice();
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [zoom, setZoom] = useState(1);
  const fromModel = project.model.elements
    .filter((e) => e.kind === 'transformer')
    .map((e) => e.tag);
  const transformers = fromModel.length ? fromModel : SAMPLE_TRANSFORMERS;
  const [selected, setSelected] = useState<Set<string>>(() => new Set([transformers[0]!]));
  const toolbar = useProjectToolbar('schematic', {
    zoomIn: () => setZoom((z) => Math.min(4, z * 1.25)),
    zoomOut: () => setZoom((z) => Math.max(0.25, z / 1.25)),
    reset: () => setZoom(1),
    status: () => notice('Floor status (A-08) is shown on Floor Setup.'),
  });
  const all = selected.size === transformers.length;
  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  return (
    <Shell
      tab="schematic"
      projectId={project.id}
      sidebar={
        <div aria-label="Architecture Details">
          <p className="sidebar-title">Architecture Details</p>
          <DisciplineTabs value={tab} onChange={setTab} />
          <ul className="check-list">
            <li>
              <label>
                All Transformer
                <input
                  type="checkbox"
                  checked={all}
                  onChange={() => setSelected(all ? new Set() : new Set(transformers))}
                />
              </label>
            </li>
            {transformers.map((t) => (
              <li key={t}>
                <label>
                  {t}
                  <input type="checkbox" checked={selected.has(t)} onChange={() => toggle(t)} />
                </label>
              </li>
            ))}
          </ul>
        </div>
      }
      sidebarFooter={
        <button
          className="btn btn-primary download-btn"
          onClick={() => notice('Schematic download comes with WBS 1.5.3.')}
        >
          Download
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
        <span className="sample-note">Sample data - drawn from the model in WBS 1.5.3</span>
        {selected.size === 0 ? (
          <p className="muted canvas-empty">Select a transformer on the left.</p>
        ) : (
          <div className="sld-stack">
            {[...selected].map((t) => (
              <Sld key={t} tag={t} zoom={zoom} />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function Sld(props: { tag: string; zoom: number }) {
  const ways = 12;
  const boards = SAMPLE_SLD.boards;
  return (
    <svg
      className="sld"
      width={520 * props.zoom}
      height={(140 + ways * 22) * props.zoom}
      viewBox={`0 0 520 ${140 + ways * 22}`}
      role="img"
      aria-label={`Single-line diagram from ${props.tag}`}
    >
      {boards.map((b, bi) => {
        const x = 150 + bi * 200;
        return (
          <g key={b.tag}>
            <text x={x} y="12" className="sld-text">
              {b.tag}
            </text>
            <line x1={x} y1="18" x2={x} y2={30 + ways * 22} className="sld-bus" />
            {Array.from({ length: ways }, (_, i) => (
              <g key={i}>
                <rect x={x - 5} y={26 + i * 22} width="10" height="10" className="sld-breaker" />
                <line
                  x1={x + 5}
                  y1={31 + i * 22}
                  x2={x + 70}
                  y2={31 + i * 22}
                  className="sld-line"
                />
                <text x={x + 74} y={34 + i * 22} className="sld-small">
                  DB-{bi + 1}-{String(i + 1).padStart(2, '0')}
                </text>
              </g>
            ))}
            <line x1={x} y1={30 + ways * 22} x2={x} y2={60 + ways * 22} className="sld-line" />
          </g>
        );
      })}
      <rect x="40" y={60 + ways * 22} width="440" height="36" className="sld-panel" />
      <text x="260" y={82 + ways * 22} className="sld-text" textAnchor="middle">
        {SAMPLE_SLD.panel.tag} - {SAMPLE_SLD.panel.incomer}
      </text>
      <line x1="260" y1={96 + ways * 22} x2="260" y2={116 + ways * 22} className="sld-line" />
      <circle cx="260" cy={124 + ways * 22} r="8" className="sld-breaker" />
      <text x="275" y={128 + ways * 22} className="sld-text">
        {props.tag} {SAMPLE_SLD.transformer.rating}
      </text>
    </svg>
  );
}
