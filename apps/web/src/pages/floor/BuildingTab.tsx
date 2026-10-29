import {
  completenessIssues,
  riserBoards,
  scenarioSupply,
  type Scenario,
  riserOf,
  riserRows,
  riserSources,
  setBoardRiser,
  setRiser,
  sourceConnected,
  floorStatus,
  type Element,
  type Project,
  type Floor,
  type Riser,
  type Discipline,
} from '@neuromep/shared';
import { useMemo, useState } from 'react';
import { NumberInput } from '../../components/fields';
import { StatusMark } from '../../layout/icons';
import { useNotice } from '../../layout/Shell';
import { DemandFactorsDialog } from './DemandFactorsDialog';
import { STATUS_ICON } from './FloorStatusDialog';

const ROW = 70;
const TOP = 40;
const RISER_X = [330, 352, 374];
const BOARD_X = 760;
const BOARD_GAP = 56;

/** The next item after `current` in `list`, then none, then the first again (click to cycle). */
function cycle<T>(list: readonly T[], current: T | null): T | null {
  const i = current === null ? -1 : list.indexOf(current);
  return i + 1 < list.length ? list[i + 1]! : null;
}

/**
 * Building tab (Figma 3.5 - 3.8, FR-19 / FR-20): floors stacked top-down (A-13) with the risers on
 * the left. Click a riser to choose what feeds it (transformer or LV panel / MDB), click a floor
 * board to choose the riser feeding it; both are stored in the project. Building Summary with
 * floor status, Riser Design, Cable Size Calculator (enabled once a riser leads back to a
 * transformer, A-07), Save / Cancel. The engine runs from WBS 1.7.
 */
export function BuildingTab(props: {
  floors: Floor[];
  model: Project['model'];
  zoom: number;
  readOnly: boolean;
  onRisers: (risers: Riser[]) => void;
  onSave: () => void;
}) {
  const notice = useNotice();
  const { model } = props;
  const risers = riserRows(model.risers);
  /** Risers as they were when the tab opened (Cancel). */
  const [opened] = useState(model.risers);
  const [sized, setSized] = useState(false);
  const [dfOpen, setDfOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const change = (next: Riser[]) => {
    props.onRisers(next);
    setSized(false);
  };

  // Top floor first, then Ground, basements at the bottom - as in the building section (A-13).
  const rows = useMemo(() => [...props.floors].reverse(), [props.floors]);
  const floorY = (i: number) => TOP + i * ROW + 40;
  const bottomY = floorY(rows.length - 1);
  const boards = rows.map((f) => riserBoards(model, f.id));
  const width = BOARD_X + Math.max(1, ...boards.map((b) => b.length)) * BOARD_GAP + 20;
  const maxLen = Math.max(0, ...risers.map((r) => r.lengthM ?? 0));
  const tag = (id: string | null) => model.elements.find((e) => e.id === id)?.tag ?? null;

  /** Up to the highest floor it feeds; a riser without tap-offs in proportion to its length. */
  function riserTop(r: Riser) {
    const fed = rows.flatMap((_, i) => (boards[i]!.some((b) => r.feeds.includes(b.id)) ? [i] : []));
    if (fed.length > 0) return floorY(Math.min(...fed)) - 34;
    return r.lengthM && maxLen ? bottomY - ((bottomY - TOP + 20) * r.lengthM) / maxLen : bottomY;
  }

  function chooseSource(r: Riser, n: number) {
    if (props.readOnly) return;
    const sources = riserSources(model).map((e) => e.id);
    if (sources.length === 0) {
      notice('Place a transformer or an LV panel / MDB in Floor Setup to feed the risers.');
      return;
    }
    const next = cycle(sources, r.fedFromId);
    change(setRiser(model.risers, r.id, { fedFromId: next }));
    notice(next ? `Riser ${n} is fed from ${tag(next)}.` : `Riser ${n} is not fed.`);
  }

  function chooseRiser(board: Element) {
    if (props.readOnly) return;
    const usable = risers.filter((r) => r.lengthM).map((r) => r.id);
    if (usable.length === 0) {
      notice('Enter a riser length in Riser Design first.');
      return;
    }
    change(
      setBoardRiser(model.risers, board.id, cycle(usable, riserOf(risers, board.id)?.id ?? null)),
    );
  }

  const status = (f: Floor, d: Discipline) => STATUS_ICON[floorStatus(model, f.id, d)];
  const connected = sourceConnected({ ...model, risers });
  const fedRisers = risers.flatMap((r, i) => (r.lengthM && r.fedFromId ? [i] : []));
  const sourceTags = [...new Set(fedRisers.map((i) => tag(risers[i]!.fedFromId)))].join(', ');

  return (
    <div className="building-tab">
      <div className="building-canvas" aria-label="Building view">
        <NetworkCheck
          model={{ ...model, risers }}
          floors={props.floors}
          scenario={scenario}
          onScenario={setScenario}
        />
        <svg
          width={width * props.zoom}
          height={(bottomY + 40) * props.zoom}
          viewBox={`0 0 ${width} ${bottomY + 40}`}
          role="img"
          aria-label="Riser diagram"
        >
          {rows.map((f, i) => {
            const y = floorY(i);
            const onFloor = boards[i]!;
            return (
              <g key={f.id}>
                <line x1={RISER_X[2]! + 24} y1={y} x2={BOARD_X} y2={y} className="floor-line" />
                <text x={(RISER_X[2]! + BOARD_X) / 2} y={y - 5} className="floor-label">
                  {f.name}
                </text>
                {onFloor.length === 0 ? (
                  <g
                    className="floor-board empty"
                    role="button"
                    aria-label={`${f.name} board`}
                    onClick={() =>
                      notice(`Place an SMDB, MCC or DB on ${f.name} in Floor Setup to connect it.`)
                    }
                  >
                    <rect x={BOARD_X} y={y - 9} width="32" height="16" />
                    <line x1={BOARD_X} y1={y + 7} x2={BOARD_X + 32} y2={y - 9} />
                  </g>
                ) : (
                  onFloor.map((b, k) => {
                    const x = BOARD_X + k * BOARD_GAP;
                    const riser = risers.findIndex((r) => r.feeds.includes(b.id));
                    return (
                      <g key={b.id}>
                        {riser >= 0 && (
                          <path
                            className="riser-link"
                            d={`M ${RISER_X[riser]! + 6} ${y - 28} H ${x + 16} V ${y - 8}`}
                          />
                        )}
                        <g
                          className="floor-board"
                          role="button"
                          aria-label={`${b.tag} board`}
                          onClick={() => chooseRiser(b)}
                        >
                          <rect x={x} y={y - 9} width="32" height="16" />
                          <line x1={x} y1={y + 7} x2={x + 32} y2={y - 9} />
                          <text x={x + 16} y={y + 20} className="floor-label">
                            {b.tag}
                          </text>
                        </g>
                      </g>
                    );
                  })
                )}
              </g>
            );
          })}
          {risers.map((r, idx) =>
            r.lengthM ? (
              <rect
                key={r.id}
                className="riser"
                role="button"
                x={RISER_X[idx]}
                y={riserTop(r)}
                width="9"
                height={bottomY - riserTop(r)}
                aria-label={`Riser ${idx + 1}`}
                onClick={() => chooseSource(r, idx + 1)}
              >
                <title>
                  {r.fedFromId ? `Fed from ${tag(r.fedFromId)}` : 'Click to choose what feeds it'}
                </title>
              </rect>
            ) : null,
          )}
          {maxLen > 0 && (
            <g aria-label="Source">
              {fedRisers.length > 0 && (
                <line
                  x1="60"
                  y1={bottomY}
                  x2={RISER_X[Math.max(...fedRisers)]! + 9}
                  y2={bottomY}
                  className="source-link"
                />
              )}
              <rect x="20" y={bottomY - 18} width="36" height="36" rx="6" className="tx-box" />
              <text x="38" y={bottomY + 5} className="tx-text">
                Tx
              </text>
              {sourceTags && (
                <text x="38" y={bottomY + 32} className="floor-label">
                  {sourceTags}
                </text>
              )}
            </g>
          )}
        </svg>
      </div>

      <aside className="building-summary" aria-label="Building Summary">
        <h2>Building Summery</h2>
        <p className="summary-count">
          <strong>Number of Floor :</strong>{' '}
          {props.floors.filter((f) => f.type === 'typical').length}
        </p>
        <hr />
        <table className="summary-status">
          <thead>
            <tr>
              <th />
              <th>Elect</th>
              <th>Mech</th>
              <th>PHE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name} :</th>
                <td>
                  <StatusMark status={status(f, 'electrical')} size={16} />
                </td>
                <td>
                  <StatusMark status={status(f, 'mechanical')} size={16} />
                </td>
                <td>
                  <StatusMark status={status(f, 'phe')} size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        <h3>Riser Design</h3>
        <table className="riser-design">
          <thead>
            <tr>
              <th />
              <th>Length (m)</th>
              <th>Width (m)</th>
            </tr>
          </thead>
          <tbody>
            {risers.map((r, i) => (
              <tr key={r.id}>
                <th scope="row">Riser {i + 1}</th>
                {(['lengthM', 'widthM'] as const).map((k) => (
                  <td key={k}>
                    <NumberInput
                      className="riser-input"
                      ariaLabel={`Riser ${i + 1} ${k === 'lengthM' ? 'length' : 'width'}`}
                      value={r[k]}
                      disabled={props.readOnly}
                      onChange={(v) => {
                        if (v !== null && v <= 0) {
                          notice('Riser length and width are more than 0 m.');
                          return;
                        }
                        change(setRiser(model.risers, r.id, { [k]: v }));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className={`summary-btn${connected ? ' ready' : ''}`}
          disabled={!connected || props.readOnly}
          title={connected ? undefined : 'Connect the transformer to the risers first (A-07)'}
          onClick={() => setSized(true)}
        >
          Cable Size Calculator
        </button>
        <p className="summary-cost">
          <strong>Cost :</strong> {sized ? <span title="Price source to be confirmed">-</span> : ''}{' '}
          AED
        </p>
        <hr />
        <div className="summary-actions">
          <button
            className={`summary-btn${sized ? ' ready' : ''}`}
            disabled={!sized}
            onClick={props.onSave}
          >
            Save
          </button>
          <button className="summary-btn" disabled={props.readOnly} onClick={() => change(opened)}>
            Cancel
          </button>
        </div>
        {sized && (
          <button className="summary-btn demand-btn" onClick={() => setDfOpen(true)}>
            Demand Factors
          </button>
        )}
        {dfOpen && (
          <DemandFactorsDialog onClose={() => setDfOpen(false)} onChanged={() => setSized(false)} />
        )}
      </aside>
    </div>
  );
}

/**
 * Network check above the riser diagram (FR-20, WBS 1.4.3): the scenario switch and, for normal
 * supply, the completeness warnings (E1801 / E1802); for standby, what the generator supplies.
 */
function NetworkCheck(props: {
  model: Parameters<typeof completenessIssues>[0];
  floors: Floor[];
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}) {
  const issues = completenessIssues(props.model, props.floors);
  const standby = scenarioSupply(props.model, 'standby');
  return (
    <section className="network-check" aria-label="Network check">
      <div className="scenario-switch" role="radiogroup" aria-label="Scenario">
        {(['normal', 'standby'] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={props.scenario === s}
            className={props.scenario === s ? 'on' : ''}
            onClick={() => props.onScenario(s)}
          >
            {s === 'normal' ? 'Normal' : 'Standby'}
          </button>
        ))}
      </div>
      {props.scenario === 'normal' ? (
        issues.length === 0 ? (
          <p className="muted">Every component has a path to a source.</p>
        ) : (
          <ul className="network-issues" aria-label="Network warnings">
            {issues.map((i) => (
              <li key={`${i.code}-${i.elementId ?? i.floorId}`}>
                <strong>{i.code}</strong> {i.message}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="muted">
          On generator supply: {standby.supplied.length} of{' '}
          {standby.supplied.length + standby.notSupplied.length} components
          {standby.notSupplied.length > 0 &&
            ` - not on standby: ${standby.notSupplied.map((e) => e.tag).join(', ')}`}
          . Which loads must be on standby is open (OI-11).
        </p>
      )}
    </section>
  );
}
