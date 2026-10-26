import type { Floor } from '@neuromep/shared';
import { useMemo, useState } from 'react';
import { NumberInput } from '../../components/fields';
import { StatusMark, type StatusIcon } from '../../layout/icons';
import { useNotice } from '../../layout/Shell';

interface Riser {
  lengthM: number | null;
  widthM: number | null;
}

const ROW = 70;
const TOP = 40;
const RISER_X = [330, 352, 374];
const BOARD_X = 760;

/**
 * Building tab (Figma 3.5 - 3.8): floors stacked with the risers, transformer feeding the risers,
 * floor boards connected to risers; Building Summary with floor status, Riser Design, Cable Size
 * Calculator, Save / Cancel. WBS 1.2.1 layout: riser design and connections are kept on this
 * page only; storing them and running the engine follow in WBS 1.4 and 1.7.
 */
export function BuildingTab(props: { floors: Floor[]; zoom: number; readOnly: boolean }) {
  const notice = useNotice();
  const [risers, setRisers] = useState<Riser[]>([
    { lengthM: null, widthM: null },
    { lengthM: null, widthM: null },
    { lengthM: null, widthM: null },
  ]);
  /** floorId -> riser index. */
  const [links, setLinks] = useState<Record<string, number>>({});
  const [sized, setSized] = useState(false);

  const rows = useMemo(() => [...props.floors].reverse(), [props.floors]); // top first
  const bottomY = TOP + (rows.length - 1) * ROW + 40;
  const maxLen = Math.max(0, ...risers.map((r) => r.lengthM ?? 0));
  const riserTop = (r: Riser) =>
    r.lengthM && maxLen ? bottomY - ((bottomY - TOP + 20) * r.lengthM) / maxLen : bottomY;
  const hasRisers = maxLen > 0;
  const allLinked = hasRisers && rows.length > 0 && rows.every((f) => links[f.id] !== undefined);
  const floorY = (i: number) => TOP + i * ROW + 40;

  function connect(floor: Floor, i: number) {
    if (props.readOnly) return;
    const y = floorY(i);
    const reaching = risers
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.lengthM && riserTop(r) <= y - 20);
    if (reaching.length === 0) {
      notice(`No riser reaches ${floor.name} - increase a riser length.`);
      return;
    }
    const current = links[floor.id];
    const pos = reaching.findIndex((x) => x.idx === current);
    const next = reaching[(pos + 1) % reaching.length]!.idx;
    setLinks((l) => ({ ...l, [floor.id]: next }));
    setSized(false);
  }

  const status = (f: Floor, discipline: 'elec' | 'mech' | 'phe'): StatusIcon =>
    discipline === 'elec' && f.plan ? 'pill' : 'cross';

  return (
    <div className="building-tab">
      <div className="building-canvas" aria-label="Building view">
        <svg
          width={(BOARD_X + 60) * props.zoom}
          height={(bottomY + 40) * props.zoom}
          viewBox={`0 0 ${BOARD_X + 60} ${bottomY + 40}`}
          role="img"
          aria-label="Riser diagram"
        >
          {rows.map((f, i) => {
            const y = floorY(i);
            const riser = links[f.id];
            return (
              <g key={f.id}>
                <line x1={RISER_X[2]! + 24} y1={y} x2={BOARD_X} y2={y} className="floor-line" />
                <text x={(RISER_X[2]! + BOARD_X) / 2} y={y - 5} className="floor-label">
                  {f.name}
                </text>
                {riser !== undefined && (
                  <path
                    className="riser-link"
                    d={`M ${RISER_X[riser]! + 6} ${y - 28} H ${BOARD_X + 16} V ${y - 8}`}
                  />
                )}
                <g
                  className="floor-board"
                  role="button"
                  aria-label={`${f.name} board`}
                  onClick={() => connect(f, i)}
                >
                  <rect x={BOARD_X} y={y - 9} width="32" height="16" />
                  <line x1={BOARD_X} y1={y + 7} x2={BOARD_X + 32} y2={y - 9} />
                </g>
              </g>
            );
          })}
          {risers.map((r, idx) =>
            r.lengthM ? (
              <rect
                key={idx}
                className="riser"
                x={RISER_X[idx]}
                y={riserTop(r)}
                width="9"
                height={bottomY - riserTop(r)}
                aria-label={`Riser ${idx + 1}`}
              />
            ) : null,
          )}
          {hasRisers && (
            <g aria-label="Transformer">
              <line
                x1="60"
                y1={bottomY}
                x2={RISER_X[2]! + 9}
                y2={bottomY}
                className="source-link"
              />
              <rect x="20" y={bottomY - 18} width="36" height="36" rx="6" className="tx-box" />
              <text x="38" y={bottomY + 5} className="tx-text">
                Tx
              </text>
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
            {props.floors.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name} :</th>
                <td>
                  <StatusMark status={status(f, 'elec')} size={16} />
                </td>
                <td>
                  <StatusMark status={status(f, 'mech')} size={16} />
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
              <tr key={i}>
                <th scope="row">Riser {i + 1}</th>
                {(['lengthM', 'widthM'] as const).map((k) => (
                  <td key={k}>
                    <NumberInput
                      className="riser-input"
                      ariaLabel={`Riser ${i + 1} ${k === 'lengthM' ? 'length' : 'width'}`}
                      value={r[k]}
                      disabled={props.readOnly}
                      onChange={(v) => {
                        setRisers((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                        setSized(false);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className={`summary-btn${allLinked ? ' ready' : ''}`}
          disabled={!allLinked || props.readOnly}
          title={
            allLinked
              ? undefined
              : 'Connect the transformer and every floor to a riser first (A-07)'
          }
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
            onClick={() => notice('Riser design is stored in the project with WBS 1.4.')}
          >
            Save
          </button>
          <button
            className="summary-btn"
            onClick={() => {
              setLinks({});
              setSized(false);
            }}
          >
            Cancel
          </button>
        </div>
        {sized && (
          <button
            className="summary-btn demand-btn"
            disabled
            title="Purpose to be confirmed by the Technical Lead"
          >
            Demand Factors
          </button>
        )}
      </aside>
    </div>
  );
}
