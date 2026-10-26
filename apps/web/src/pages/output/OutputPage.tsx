import { useState } from 'react';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { REPORTS, SAMPLE_SCHEDULE, SCHEDULE_TYPES } from '../../sample/sampleData';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import '../schematic/schematic.css';

/** Output (Figma screen 5): report library, schedule preview, Download. */
export function OutputPage() {
  const { project } = useWorkspace();
  const notice = useNotice();
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [reports, setReports] = useState<Set<string>>(new Set());
  const [type, setType] = useState<(typeof SCHEDULE_TYPES)[number]>('DB Schedule');
  const toolbar = useProjectToolbar('output', {
    status: () => notice('Floor status (A-08) is shown on Floor Setup.'),
  });
  const toggle = (r: string) =>
    setReports((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  return (
    <Shell
      tab="output"
      projectId={project.id}
      sidebar={
        <div aria-label="Report Library">
          <p className="sidebar-title">Report Library</p>
          <DisciplineTabs value={tab} onChange={setTab} />
          <ul className="check-list">
            {REPORTS.map((r) => (
              <li key={r}>
                <label>
                  {r}
                  <input type="checkbox" checked={reports.has(r)} onChange={() => toggle(r)} />
                </label>
              </li>
            ))}
          </ul>
          <label className="schedule-type">
            Schedule Type:
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {SCHEDULE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      }
      sidebarFooter={
        <button
          className="btn btn-primary download-btn"
          disabled={reports.size === 0}
          onClick={() =>
            notice('Excel export comes with WBS 1.7.2 (files never overwritten: _v1, _v2).')
          }
        >
          Download
        </button>
      }
      toolbar={
        <Toolbar
          {...toolbar}
          enabled={['open', 'save', 'sync', 'status', 'back', 'next', 'guide']}
        />
      }
    >
      <SaveBanner />
      <section className="panel drawing-area" aria-label="Report preview">
        {reports.size > 0 && (
          <span className="sample-note">Sample data - generated from the results in WBS 1.7</span>
        )}
        {reports.size > 0 && <SchedulePreview />}
      </section>
    </Shell>
  );
}

function SchedulePreview() {
  const s = SAMPLE_SCHEDULE;
  const f = (n: number) => n.toFixed(2);
  return (
    <table className="schedule-sheet" aria-label={`Schedule ${s.board}`}>
      <tbody>
        <tr>
          <td colSpan={7} className="left strong">
            PROJECT : {s.project}
            <br />
            PLANNED COMPLETION DATE :
            <br />
            <br />
            {s.board}
          </td>
          <td colSpan={7} className="strong">
            DETAILS OF CONNECTED LOAD, MAX. DEMAND &amp; kWHR METERING
          </td>
          <td colSpan={4}>
            <div className="logo">{s.client}</div>
            LOCATION OF SMDB: {s.location}
          </td>
        </tr>
        <tr className="strong">
          <td>CIRCUIT / FEEDER</td>
          <td>WAY NO</td>
          <td>SP/TP</td>
          <td>ACB/MCCB (A)</td>
          <td>FAULT DUTY kA</td>
          <td>NO. OF CORES</td>
          <td>TYPE</td>
          <td>SIZE</td>
          <td>ECC mm²</td>
          <td>LENGTH (m)</td>
          <td>R-PH</td>
          <td>Y-PH</td>
          <td>B-PH</td>
          <td>TCL kW</td>
          <td>MD kW</td>
          <td>1-PH</td>
          <td>3-PH</td>
          <td>REMARKS</td>
        </tr>
        <tr className="strong">
          <td className="left">INCOMER</td>
          <td>-</td>
          <td>TP</td>
          <td>{s.incomer.breaker}</td>
          <td>{s.incomer.duty}</td>
          <td>{s.incomer.cores}</td>
          <td>{s.incomer.type}</td>
          <td>{s.incomer.size}</td>
          <td>{s.incomer.ecc}</td>
          <td>{s.incomer.length}</td>
          {s.incomer.kw.map((k, i) => (
            <td key={i}>{f(k)}</td>
          ))}
          <td>{f(s.incomer.tcl)}</td>
          <td>{f(s.incomer.md)}</td>
          <td />
          <td />
          <td />
        </tr>
        {s.ways.map(([ref, way, size, ecc, len, kw, tcl, md]) => (
          <tr key={way}>
            <td className="left">{ref}</td>
            <td>{way}</td>
            <td>TP</td>
            <td>40</td>
            <td>35</td>
            <td>T 4C</td>
            <td>XLPE</td>
            <td>{size}</td>
            <td>{ecc}</td>
            <td>{len}</td>
            {kw.map((k, i) => (
              <td key={i}>{f(k)}</td>
            ))}
            <td>{f(tcl)}</td>
            <td>{f(md)}</td>
            <td>1</td>
            <td />
            <td />
          </tr>
        ))}
        <tr className="strong">
          <td colSpan={10} className="left">
            DEMAND FACTOR: {s.totals.demandFactor} MAX. DEMAND: {f(s.totals.md)} kW
          </td>
          {s.totals.kw.map((k, i) => (
            <td key={i}>{k.toFixed(3)}</td>
          ))}
          <td>{f(s.totals.tcl)}</td>
          <td>{f(s.totals.md)}</td>
          <td colSpan={3}>TOTAL</td>
        </tr>
      </tbody>
    </table>
  );
}
