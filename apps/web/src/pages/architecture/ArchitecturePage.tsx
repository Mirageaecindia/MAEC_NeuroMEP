import { useState } from 'react';
import { useParams } from 'react-router';
import { PreviewBanner } from '../../components/PreviewBanner';
import { AppShell } from '../../layout/AppShell';
import { SAMPLE_SCHEDULE, SAMPLE_TREE, type SampleTreeNode } from '../../sample/sampleData';
import '../modelling/modelling.css';

/** Page 3 - Architecture: network tree + panel schedule grid (FR-32). Layout preview (WBS 1.2.1). */
export function ArchitecturePage() {
  const { projectId } = useParams();
  const [panel, setPanel] = useState('SMDB-3');
  return (
    <AppShell
      projectId={projectId}
      actions={
        <button
          className="btn btn-primary btn-sm cable-size-btn"
          title="Cable Size can also be run here"
        >
          Cable Size
        </button>
      }
    >
      <PreviewBanner builtIn="WBS 1.5.3" />
      <div className="arch-layout">
        <section className="card" aria-label="Network tree">
          <h2 className="card-title">Network tree</h2>
          <ul className="tree">
            <TreeNode node={SAMPLE_TREE} active={panel} onSelect={setPanel} />
          </ul>
        </section>
        <section className="card" aria-label="Panel schedule">
          <h2 className="card-title">Panel schedule - {panel}</h2>
          <p className="field-hint">
            Only input cells are editable; edits are synchronised with the canvas.
          </p>
          <table className="table schedule">
            <thead>
              <tr>
                <th className="num">Way</th>
                <th>Feeder / load ref</th>
                <th>Poles</th>
                <th>Device</th>
                <th>Fault duty</th>
                <th>Cable</th>
                <th>ECC</th>
                <th className="num">Length (m)</th>
                <th className="num">R kW</th>
                <th className="num">Y kW</th>
                <th className="num">B kW</th>
                <th className="num">MD kW</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_SCHEDULE.map((r) => (
                <tr key={r.way}>
                  <td className="num">{r.way}</td>
                  <td>{r.ref}</td>
                  <td>{r.poles}</td>
                  <td>{r.device}</td>
                  <td>{r.duty}</td>
                  <td>{r.cable}</td>
                  <td>{r.ecc}</td>
                  <td className="num">{r.length || '-'}</td>
                  {r.kw.map((k, i) => (
                    <td key={i} className="num">
                      {k.toFixed(1)}
                    </td>
                  ))}
                  <td className="num">{r.md.toFixed(1)}</td>
                  <td>
                    <input
                      className="input"
                      aria-label={`Remarks way ${r.way}`}
                      defaultValue={r.way === 1 ? 'ELCB 30 mA' : ''}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}

function TreeNode(props: {
  node: SampleTreeNode;
  active: string;
  onSelect: (tag: string) => void;
}) {
  const { node } = props;
  return (
    <li>
      <button
        className={props.active === node.tag ? 'active' : ''}
        onClick={() => props.onSelect(node.tag)}
      >
        {node.tag}
      </button>{' '}
      <span className="muted">{node.detail}</span>
      {node.children && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.tag} node={c} active={props.active} onSelect={props.onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
