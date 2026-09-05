// The tree: the directory's containers laid out left to right by dagre and
// drawn with React Flow, kept quiet: text nodes, thin ink edges, no minimap,
// no dragging, pan and zoom only. It opens on the containers that link or
// block policy; branches with nothing linked fold into "n more" and open on
// click. Clicking a container hands its DN to the parent.
import { useEffect, useMemo } from "react";
import { ReactFlow, ReactFlowProvider, Handle, Position, useReactFlow, type Node, type Edge, type NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
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

type ContainerData = { node: gpo.MapNode; lines: string[]; onPath: boolean; selected: boolean; kindLabel: string; policies: { text: string; off: boolean }[] };
type FoldData = { parentDN: string; count: number; open: boolean };

const LINE = 18;
// Node width follows its text so edges leave from where the words end.
const est = (t: string, size: number) => Math.ceil(t.length * size * 0.56);
const widthOf = (name: string, kind: string, policies: string[], block: boolean) =>
  Math.min(300, Math.max(120, 36 + Math.max(est(name, 12.5) + (kind ? est(kind, 9.5) + 12 : 0), ...policies.map((p) => est(p, 11.5)), block ? est("blocks inheritance from above", 11.5) : 0)));
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function ContainerNode({ data }: NodeProps<Node<ContainerData>>) {
  const n = data.node;
  return (
    <div className={"ledger-map-node" + (data.selected ? " is-sel" : "") + (data.onPath ? " is-on" : "") + (n.relevant ? "" : " is-quiet")} title={n.dn}>
      {/* Edges land on the dot and leave from the end of the title. */}
      <Handle type="target" position={Position.Left} className="ledger-map-handle" style={{ left: 5, top: 15, transform: "none" }} />
      <span className="ledger-map-dot" />
      <div className="ledger-map-text">
        <div className="ledger-map-title">
          <span className={"ledger-map-name" + (n.kind === "domain" ? " mono" : "")}>{cut(n.name, 26)}</span>
          {data.kindLabel && <span className="ledger-map-kind">{data.kindLabel}</span>}
          <Handle type="source" position={Position.Right} className="ledger-map-handle" style={{ right: -14, top: "50%", left: "auto" }} />
        </div>
        {n.blockInheritance && <div className="ledger-map-pol is-warn">blocks inheritance from above</div>}
        {data.policies.map((p, i) => <div key={i} className={"ledger-map-pol" + (p.off ? " is-out" : "")}>{p.text}</div>)}
      </div>
    </div>
  );
}

function FoldNode({ data }: NodeProps<Node<FoldData>>) {
  return (
    <div className="ledger-map-fold">
      <Handle type="target" position={Position.Left} className="ledger-map-handle" style={{ left: 5, top: "50%" }} />
      {data.open ? "fewer" : `${data.count} more ${data.count === 1 ? "container" : "containers"} with nothing linked`}
    </div>
  );
}

const nodeTypes = { container: ContainerNode, fold: FoldNode };

export function PolicyMapView(props: Props) {
  return (
    <ReactFlowProvider>
      <Tree {...props} />
    </ReactFlowProvider>
  );
}

function Tree({ map, expanded, onToggle, revealDN, selectedDN, onSelect, showAll }: Props) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const all = map.nodes ?? [];
    const byDN = new Map<string, gpo.MapNode>();
    const kids = new Map<string, gpo.MapNode[]>();
    for (const n of all) byDN.set(n.dn.toLowerCase(), n);
    for (const n of all) {
      const p = n.parentDN?.toLowerCase() ?? "";
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(n);
    }
    const reveal = new Set<string>();
    if (revealDN) {
      let cur: gpo.MapNode | undefined = byDN.get(revealDN.toLowerCase());
      while (cur) { reveal.add(cur.dn.toLowerCase()); cur = cur.parentDN ? byDN.get(cur.parentDN.toLowerCase()) : undefined; }
    }
    const onPath = new Set<string>();
    if (selectedDN) {
      let cur: gpo.MapNode | undefined = byDN.get(selectedDN.toLowerCase());
      while (cur) { onPath.add(cur.dn.toLowerCase()); cur = cur.parentDN ? byDN.get(cur.parentDN.toLowerCase()) : undefined; }
    }
    const visible = (n: gpo.MapNode) => !!showAll || n.relevant || reveal.has(n.dn.toLowerCase()) || expanded.has((n.parentDN ?? "").toLowerCase());
    const policyName = (dn: string) => map.policies?.[dn.toLowerCase()]?.name ?? dn.split(",")[0].replace(/^CN=/i, "");

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 44, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    const roots = all.filter((n) => !n.parentDN || !byDN.has(n.parentDN.toLowerCase()));
    const root = roots.find((n) => n.kind === "site") ?? roots.find((n) => n.kind === "domain") ?? roots[0];
    if (!root) return { nodes: rfNodes, edges: rfEdges };

    const walk = (n: gpo.MapNode) => {
      const key = n.dn.toLowerCase();
      const policies = (n.links ?? []).map((l) => ({ text: cut(policyName(l.policyDN), 30) + (l.enforced ? ", enforced" : "") + (l.disabled ? ", link switched off" : ""), off: l.disabled }));
      const lines = 1 + policies.length + (n.blockInheritance ? 1 : 0);
      const height = 10 + lines * LINE + 6;
      const kindLabel = n.kind === "ou" ? "" : n.kind;
      const width = widthOf(cut(n.name, 26), kindLabel, policies.map((p) => p.text), n.blockInheritance);
      g.setNode(key, { width, height });
      rfNodes.push({ id: key, type: "container", position: { x: 0, y: 0 }, width, height, data: { node: n, lines: [], onPath: onPath.has(key), selected: selectedDN?.toLowerCase() === key, kindLabel, policies } as ContainerData, draggable: false, selectable: false });
      const children = (kids.get(key) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const shown = children.filter(visible);
      const hidden = children.length - shown.length;
      for (const c of shown) {
        walk(c);
        const ck = c.dn.toLowerCase();
        g.setEdge(key, ck);
        const heavy = onPath.has(key) && onPath.has(ck);
        rfEdges.push({ id: key + ">" + ck, source: key, target: ck, type: "smoothstep", className: "ledger-map-edge" + (heavy ? " is-on" : ""), pathOptions: { borderRadius: 6 } } as Edge);
      }
      const open = expanded.has(key);
      if (hidden > 0 || (open && !showAll && children.some((c) => !c.relevant))) {
        const fk = key + "#fold";
        const fw = 40 + est(`${hidden} more containers with nothing linked`, 11.5);
        g.setNode(fk, { width: fw, height: 24 });
        rfNodes.push({ id: fk, type: "fold", position: { x: 0, y: 0 }, width: fw, height: 24, data: { parentDN: n.dn, count: hidden, open } as FoldData, draggable: false, selectable: false });
        g.setEdge(key, fk);
        rfEdges.push({ id: key + ">" + fk, source: key, target: fk, type: "smoothstep", className: "ledger-map-edge is-fold", pathOptions: { borderRadius: 6 } } as Edge);
      }
    };
    walk(root);
    dagre.layout(g);
    // dagre centres nodes within a rank; the ledger wants each column's
    // text to start on one line, so left-align every rank on its widest node.
    const rankLeft = new Map<number, number>();
    for (const n of rfNodes) {
      const p = g.node(n.id);
      const cx = Math.round(p.x);
      rankLeft.set(cx, Math.min(rankLeft.get(cx) ?? Infinity, p.x - (n.width ?? 200) / 2));
    }
    for (const n of rfNodes) {
      const p = g.node(n.id);
      n.position = { x: rankLeft.get(Math.round(p.x)) ?? p.x - (n.width ?? 200) / 2, y: p.y - (n.height ?? 24) / 2 };
    }
    return { nodes: rfNodes, edges: rfEdges };
  }, [map, expanded, revealDN, selectedDN, showAll]);

  // Fit once the nodes have been measured; a second pass catches late layout.
  const shape = nodes.map((n) => n.id).join("|");
  useEffect(() => {
    const a = setTimeout(() => fitView({ padding: 0.1, maxZoom: 1 }), 60);
    const b = setTimeout(() => fitView({ padding: 0.1, maxZoom: 1, duration: 150 }), 260);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [shape, fitView]);

  if (nodes.length === 0) return <p className="ledger-note">No containers to draw.</p>;

  return (
    <div className="ledger-map" role="img" aria-label="Policy map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.25}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          if (n.type === "fold") onToggle((n.data as FoldData).parentDN);
          else onSelect((n.data as ContainerData).node.dn);
        }}
      />
    </div>
  );
}
