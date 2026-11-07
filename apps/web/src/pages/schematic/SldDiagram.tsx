import { KIND_LABELS, type Project, type SldNode } from '@neuromep/shared';
import { forwardRef } from 'react';

/**
 * Layout (SVG units): the source at the top and the network as a tree below it - each board
 * under the board that feeds it (manager feedback, 7 Nov 2026: e.g. Tx > EMDB > ESMDB > EDB).
 */
const NODE_W = 190;
const BOX_W = 150;
const BOX_H = 30;
const LEVEL_H = 96;
const TOP = 34;
const FOOT = 30;
const INK = '#1f2937';
const MUTED = '#4b5563';
const ACCENT = '#b45309';
const text = { fontSize: 8, fill: INK, fontFamily: 'Helvetica, Arial, sans-serif' } as const;
const small = { ...text, fontSize: 6, fill: MUTED } as const;

/** Feeder label: circuit reference, breaker and size, or the riser it hangs on. */
function viaLabel(project: Project, via: SldNode['via']): string {
  if (!via) return '';
  if (via.kind === 'riser') return `Riser ${via.riser} tap-off`;
  const r = project.model.results.find((x) => x.elementId === via.cable.id);
  const kind = via.cable.feederType === 'busbar' ? 'busbar' : via.cable.construction.cores;
  const size = r?.size ? `${r.size.runs} x ${r.size.sizeMm2} mm²` : 'size -';
  const breaker = r?.device ? `${r.device.ratingA} A ${r.device.type}` : 'breaker -';
  return `${via.cable.circuitRef} · ${breaker} · ${kind} ${size}`;
}

interface Placed {
  node: SldNode;
  x: number;
  y: number;
  depth: number;
}

/** Positions of the tree: leaves side by side, a parent centred over its children. */
function layout(root: SldNode): { placed: Placed[]; width: number; depth: number } {
  const placed: Placed[] = [];
  let next = 0;
  let deepest = 0;
  const place = (n: SldNode, depth: number): number => {
    deepest = Math.max(deepest, depth);
    let x: number;
    if (n.children.length === 0) {
      x = next * NODE_W + NODE_W / 2;
      next += 1;
    } else {
      const xs = n.children.map((c) => place(c, depth + 1));
      x = (xs[0]! + xs.at(-1)!) / 2;
    }
    placed.push({ node: n, x, y: TOP + depth * LEVEL_H, depth });
    return x;
  };
  place(root, 0);
  return { placed, width: Math.max(1, next) * NODE_W, depth: deepest };
}

/**
 * Single-line diagram of one transformer (Figma screen 4, Section 14; tree layout after the
 * manager's feedback of 7 Nov 2026): the transformer at the top, every board under the board or
 * riser that feeds it, the feeder's way, breaker and size on the line into it, and any other
 * supply of a board (a generator, a second incomer, a riser) drawn as an extra incomer beside it.
 * Ratings and sizes show '-' until Cable Size has run.
 */
export const SldDiagram = forwardRef<
  SVGSVGElement,
  { project: Project; tree: SldNode; zoom: number }
>(function SldDiagram({ project, tree, zoom }, ref) {
  const { placed, width: treeW, depth } = layout(tree);
  const width = treeW + 40;
  const height = TOP + depth * LEVEL_H + BOX_H + FOOT + 30;
  const at = new Map(placed.map((p) => [p.node, p]));
  const tx = tree.element;
  const kva = tx.kind === 'transformer' && tx.kva ? `${tx.kva} kVA` : '';
  const ox = 20; // left margin

  return (
    <svg
      ref={ref}
      width={width * zoom}
      height={height * zoom}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Single-line diagram from ${tx.tag}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      {tree.children.length === 0 && (
        <text x={ox} y={TOP + BOX_H + 30} {...text}>
          {tx.tag} feeds nothing yet - draw feeders on Floor Setup or connect a riser.
        </text>
      )}
      {placed.map(({ node, x, y }) => {
        const cx = ox + x;
        const kids = node.children.map((c) => at.get(c)!);
        const busY = y + BOX_H + 22;
        return (
          <g key={`edges-${node.element.id}`}>
            {kids.length > 0 && (
              <>
                <line x1={cx} y1={y + BOX_H} x2={cx} y2={busY} stroke={INK} strokeWidth={1.5} />
                <line
                  x1={ox + Math.min(cx, ...kids.map((k) => k.x))}
                  y1={busY}
                  x2={ox + Math.max(cx, ...kids.map((k) => k.x))}
                  y2={busY}
                  stroke={INK}
                  strokeWidth={2}
                />
              </>
            )}
            {kids.map((k) => (
              <g key={k.node.element.id}>
                <line
                  x1={ox + k.x}
                  y1={busY}
                  x2={ox + k.x}
                  y2={k.y}
                  stroke={INK}
                  strokeDasharray={k.node.via?.kind === 'riser' ? '4 2' : undefined}
                />
                {/* the outgoing way's breaker */}
                <rect x={ox + k.x - 4} y={busY + 6} width={8} height={8} fill="#fff" stroke={INK} />
                <line
                  x1={ox + k.x - 3}
                  y1={busY + 7}
                  x2={ox + k.x + 3}
                  y2={busY + 13}
                  stroke={INK}
                />
                <text x={ox + k.x + 7} y={busY + 13} {...small}>
                  {viaLabel(project, k.node.via)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {placed.map(({ node, x, y }) => {
        const cx = ox + x;
        const e = node.element;
        const isRoot = node === tree;
        return (
          <g key={e.id} role="group" aria-label={`${e.tag} (${KIND_LABELS[e.kind]})`}>
            {node.incomers.map((inc, i) => {
              const iy = y - 8 - i * 10;
              return (
                <g
                  key={`${inc.from.id}-${i}`}
                  role="group"
                  aria-label={`${e.tag} also fed from ${inc.from.tag}`}
                >
                  <line
                    x1={cx - BOX_W / 2 - 4}
                    y1={y + BOX_H / 2}
                    x2={cx - BOX_W / 2 - 4}
                    y2={iy + 3}
                    stroke={ACCENT}
                    strokeDasharray="3 2"
                  />
                  <text x={cx - BOX_W / 2 - 2} y={iy} {...small} fill={ACCENT}>
                    {`also fed from ${inc.from.tag}${inc.via.kind === 'feeder' && inc.via.cable.to.port === 'standby' ? ' (standby)' : ''} · ${viaLabel(project, inc.via)}`}
                  </text>
                </g>
              );
            })}
            {isRoot && e.kind === 'transformer' ? (
              <>
                <circle cx={cx - 8} cy={y + BOX_H / 2} r={9} fill="none" stroke={INK} />
                <circle cx={cx + 6} cy={y + BOX_H / 2} r={9} fill="none" stroke={INK} />
                <line x1={cx} y1={y + BOX_H / 2 + 9} x2={cx} y2={y + BOX_H} stroke={INK} />
                <text x={cx + 20} y={y + 12} {...text} fontWeight="bold">
                  {e.tag}
                </text>
                <text x={cx + 20} y={y + 21} {...small}>
                  {[KIND_LABELS[e.kind], kva].filter(Boolean).join(' · ')}
                </text>
              </>
            ) : (
              <>
                <rect
                  x={cx - BOX_W / 2}
                  y={y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={3}
                  fill="#fff"
                  stroke={INK}
                />
                <text x={cx} y={y + 13} textAnchor="middle" {...text} fontWeight="bold">
                  {e.tag}
                </text>
                <text x={cx} y={y + 23} textAnchor="middle" {...small}>
                  {KIND_LABELS[e.kind]}
                </text>
              </>
            )}
          </g>
        );
      })}
      <text x={10} y={height - 8} {...small}>
        {project.details.name} · Single-line diagram from {tx.tag} · ratings and sizes from the last
        Cable Size run
      </text>
    </svg>
  );
});
