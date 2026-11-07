import { useState } from 'react';
import type { Line, WorkedExample } from './examples';

const show = (v: number | string | null, digits?: number) =>
  v === null
    ? '-'
    : typeof v === 'number'
      ? digits === undefined
        ? String(+v.toFixed(4))
        : v.toFixed(digits)
      : v;

function Lines({ lines }: { lines: Line[] }) {
  return (
    <table className="guide-table calc-lines">
      <tbody>
        {lines.map((l) => (
          <tr key={l.label}>
            <th scope="row">{l.label}</th>
            <td className="how">{l.how}</td>
            <td className="value">
              {show(l.value, l.digits)} {l.unit ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "Calculation" button of the user guide: the method, then a worked example computed by the
 * real engine in the browser (loaded on the first click), with the guide's own recomputation
 * beside NeuroMEP's figure.
 */
export function CalcButton({ example }: { example: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WorkedExample | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !error) {
      try {
        const { workedExample } = await import('./examples');
        setData(workedExample(example));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return (
    <div className="calc-box">
      <button className="calc-button" aria-expanded={open} onClick={() => void toggle()}>
        {open ? '▾' : '▸'} Calculation
      </button>
      {open && (
        <div className="calc-body" role="region" aria-label={`Calculation ${example}`}>
          {error && <p className="calc-error">The example could not be worked out: {error}</p>}
          {!data && !error && <p className="muted">Working it out with the engine…</p>}
          {data && (
            <>
              <h4>{data.title}</h4>
              <p className="muted">{data.source}</p>
              <ol className="calc-method">
                {data.method.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ol>
              <h5>Inputs</h5>
              <Lines lines={data.inputs} />
              <h5>Worked out</h5>
              <Lines lines={data.steps} />
              <h5>Verified against NeuroMEP</h5>
              <table className="guide-table calc-compare">
                <thead>
                  <tr>
                    <th>Figure</th>
                    <th>By the formula above</th>
                    <th>NeuroMEP (Cable Size)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.compare.map((c) => (
                    <tr key={c.label}>
                      <th scope="row">{c.label}</th>
                      <td>
                        {show(c.guide, c.digits)} {c.unit ?? ''}
                      </td>
                      <td>
                        {show(c.engine, c.digits)} {c.unit ?? ''}
                      </td>
                      <td className={c.ok ? 'agree' : 'differ'}>{c.ok ? '✓ agree' : '✗ differ'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
