import { useState } from 'react';
import { useParams } from 'react-router';
import { PreviewBanner } from '../../components/PreviewBanner';
import { AppShell } from '../../layout/AppShell';
import {
  phaseCurrentA,
  SAMPLE_FLOOR_CABLES,
  SAMPLE_FLOOR_NODES,
  SAMPLE_FLOORS,
  SAMPLE_LOADS,
} from '../../sample/sampleData';
import './modelling.css';

type View = 'floor' | 'building';
type Scope = 'element' | 'floor' | 'project';

/** Component library tabs and items (FR-13, design doc Section 13). */
const LIBRARY = [
  {
    group: 'Electrical',
    items: [
      'EB Utility / RMU',
      'Transformer',
      'Generator',
      'ATS',
      'LV Panel / MDB',
      'EMDB',
      'SMDB',
      'MCC',
      'DB',
      'Busbar',
      'Tap-off box',
      'Isolator',
      'UPS',
      'PFC bank',
    ],
    phase2: ['13 A socket', 'Lighting'],
  },
  { group: 'Mechanical', items: ['AHU', 'FCU', 'Chiller'], phase2: [] },
  { group: 'PHE', items: ['Pump', 'Fire pump'], phase2: [] },
];

/** Page 2 - Floor & Building Modelling (FR-13, FR-18, FR-19, D-20). Layout preview (WBS 1.2.1). */
export function ModellingPage() {
  const { projectId } = useParams();
  const [view, setView] = useState<View>('floor');
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [selected, setSelected] = useState<string | null>('SMDB-3');
  const [scope, setScope] = useState<Scope>('floor');
  const [sized, setSized] = useState(false);

  const toggle = (
    <div className="view-toggle" role="group" aria-label="View">
      {(['floor', 'building'] as const).map((v) => (
        <button
          key={v}
          className={view === v ? 'active' : ''}
          aria-pressed={view === v}
          onClick={() => setView(v)}
        >
          {v === 'floor' ? 'Floor' : 'Building'}
        </button>
      ))}
    </div>
  );

  return (
    <AppShell projectId={projectId}>
      <PreviewBanner builtIn="WBS 1.3 (Floor view) and 1.4 (Building view)" />
      <div className="modelling">
        <section
          className="card canvas-card"
          aria-label={view === 'floor' ? 'Floor view' : 'Building view'}
        >
          <div className="canvas-head">
            <strong>{view === 'floor' ? 'Level 03 plan' : 'Building'}</strong>
            {view === 'floor' && (
              <select className="select floor-select" aria-label="Floor" defaultValue="3">
                {SAMPLE_FLOORS.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <span className="muted">
              {view === 'floor'
                ? 'Drag components, draw cables, enter loads'
                : 'Riser on the left connects the floors with tap-offs'}
            </span>
            {/* FR-19: the view switch sits in the top-right corner */}
            {toggle}
          </div>
          {view === 'floor' ? (
            <FloorView selected={selected} onSelect={setSelected} />
          ) : (
            <BuildingView onSelect={setSelected} />
          )}
        </section>

        <aside className="card right-panel" aria-label="Right panel">
          <h2 className="card-title">
            Load table {view === 'floor' ? '- Level 03' : '- Building'}
          </h2>
          <LoadTable />
          <div className="cable-size">
            <label className="field-label" htmlFor="scope">
              Scope
            </label>
            <select
              id="scope"
              className="select"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
            >
              <option value="element">Selected element{selected ? ` (${selected})` : ''}</option>
              <option value="floor">Current floor</option>
              <option value="project">Whole project</option>
            </select>
            <button className="btn btn-primary cable-size-btn" onClick={() => setSized(true)}>
              Cable Size
            </button>
          </div>
          <h2 className="card-title">Results {selected ? `- ${selected}` : ''}</h2>
          {sized ? (
            <dl className="results">
              <dt>Status</dt>
              <dd>
                <span className="tag tag-tbc">Provisional</span> demand factors TBC (E1901)
              </dd>
              <dt>Cable</dt>
              <dd>1 x 4C x 10 mm2 + 10 mm2 ECC</dd>
              <dt>Breaker</dt>
              <dd>MCCB 40 A, 25 kA</dd>
              <dt>Ib / In / Iz</dt>
              <dd>34.0 / 40 / 57.6 A</dd>
              <dt>Voltage drop</dt>
              <dd>1.36 % (total 2.36 %)</dd>
              <dt>Sized by</dt>
              <dd>C2 Voltage drop</dd>
            </dl>
          ) : (
            <p className="muted">Press Cable Size to size cables and run the checks.</p>
          )}
        </aside>

        <section className="card library" aria-label="Component library">
          <div className="library-tabs" role="tablist">
            {(['All', 'Electrical', 'Mechanical', 'PHE'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="library-items">
            {LIBRARY.filter((g) => tab === 'All' || g.group === tab).map((g) => (
              <span key={g.group} className="library-group">
                {g.items.map((i) => (
                  <button
                    key={i}
                    className={`chip-btn${g.group !== 'Electrical' ? ' greyed' : ''}`}
                    title={
                      g.group !== 'Electrical'
                        ? `${g.group} layer - greyed for electrical engineers`
                        : i
                    }
                  >
                    {i}
                  </button>
                ))}
                {g.phase2.map((i) => (
                  <button key={i} className="chip-btn" disabled title="Phase 2">
                    {i}
                  </button>
                ))}
              </span>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function FloorView(props: { selected: string | null; onSelect: (tag: string) => void }) {
  const pos = new Map(SAMPLE_FLOOR_NODES.map((n) => [n.tag, n]));
  return (
    <svg
      className="canvas"
      viewBox="0 0 900 420"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Sample floor plan"
    >
      <rect x="10" y="10" width="880" height="400" className="plan-bg" />
      {SAMPLE_FLOOR_CABLES.map(([a, b]) => {
        const p = pos.get(a)!;
        const q = pos.get(b)!;
        return (
          <polyline
            key={b}
            className="cable"
            points={`${p.x + 40},${p.y + 14} ${p.x + 40},${q.y + 14} ${q.x},${q.y + 14}`}
          />
        );
      })}
      {SAMPLE_FLOOR_NODES.map((n) => (
        <g
          key={n.tag}
          className={`node${props.selected === n.tag ? ' selected' : ''}`}
          onClick={() => props.onSelect(n.tag)}
          role="button"
          aria-label={n.tag}
        >
          <rect x={n.x} y={n.y} width="80" height="28" rx="4" />
          <text x={n.x + 40} y={n.y + 18}>
            {n.tag}
          </text>
        </g>
      ))}
    </svg>
  );
}

function BuildingView(props: { onSelect: (tag: string) => void }) {
  return (
    <div className="building">
      <div className="riser" aria-label="Riser" />
      <ol className="floors">
        {SAMPLE_FLOORS.map((f) => (
          <li key={f.code} className={f.code === 'GF' ? 'source-floor' : ''}>
            <span className="tap-off" aria-hidden />
            <span className="floor-name">
              {f.name} <span className="muted">+{f.levelM.toFixed(2)} m</span>
            </span>
            <span className="floor-boards">
              {f.boards.map((b) => (
                <button key={b} className="chip-btn" onClick={() => props.onSelect(b)}>
                  {b}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LoadTable() {
  const total = SAMPLE_LOADS.reduce(
    (t, r) => ({ l1: t.l1 + r.kwL1, l2: t.l2 + r.kwL2, l3: t.l3 + r.kwL3 }),
    { l1: 0, l2: 0, l3: 0 },
  );
  const connected = total.l1 + total.l2 + total.l3;
  return (
    <table className="table load-table">
      <thead>
        <tr>
          <th>Component</th>
          <th>Load type</th>
          <th className="num">L1 kW</th>
          <th className="num">L2 kW</th>
          <th className="num">L3 kW</th>
          <th className="num">pf</th>
          <th className="num">I (A)</th>
        </tr>
      </thead>
      <tbody>
        {SAMPLE_LOADS.map((r) => (
          <tr key={`${r.tag}-${r.loadType}`}>
            <td>{r.tag}</td>
            <td>{r.loadType}</td>
            <td className="num">{r.kwL1.toFixed(1)}</td>
            <td className="num">{r.kwL2.toFixed(1)}</td>
            <td className="num">{r.kwL3.toFixed(1)}</td>
            <td className="num">{r.pf.toFixed(2)}</td>
            <td className="num">{phaseCurrentA(r).toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th colSpan={2}>Connected {connected.toFixed(1)} kW</th>
          <th className="num">{total.l1.toFixed(1)}</th>
          <th className="num">{total.l2.toFixed(1)}</th>
          <th className="num">{total.l3.toFixed(1)}</th>
          <th colSpan={2} className="num">
            MD {connected.toFixed(1)} kW <span className="tag tag-tbc">DF TBC</span>
          </th>
        </tr>
      </tfoot>
    </table>
  );
}
