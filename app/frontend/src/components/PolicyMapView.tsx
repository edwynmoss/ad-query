// The policy map: the directory's containers drawn as a layered tree in
// SVG, laid out by d3-hierarchy. Nodes are text on a hairline, edges are
// thin ink lines, and the policies linked at a node sit under its name.
// Clicking a node selects it; the path from the root to it is drawn heavier.
import { useMemo } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { gpo } from "../../wailsjs/go/models";

interface Props {
  map: gpo.Map;
  selectedDN: string | null;
  onSelect: (dn: string) => void;
}

interface N { node: gpo.MapNode; children: N[] }

const ROW = 22;       // vertical space per node row
const COL = 230;      // horizontal space per depth
const PAD = 24;
const LINE = 18;      // vertical space per text line inside a node

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function PolicyMapView({ map, selectedDN, onSelect }: Props) {
  const laid = useMemo(() => {
    const byDN = new Map<string, N>();
    for (const n of map.nodes ?? []) byDN.set(n.dn.toLowerCase(), { node: n, children: [] });
    let root: N | null = null;
    for (const n of byDN.values()) {
      const p = n.node.parentDN ? byDN.get(n.node.parentDN.toLowerCase()) : undefined;
      if (p) p.children.push(n); else if (!root || n.node.kind === "site") root = n;
    }
    if (!root) return null;
    // Each node needs room for its name plus its policy lines.
    const linesOf = (n: N) => 1 + (n.node.links?.length ?? 0) + (n.node.blockInheritance ? 1 : 0);
    const h = hierarchy<N>(root, (d) => d.children);
    const layout = tree<N>().nodeSize([ROW, COL]).separation((a, b) => {
      const need = (linesOf(a.data) + linesOf(b.data)) / 2 + 0.6;
      return a.parent === b.parent ? need : need + 0.4;
    });
    const pointed = layout(h);
    let minX = Infinity, maxX = -Infinity, maxDepth = 0;
    pointed.each((d) => { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x + linesOf(d.data) * LINE); maxDepth = Math.max(maxDepth, d.depth); });
    return { pointed, minX, maxX, maxDepth };
  }, [map]);

  if (!laid) return <p className="ledger-note">No containers to draw.</p>;
  const { pointed, minX, maxX, maxDepth } = laid;
  const width = PAD * 2 + (maxDepth + 1) * COL;
  const height = PAD * 2 + (maxX - minX) + ROW;
  const ox = PAD, oy = PAD - minX;

  // Path from root to the selected node, for the heavier line.
  const onPath = new Set<string>();
  if (selectedDN) {
    let cur: HierarchyPointNode<N> | null = pointed.descendants().find((d) => d.data.node.dn === selectedDN) ?? null;
    while (cur) { onPath.add(cur.data.node.dn); cur = cur.parent; }
  }

  const nodes: HierarchyPointNode<N>[] = [];
  pointed.each((d) => nodes.push(d));
  const policyName = (dn: string) => map.policies?.[dn.toLowerCase()]?.name ?? dn.split(",")[0].replace(/^CN=/i, "");

  return (
    <div className="ledger-map-scroll">
      <svg className="ledger-map" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Policy map">
        {nodes.filter((d) => d.parent).map((d) => {
          const p = d.parent!;
          // A short stub leaves the parent row just before the child column,
          // runs down a bus and into the child's dot, so it never crosses the
          // parent's own text.
          const bus = ox + d.depth * COL - 22, y1 = oy + p.x;
          const x2 = ox + d.depth * COL - 10, y2 = oy + d.x;
          const heavy = onPath.has(d.data.node.dn) && onPath.has(p.data.node.dn);
          return <path key={d.data.node.dn} className={"ledger-map-edge" + (heavy ? " is-on" : "")} d={`M${bus - 12},${y1} H${bus} V${y2} H${x2}`} />;
        })}
        {nodes.map((d) => {
          const n = d.data.node;
          const x = ox + d.depth * COL, y = oy + d.x;
          const sel = n.dn === selectedDN;
          const on = onPath.has(n.dn);
          return (
            <g key={n.dn} className={"ledger-map-node" + (sel ? " is-sel" : "") + (on ? " is-on" : "")} transform={`translate(${x},${y})`} onClick={() => onSelect(n.dn)} style={{ cursor: "pointer" }}>
              <rect className="ledger-map-hit" x={-10} y={-12} width={COL - 36} height={LINE * (1 + (n.links?.length ?? 0) + (n.blockInheritance ? 1 : 0)) + 6} fill="transparent" />
              <circle cx={0} cy={0} r={4.5} className="ledger-map-dot" />
              <text x={12} y={4}>
                <tspan className={"ledger-map-name" + (n.kind === "domain" ? " mono" : "")}>{cut(n.name, 22)}</tspan>
                <tspan className="ledger-map-kind" dx={7}>{n.kind}{n.users || n.computers ? ` · ${[n.users ? `${n.users}u` : "", n.computers ? `${n.computers}c` : ""].filter(Boolean).join(" ")}` : ""}</tspan>
              </text>
              {n.blockInheritance && <text x={12} y={4 + LINE} className="ledger-map-pol is-warn">blocks inheritance from above</text>}
              {(n.links ?? []).map((l, i) => (
                <text key={l.policyDN + i} x={12} y={4 + (i + 1 + (n.blockInheritance ? 1 : 0)) * LINE} className={"ledger-map-pol" + (l.disabled ? " is-out" : "")}>
                  {cut(policyName(l.policyDN), 28)}{l.enforced ? "  enforced" : ""}{l.disabled ? "  link disabled" : ""}
                </text>
              ))}
              <title>{n.dn}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
