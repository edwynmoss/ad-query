// The tree: the directory's containers drawn as a layered tree in SVG, laid
// out by d3-hierarchy. It opens on the containers that link or block policy;
// branches with nothing linked are folded into "n more" and open on click.
// Nodes are text on a hairline, edges thin ink lines. Clicking a node hands
// its DN to the parent.
import { useMemo } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { gpo } from "../../wailsjs/go/models";

interface Props {
  map: gpo.Map;
  expanded: Set<string>;          // lower-case DNs whose folded children are shown
  onToggle: (dn: string) => void;
  revealDN?: string | null;       // a container to show even if folded away
  selectedDN?: string | null;
  onSelect: (dn: string) => void;
  showAll?: boolean;
}

interface N { node: gpo.MapNode | null; fold?: { parentDN: string; count: number; open: boolean }; children: N[] }

const LINE = 18;
const COL = 240;
const PAD = 24;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function PolicyMapView({ map, expanded, onToggle, revealDN, selectedDN, onSelect, showAll }: Props) {
  const laid = useMemo(() => {
    const all = map.nodes ?? [];
    const byDN = new Map<string, gpo.MapNode>();
    const kids = new Map<string, gpo.MapNode[]>();
    for (const n of all) byDN.set(n.dn.toLowerCase(), n);
    for (const n of all) {
      const p = n.parentDN?.toLowerCase() ?? "";
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(n);
    }
    // Ancestors of the revealed container are always shown.
    const reveal = new Set<string>();
    if (revealDN) {
      let cur: gpo.MapNode | undefined = byDN.get(revealDN.toLowerCase());
      while (cur) { reveal.add(cur.dn.toLowerCase()); cur = cur.parentDN ? byDN.get(cur.parentDN.toLowerCase()) : undefined; }
    }
    const visible = (n: gpo.MapNode) => !!showAll || n.relevant || reveal.has(n.dn.toLowerCase()) || expanded.has((n.parentDN ?? "").toLowerCase());
    const build = (n: gpo.MapNode): N => {
      const children = (kids.get(n.dn.toLowerCase()) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const shown = children.filter(visible);
      const hidden = children.length - shown.length;
      const out: N = { node: n, children: shown.map(build) };
      const open = expanded.has(n.dn.toLowerCase());
      if (hidden > 0 || (open && !showAll && children.some((c) => !c.relevant))) {
        out.children.push({ node: null, fold: { parentDN: n.dn, count: hidden, open }, children: [] });
      }
      return out;
    };
    const roots = all.filter((n) => !n.parentDN || !byDN.has(n.parentDN.toLowerCase()));
    const root = roots.find((n) => n.kind === "site") ?? roots.find((n) => n.kind === "domain") ?? roots[0];
    if (!root) return null;
    const linesOf = (n: N) => (n.node ? 1 + (n.node.links?.length ?? 0) + (n.node.blockInheritance ? 1 : 0) : 1);
    const h = hierarchy<N>(build(root), (d) => d.children);
    const layout = tree<N>().nodeSize([LINE, COL]).separation((a, b) => (linesOf(a.data) + linesOf(b.data)) / 2 + (a.parent === b.parent ? 0.7 : 1.1));
    const pointed = layout(h);
    let minX = Infinity, maxX = -Infinity, maxDepth = 0;
    pointed.each((d) => { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x + linesOf(d.data) * LINE); maxDepth = Math.max(maxDepth, d.depth); });
    return { pointed, minX, maxX, maxDepth };
  }, [map, expanded, revealDN, showAll]);

  if (!laid) return <p className="ledger-note">No containers to draw.</p>;
  const { pointed, minX, maxX, maxDepth } = laid;
  const width = PAD * 2 + (maxDepth + 2) * COL; // room for the deepest labels
  const height = PAD * 2 + (maxX - minX) + LINE;
  const ox = PAD, oy = PAD - minX;

  const onPath = new Set<string>();
  if (selectedDN) {
    let cur: HierarchyPointNode<N> | null = pointed.descendants().find((d) => d.data.node?.dn === selectedDN) ?? null;
    while (cur) { if (cur.data.node) onPath.add(cur.data.node.dn); cur = cur.parent; }
  }
  const nodes: HierarchyPointNode<N>[] = pointed.descendants();
  const policyName = (dn: string) => map.policies?.[dn.toLowerCase()]?.name ?? dn.split(",")[0].replace(/^CN=/i, "");

  return (
    <div className="ledger-map-scroll">
      <svg className="ledger-map" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Policy map">
        {nodes.filter((d) => d.parent).map((d, i) => {
          const p = d.parent!;
          const bus = ox + d.depth * COL - 24, y1 = oy + p.x;
          const x2 = ox + d.depth * COL - 10, y2 = oy + d.x;
          const heavy = !!d.data.node && onPath.has(d.data.node.dn) && !!p.data.node && onPath.has(p.data.node.dn);
          return <path key={(d.data.node?.dn ?? "fold") + i} className={"ledger-map-edge" + (heavy ? " is-on" : "") + (d.data.fold ? " is-fold" : "")} d={`M${bus - 12},${y1} H${bus} V${y2} H${x2}`} />;
        })}
        {nodes.map((d, i) => {
          const x = ox + d.depth * COL, y = oy + d.x;
          if (d.data.fold) {
            const f = d.data.fold;
            return (
              <g key={"fold" + i} className="ledger-map-fold" transform={`translate(${x},${y})`} onClick={() => onToggle(f.parentDN)} style={{ cursor: "pointer" }}>
                <rect x={-10} y={-12} width={COL - 40} height={LINE + 4} fill="transparent" />
                <text x={12} y={4}>{f.open ? "fewer" : `${f.count} more ${f.count === 1 ? "container" : "containers"} with nothing linked`}</text>
              </g>
            );
          }
          const n = d.data.node!;
          const sel = n.dn === selectedDN;
          const on = onPath.has(n.dn);
          const lines = (n.links?.length ?? 0) + (n.blockInheritance ? 1 : 0);
          return (
            <g key={n.dn} className={"ledger-map-node" + (sel ? " is-sel" : "") + (on ? " is-on" : "") + (n.relevant ? "" : " is-quiet")} transform={`translate(${x},${y})`} onClick={() => onSelect(n.dn)} style={{ cursor: "pointer" }}>
              <rect className="ledger-map-hit" x={-10} y={-12} width={COL - 36} height={LINE * (1 + lines) + 6} fill="transparent" />
              <circle cx={0} cy={0} r={4.5} className="ledger-map-dot" />
              <text x={12} y={4}>
                <tspan className={"ledger-map-name" + (n.kind === "domain" ? " mono" : "")}>{cut(n.name, 24)}</tspan>
                <tspan className="ledger-map-kind" dx={7}>{n.kind === "ou" ? "" : n.kind}</tspan>
              </text>
              {n.blockInheritance && <text x={12} y={4 + LINE} className="ledger-map-pol is-warn">blocks inheritance from above</text>}
              {(n.links ?? []).map((l, j) => (
                <text key={l.policyDN + j} x={12} y={4 + (j + 1 + (n.blockInheritance ? 1 : 0)) * LINE} className={"ledger-map-pol" + (l.disabled ? " is-out" : "")}>
                  {cut(policyName(l.policyDN), 30)}{l.enforced ? ", enforced" : ""}{l.disabled ? ", link switched off" : ""}
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
