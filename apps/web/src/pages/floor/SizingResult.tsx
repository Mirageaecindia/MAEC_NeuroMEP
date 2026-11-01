import {
  CHECK_LABELS,
  formatVd,
  MOCK_ENGINE,
  MOCK_NOTE,
  resultOf,
  type CheckCode,
  type Project,
  type StoredResult,
} from '@neuromep/shared';

const REASONS: Record<StoredResult['provisionalReasons'][number], string> = {
  'upstream-not-connected': 'upstream not connected',
  'demand-factors-tbc': 'demand factors TBC (E1901)',
  'unverified-ampacity-tables': 'ampacity tables not verified (V-12)',
};

/** Status line of a result: Out of date (grey) wins over the stored status (FR-21). */
export function statusText(r: StoredResult, outOfDate: boolean): string {
  if (outOfDate) return 'Out of date - press Cable Size';
  if (r.status === 'provisional') {
    return `Provisional - ${r.provisionalReasons.map((x) => REASONS[x]).join('; ')}`;
  }
  return {
    final: 'Final',
    'awaiting-load': 'Awaiting load',
    blocked: `Blocked ${r.errors.join(', ')}`,
    'out-of-date': 'Out of date - press Cable Size',
  }[r.status];
}

/** Size, breaker and voltage drop as the right panel and tooltips show them. */
export function resultFigures(r: StoredResult) {
  const s = r.size;
  const d = r.device;
  return {
    size: s ? `${s.runs} x ${s.cores} ${s.sizeMm2} mm² + ${s.eccMm2} mm² ECC` : '-',
    breaker: d ? `${d.ratingA} A ${d.type} ${d.poles}` : '-',
    vdOwn: formatVd(r.values.vdOwnPct),
    vdTotal: formatVd(r.values.vdTotalPct),
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
      {r.engineVersion === MOCK_ENGINE && <p className="banner banner-info">{MOCK_NOTE}.</p>}
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
        <dt>Vd circuit :</dt>
        <dd>{f.vdOwn}</dd>
        <dt>Vd total :</dt>
        <dd>{f.vdTotal}</dd>
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
      <p className="muted">
        Run {new Date(r.ranAt).toLocaleString()} · rule pack {r.rulePackVersion ?? '-'}
      </p>
    </section>
  );
}
