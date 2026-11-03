import {
  CHECK_LABELS,
  formatVd,
  resultOf,
  type CheckCode,
  type Project,
  type StoredResult,
} from '@neuromep/shared';

const REASONS: Record<StoredResult['provisionalReasons'][number], string> = {
  'upstream-not-connected': 'upstream not connected',
  'demand-factors-tbc': 'demand factors TBC (E1901)',
  'device-data-required': 'breaker data required (E2402)',
  'unverified-ampacity-tables': 'ampacity tables not verified (V-12)',
};

/** Status line of a result: Out of date (grey) wins over the stored status (FR-21). */
export function statusText(r: StoredResult, outOfDate: boolean): string {
  if (outOfDate) return 'Out of date - press Cable Size';
  if (r.status === 'provisional') {
    const why = r.provisionalReasons.map((x) => REASONS[x]).join('; ');
    return why ? `Provisional - ${why}` : 'Provisional';
  }
  return {
    final: 'Final',
    'awaiting-load': 'Awaiting load',
    blocked: `Blocked ${r.errors.join(', ')}`,
    'out-of-date': 'Out of date - press Cable Size',
  }[r.status];
}

const amps = (a: number | null) => (a === null ? '-' : `${a.toFixed(1)} A`);
const ka = (k: number | null) => (k === null ? '-' : `${k.toFixed(2)} kA`);

/** Size, breaker, currents, voltage drop and fault levels as the right panel and tooltips show them. */
export function resultFigures(r: StoredResult) {
  const s = r.size;
  const d = r.device;
  const v = r.values;
  return {
    size: s
      ? `${s.runs} x ${s.cores} ${s.sizeMm2} mm²${s.eccMm2 ? ` + ${s.eccMm2} mm² ECC` : ''}`
      : '-',
    breaker: d
      ? `${d.ratingA} A ${d.type} ${d.poles}${d.faultRatingKa ? ` ${d.faultRatingKa} kA` : ''}`
      : '-',
    currents: `${amps(v.ibA)} / ${v.inA === null ? '-' : `${v.inA} A`} / ${amps(v.izA)}`,
    vdOwn: formatVd(v.vdOwnPct),
    vdTotal: formatVd(v.vdTotalPct),
    faults: `${ka(v.ikMaxKa)} max, ${ka(v.ikMinKa)} min`,
  };
}

/** Last Cable Size result of the selected item (FR-18): status, Sized by, figures and checks. */
export function SizingResult(props: { project: Project; id: string }) {
  const found = resultOf(props.project, props.id);
  if (!found) {
    return (
      <section className="property-card result-card" aria-label="Cable Size result">
        <h3>Cable Size result</h3>
        <p className="muted">Not sized yet - press Cable Size.</p>
      </section>
    );
  }
  const { result: r, outOfDate } = found;
  const f = resultFigures(r);
  return (
    <section
      className={`property-card result-card${outOfDate ? ' out-of-date' : ''}`}
      aria-label="Cable Size result"
    >
      <h3>Cable Size result</h3>
      <p className="result-status" role="status">
        {statusText(r, outOfDate)}
      </p>
      <dl>
        <dt>Sized by :</dt>
        <dd>{r.sizedBy ? `${r.sizedBy} ${CHECK_LABELS[r.sizedBy]}` : '-'}</dd>
        <dt>Size :</dt>
        <dd>{f.size}</dd>
        <dt>Breaker :</dt>
        <dd>{f.breaker}</dd>
        <dt>Ib / In / Iz :</dt>
        <dd>{f.currents}</dd>
        <dt>Vd circuit :</dt>
        <dd>{f.vdOwn}</dd>
        <dt>Vd total :</dt>
        <dd>{f.vdTotal}</dd>
        <dt>Ik" :</dt>
        <dd>{f.faults}</dd>
      </dl>
      <ul className="check-list" aria-label="Checks">
        {(Object.keys(r.checks) as CheckCode[]).map((c) => (
          <li key={c} title={r.checks[c]?.detail}>
            <strong>{c}</strong> {CHECK_LABELS[c]}:{' '}
            <span className={`check-${r.checks[c]?.state}`}>
              {r.checks[c]?.state === 'not-calculated'
                ? r.checks[c]?.detail?.startsWith('Not calculated')
                  ? 'not selected on Page 1'
                  : 'not calculated'
                : r.checks[c]?.state}
            </span>
          </li>
        ))}
      </ul>
      {r.trace.length > 0 && (
        <details className="result-trace">
          <summary>Calculation trace</summary>
          <ol>
            {r.trace.map((t, i) => (
              <li key={i}>
                <strong>{t.step}</strong> {t.detail}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted">
        Run {new Date(r.ranAt).toLocaleString()} · engine {r.engineVersion} · rule pack{' '}
        {r.rulePackVersion ?? '-'}
      </p>
    </section>
  );
}
