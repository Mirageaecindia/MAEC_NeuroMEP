import { resultOf, type Project, type SldNode } from '@neuromep/shared';
import { forwardRef } from 'react';

/** Layout (SVG units): a column per board with outgoing ways, a row per way. */
const COL_W = 210;
const ROW_H = 22;
const TOP = 30;
const BAR_GAP = 40;
const FOOT = 110;
const INK = '#1f2937';
const MUTED = '#4b5563';
const text = { fontSize: 8, fill: INK, fontFamily: 'Helvetica, Arial, sans-serif' } as const;
const small = { ...text, fontSize: 6, fill: MUTED } as const;

/** Boards that feed something, top-down; the transformer itself only when it feeds a load directly. */
function columns(root: SldNode): SldNode[] {
  const out: SldNode[] = [];
  const walk = (n: SldNode) => {
    if (n.children.length > 0 && (n !== root || n.children.some((c) => !c.children.length))) {
      out.push(n);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Way label: circuit reference and size of the feeder, or the riser it hangs on. */
function wayLabel(project: Project, n: SldNode): string {
  if (!n.via) return '';
  if (n.via.kind === 'riser') return `Riser ${n.via.riser} tap-off`;
  const r = resultOf(project, n.via.cable.id)?.result;
  const kind = n.via.cable.feederType === 'busbar' ? 'busbar' : n.via.cable.construction.cores;
  const size = r?.size ? `${r.size.runs} x ${r.size.sizeMm2} mm²` : 'size -';
  const breaker = r?.device ? `${r.device.ratingA} A ${r.device.type}` : 'breaker -';
  return `${n.via.cable.circuitRef} · ${breaker} · ${kind} ${size}`;
}

/**
 * Single-line diagram of one transformer (Figma screen 4, Section 14): the transformer at the
 * bottom, a bus bar to each board, and each board's outgoing ways with breaker, way and size.
 * Ratings and sizes show '-' until Cable Size has run (WBS 1.6).
 */
export const SldDiagram = forwardRef<
  SVGSVGElement,
  { project: Project; tree: SldNode; zoom: number }
>(function SldDiagram({ project, tree, zoom }, ref) {
  const cols = columns(tree);
  const rows = Math.max(1, ...cols.map((c) => c.children.length));
  const width = Math.max(1, cols.length) * COL_W + 60;
  const busBottom = TOP + rows * ROW_H + 10;
  const barY = busBottom + BAR_GAP;
  const height = barY + FOOT;
  const colX = (i: number) => 60 + i * COL_W;
  const tx = tree.element;
  const kva = tx.kind === 'transformer' && tx.kva ? `${tx.kva} kVA` : 'kVA -';
  const midX = width / 2;

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
      {cols.length === 0 && (
        <text x={midX} y={TOP} textAnchor="middle" {...text}>
          {tx.tag} feeds nothing yet - draw feeders on Floor Setup or connect a riser.
        </text>
      )}
      {cols.map((col, i) => {
        const x = colX(i);
        return (
          <g key={col.element.id} role="group" aria-label={`${col.element.tag} outgoing ways`}>
            <text x={x} y={TOP - 12} {...text} fontWeight="bold">
              {col === tree ? `${col.element.tag} secondary` : col.element.tag}
            </text>
            <line x1={x} y1={TOP - 6} x2={x} y2={busBottom} stroke={INK} strokeWidth={2} />
            {col.children.map((child, r) => {
              const y = TOP + r * ROW_H;
              return (
                <g key={child.element.id}>
                  <rect x={x - 5} y={y} width={10} height={10} fill="#fff" stroke={INK} />
                  <line x1={x - 4} y1={y + 1} x2={x + 4} y2={y + 9} stroke={INK} />
                  <line x1={x + 5} y1={y + 5} x2={x + 60} y2={y + 5} stroke={INK} />
                  <text x={x + 64} y={y + 6} {...text}>
                    {child.element.tag}
                  </text>
                  <text x={x + 64} y={y + 13} {...small}>
                    {wayLabel(project, child)}
                  </text>
                </g>
              );
            })}
            <line x1={x} y1={busBottom} x2={x} y2={barY} stroke={INK} />
          </g>
        );
      })}
      {/* Main bus bar and transformer */}
      {cols.length > 0 && (
        <>
          <line
            x1={Math.min(colX(0), midX)}
            y1={barY}
            x2={Math.max(colX(cols.length - 1), midX)}
            y2={barY}
            stroke={INK}
            strokeWidth={3}
          />
          <line x1={midX} y1={barY} x2={midX} y2={barY + 30} stroke={INK} />
        </>
      )}
      <circle cx={midX} cy={barY + 40} r={10} fill="none" stroke={INK} />
      <circle cx={midX} cy={barY + 54} r={10} fill="none" stroke={INK} />
      <text x={midX + 18} y={barY + 46} {...text} fontWeight="bold">
        {tx.tag}
      </text>
      <text x={midX + 18} y={barY + 56} {...small}>
        {kva}
      </text>
      <text x={10} y={height - 8} {...small}>
        {project.details.name} · Single-line diagram from {tx.tag} · ratings and sizes from the last
        Cable Size run
      </text>
    </svg>
  );
});
