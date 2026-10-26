import { useState } from 'react';
import { useParams } from 'react-router';
import { PreviewBanner } from '../../components/PreviewBanner';
import { AppShell } from '../../layout/AppShell';
import { SAMPLE_CHECKLIST } from '../../sample/sampleData';
import '../modelling/modelling.css';

const SCENARIOS = [
  'Normal (transformer)',
  'Standby - power failure',
  'Standby - fire mode',
] as const;

/** Page 4 - Simulation & Report: scenarios, final check list, exports (FR-33). Layout preview. */
export function ReportPage() {
  const { projectId } = useParams();
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>(SCENARIOS[0]);
  return (
    <AppShell projectId={projectId}>
      <PreviewBanner builtIn="WBS 1.5.3 and 1.7" />
      <div className="report-layout">
        <section className="card" aria-label="Scenario">
          <h2 className="card-title">Scenario</h2>
          <fieldset className="scenario">
            <legend className="sr-only">Scenario</legend>
            {SCENARIOS.map((s) => (
              <label key={s} className="check">
                <input
                  type="radio"
                  name="scenario"
                  checked={scenario === s}
                  onChange={() => setScenario(s)}
                />
                {s}
              </label>
            ))}
          </fieldset>
          <div className="exports">
            <button className="btn btn-primary">Export schedules (Excel)</button>
            <button className="btn">Calculation sheet (Excel)</button>
            <button className="btn" disabled title="Phase 1">
              PDF report
            </button>
          </div>
          <p className="field-hint">
            Files are never overwritten: _v1, _v2 are added on collision.
          </p>
        </section>
        <section className="card" aria-label="Final check list">
          <h2 className="card-title">Final check list - {scenario}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Code</th>
                <th>Element</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_CHECKLIST.map((c) => (
                <tr key={`${c.kind}-${c.tag}`}>
                  <td>
                    <span
                      className={`tag ${c.kind === 'Failure' ? 'tag-overridden' : c.kind === 'Warning' ? 'tag-tbc' : ''}`}
                    >
                      {c.kind}
                    </span>
                  </td>
                  <td>{c.code}</td>
                  <td>{c.tag}</td>
                  <td>{c.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}
