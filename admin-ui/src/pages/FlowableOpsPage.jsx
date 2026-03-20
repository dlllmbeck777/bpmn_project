import { useState, useEffect, useMemo } from "react";
import { get, post } from '../lib/api';

/* ─── Process Activities (fallback, overridden from /api/v1/process-model) ─── */
const FALLBACK_ACTIVITIES = [
  { id: "startEvent",                   label: "Start",         type: "event"   },
  { id: "task_init",                    label: "Init Context",  type: "script"  },
  { id: "gateway_iso",                  label: "Skip ISP?",     type: "gateway" },
  { id: "task_isoftpull",               label: "iSoftPull",     type: "http"    },
  { id: "task_parse_iso",               label: "Parse ISP",     type: "script"  },
  { id: "task_prepare_creditsafe_body", label: "Prep CS",       type: "script"  },
  { id: "gateway_cs",                   label: "Skip CS?",      type: "gateway" },
  { id: "task_creditsafe",              label: "Creditsafe",    type: "http"    },
  { id: "task_parse_cs",                label: "Parse CS",      type: "script"  },
  { id: "task_prepare_plaid_body",      label: "Prep Plaid",    type: "script"  },
  { id: "gateway_plaid",                label: "Skip Plaid?",   type: "gateway" },
  { id: "task_plaid",                   label: "Plaid",         type: "http"    },
  { id: "task_parse_plaid",             label: "Parse Plaid",   type: "script"  },
  { id: "task_prepare_decision_body",   label: "Prep Decision", type: "script"  },
  { id: "task_decision_service",        label: "Decision",      type: "http"    },
  { id: "task_parse_decision",          label: "Parse Decision",type: "script"  },
  { id: "endEvent",                     label: "End",           type: "event"   },
];

const STATUSES = ["COMPLETED", "RUNNING", "FAILED", "SUSPENDED", "ORPHANED", "ENGINE_ERROR"];

const SM = {
  COMPLETED:    { bg: "var(--c-green-bg)",  color: "var(--c-green)",  icon: "✓" },
  RUNNING:      { bg: "var(--c-blue-bg)",   color: "var(--c-blue)",   icon: "↻" },
  FAILED:       { bg: "var(--c-red-bg)",    color: "var(--c-red)",    icon: "!" },
  SUSPENDED:    { bg: "var(--c-amber-bg)",  color: "var(--c-amber)",  icon: "⏸" },
  ORPHANED:     { bg: "var(--c-red-bg)",    color: "var(--c-red)",    icon: "⚠" },
  ENGINE_ERROR: { bg: "var(--c-purple-bg)", color: "var(--c-purple)", icon: "⚡" },
  SUBMITTED:    { bg: "var(--c-teal-bg)",   color: "var(--c-teal)",   icon: "→" },
  DISPATCHED:   { bg: "var(--c-blue-bg)",   color: "var(--c-blue)",   icon: "→" },
  STARTED:      { bg: "var(--c-blue-bg)",   color: "var(--c-blue)",   icon: "▶" },
  SKIPPED:      { bg: "var(--c-gray-bg)",   color: "var(--c-gray)",   icon: "→" },
  REVIEW:       { bg: "var(--c-amber-bg)",  color: "var(--c-amber)",  icon: "~" },
  REJECTED:     { bg: "var(--c-red-bg)",    color: "var(--c-red)",    icon: "✕" },
  PENDING:      { bg: "var(--c-amber-bg)",  color: "var(--c-amber)",  icon: "~" },
  UNKNOWN:      { bg: "var(--c-gray-bg)",   color: "var(--c-gray)",   icon: "?" },
};

function Chip({ s, size }) {
  const m = SM[s] || SM.UNKNOWN;
  return (
    <span className={`chip ${size === "lg" ? "chip-lg" : ""}`} style={{ "--chip-bg": m.bg, "--chip-c": m.color }}>
      <span className="chip-dot">{m.icon}</span>
      {(s || "—").toLowerCase().replace("_", " ")}
    </span>
  );
}

function timeFull(v) { return v ? String(v).slice(0, 19).replace("T", " ") : "—"; }
function timeShort(v) { return v ? String(v).slice(11, 19) : "—"; }

function BpmnFlow({ activities, currentActivity, engineStatus }) {
  const nW = 60, gap = 5, startX = 4, h = 52;
  const curIdx = activities.findIndex(a => a.id === currentActivity);
  const totalW = startX + activities.length * (nW + gap) + 8;
  return (
    <div className="bpmn-scroll">
      <svg width={totalW} height={h} viewBox={`0 0 ${totalW} ${h}`}>
        {activities.slice(0, -1).map((a, i) => {
          const x1 = startX + i * (nW + gap) + nW, x2 = startX + (i + 1) * (nW + gap);
          const past = curIdx >= 0 && i < curIdx;
          return <line key={`c${i}`} x1={x1} y1={h / 2 - 4} x2={x2} y2={h / 2 - 4} stroke={past ? "var(--c-green)" : "var(--c-border)"} strokeWidth={1} opacity={past ? 0.5 : 0.4} />;
        })}
        {activities.map((a, i) => {
          const x = startX + i * (nW + gap), cy = h / 2 - 4;
          const isCur = a.id === currentActivity;
          const isPast = curIdx >= 0 && i < curIdx;
          const col = isCur
            ? (engineStatus === "RUNNING" ? "var(--c-blue)"
              : ["FAILED", "ENGINE_ERROR", "ORPHANED"].includes(engineStatus) ? "var(--c-red)"
              : engineStatus === "SUSPENDED" ? "var(--c-amber)"
              : "var(--c-green)")
            : isPast ? "var(--c-green)" : "var(--c-muted)";
          const op = isPast && !isCur ? 0.4 : 1;
          if (a.type === "gateway") return (
            <g key={a.id} opacity={op}>
              <g transform={`translate(${x + nW / 2},${cy})`}>
                <polygon points="0,-10 12,0 0,10 -12,0" fill={isCur ? col + "22" : "transparent"} stroke={col} strokeWidth={isCur ? 1.5 : 0.7} />
              </g>
              <text x={x + nW / 2} y={h - 2} textAnchor="middle" fill={col} fontSize={7} fontWeight={isCur ? 700 : 400}>{a.label}</text>
            </g>
          );
          if (a.type === "event") return (
            <g key={a.id} opacity={op}>
              <circle cx={x + nW / 2} cy={cy} r={9} fill={isCur ? col + "22" : "transparent"} stroke={col} strokeWidth={isCur ? 1.5 : 0.7} />
              {a.id === "endEvent" && <circle cx={x + nW / 2} cy={cy} r={6} fill="none" stroke={col} strokeWidth={0.7} />}
              <text x={x + nW / 2} y={h - 2} textAnchor="middle" fill={col} fontSize={7} fontWeight={isCur ? 700 : 400}>{a.label}</text>
            </g>
          );
          return (
            <g key={a.id} opacity={op}>
              <rect x={x} y={cy - 10} width={nW} height={20} rx={3} fill={isCur ? col + "15" : "transparent"} stroke={col} strokeWidth={isCur ? 1.5 : 0.7} />
              {a.type === "http" && <rect x={x} y={cy - 10} width={2.5} height={20} rx={1} fill={col} opacity={0.5} />}
              {isCur && engineStatus === "RUNNING" && (
                <rect x={x} y={cy - 10} width={nW} height={20} rx={3} fill="none" stroke={col} strokeWidth={1.5} opacity={0.3}>
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                </rect>
              )}
              <text x={x + nW / 2} y={h - 2} textAnchor="middle" fill={col} fontSize={7} fontWeight={isCur ? 700 : 400}>{a.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function KV({ k, v, color, mono: m }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={`kv-v${m ? " mono" : ""}`} style={color ? { color } : {}}>{v}</span>
    </div>
  );
}

/* ─── BPMN path helpers ─── */
function buildIsTraced(tracedSet) {
  return (nodeId) => {
    if (!tracedSet?.size) return false;
    if (tracedSet.has(nodeId)) return true;
    const bare = nodeId.replace(/^task_/, "").replace(/^parse_/, "");
    for (const t of tracedSet) {
      const tBare = t.replace(/^task_/, "").replace(/^parse_/, "");
      if (tBare === bare || t === bare || t === "task_" + bare) return true;
    }
    return false;
  };
}

function inferPathNodes(allNodes, allEdges, isTracedFn, skippedIds) {
  if (!allNodes?.length || !allEdges?.length) return new Set();
  const isSkipNode = buildIsTraced(skippedIds);
  const fwd = {};
  allNodes.forEach(n => { fwd[n.id] = []; });
  allEdges.forEach(e => { if (fwd[e.sourceRef]) fwd[e.sourceRef].push(e.targetRef); });
  const hasIncoming = new Set(allEdges.map(e => e.targetRef));
  const hasOutgoing  = new Set(allEdges.map(e => e.sourceRef));
  const startNode = allNodes.find(n => !hasIncoming.has(n.id));
  const endNode   = allNodes.find(n => !hasOutgoing.has(n.id));
  if (!startNode || !endNode) return new Set();
  // Dijkstra: traced nodes cost 0 (preferred), non-traced cost 1, skipped = blocked
  const dist = {}; const prev = {};
  allNodes.forEach(n => { dist[n.id] = Infinity; });
  dist[startNode.id] = 0;
  const queue = [startNode.id]; const visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => dist[a] - dist[b]);
    const curr = queue.shift();
    if (visited.has(curr)) continue;
    visited.add(curr);
    if (curr === endNode.id) break;
    for (const next of (fwd[curr] || [])) {
      if (visited.has(next) || isSkipNode(next)) continue;
      const cost = dist[curr] + (isTracedFn(next) ? 0 : 1);
      if (cost < dist[next]) { dist[next] = cost; prev[next] = curr; queue.push(next); }
    }
  }
  if (dist[endNode.id] === Infinity) return new Set();
  const path = []; let c = endNode.id;
  while (c !== undefined) { path.unshift(c); c = prev[c]; }
  return new Set(path);
}

/* ─── 2D BPMN Canvas ─── */
function wrapText(text, maxChars) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) { line = word; continue; }
    if ((line + " " + word).length <= maxChars) line += " " + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text || ""];
}

function BpmnCanvas2D({ model, tracedNodeIds, pathNodeIds, skippedNodeIds, currentActivity, instanceStatus, onNodeClick, selectedNodeId }) {
  const { nodes = [], edges = [] } = model || {};
  if (!nodes.length) return <div className="fl-canvas2d-empty">BPMN model not loaded</div>;

  const allX = nodes.flatMap(n => [n.x, n.x + (n.w || 80)]);
  const allY = nodes.flatMap(n => [n.y, n.y + (n.h || 50)]);
  const PAD = 30;
  const minX = Math.min(...allX) - PAD, minY = Math.min(...allY) - PAD;
  const vw = Math.max(...allX) - minX + PAD, vh = Math.max(...allY) - minY + PAD + 22;

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  const isTraced  = buildIsTraced(tracedNodeIds);
  const isPath    = buildIsTraced(pathNodeIds?.size ? pathNodeIds : tracedNodeIds);
  const isSkipped = buildIsTraced(skippedNodeIds);
  const matchedCount = nodes.filter(n => isPath(n.id)).length;
  const hasTrace = (pathNodeIds?.size || tracedNodeIds?.size) > 0;
  const hasMatch = hasTrace && matchedCount > 0;

  const nodeColor = (node) => {
    if (selectedNodeId === node.id) return "var(--c-blue)";
    if (currentActivity === node.id) {
      if (["FAILED", "ENGINE_ERROR", "ORPHANED"].includes(instanceStatus)) return "var(--c-red)";
      if (instanceStatus === "SUSPENDED") return "var(--c-amber)";
      return "var(--c-blue)";
    }
    if (hasMatch && isPath(node.id)) return "var(--c-green)";
    if (isSkipped(node.id)) return "var(--c-amber)";
    return "#2a3a55";
  };

  const nodeOp = (node) => {
    if (!hasMatch) return 1;
    if (isPath(node.id) || currentActivity === node.id || selectedNodeId === node.id) return 1;
    if (isSkipped(node.id)) return 0.65;
    return 0.22;
  };

  return (
    <div className="fl-canvas2d-wrap">
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`}
        xmlns="http://www.w3.org/2000/svg" style={{ display: "block", width: "100%", height: "auto" }}>
        <defs>
          <marker id="fl2-arr"  markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="#1e2d45"/></marker>
          <marker id="fl2-arrG" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--c-green)"/></marker>
          <marker id="fl2-arrA" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--c-amber)"/></marker>
        </defs>

        {/* Edges */}
        {edges.map(edge => {
          const sv = hasMatch && (isPath(edge.sourceRef) || currentActivity === edge.sourceRef);
          const tv = hasMatch && (isPath(edge.targetRef) || currentActivity === edge.targetRef);
          const active = sv && tv;
          const isSkippedEdge = !active && hasMatch && (isSkipped(edge.sourceRef) || isSkipped(edge.targetRef));
          let pts = "";
          if (edge.waypoints?.length) {
            pts = edge.waypoints.map(wp => Array.isArray(wp) ? `${wp[0]},${wp[1]}` : `${wp.x},${wp.y}`).join(" ");
          } else {
            const s = nodeMap[edge.sourceRef], t = nodeMap[edge.targetRef];
            if (!s || !t) return null;
            pts = `${s.x+(s.w||80)/2},${s.y+(s.h||50)/2} ${t.x+(t.w||80)/2},${t.y+(t.h||50)/2}`;
          }
          return (
            <polyline key={edge.id} points={pts} fill="none"
              stroke={active ? "var(--c-green)" : isSkippedEdge ? "var(--c-amber)" : "#1e2d45"}
              strokeWidth={active ? 2.5 : isSkippedEdge ? 1 : 0.7}
              strokeDasharray={isSkippedEdge ? "3,3" : undefined}
              opacity={hasMatch ? (active ? 1 : isSkippedEdge ? 0.55 : 0.2) : 0.5}
              markerEnd={active ? "url(#fl2-arrG)" : isSkippedEdge ? "url(#fl2-arrA)" : "url(#fl2-arr)"} />
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const col = nodeColor(node);
          const op  = nodeOp(node);
          const vis = hasMatch && isPath(node.id);
          const isDirectTraced = hasMatch && isTraced(node.id);
          const cur = currentActivity === node.id;
          const sel = selectedNodeId === node.id;
          const skip = isSkipped(node.id);
          const fill = (vis || cur || sel || skip) ? col + "22" : "transparent";
          const sw = (cur || sel) ? 2 : isDirectTraced ? 1.5 : vis ? 1.0 : skip ? 1 : 0.7;
          const w = node.w || 80, h = node.h || 50;
          const cx = node.x + w / 2, cy = node.y + h / 2;
          const onClick = () => onNodeClick?.(node);

          if (node.type?.includes("Gateway")) {
            return (
              <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: "pointer" }}>
                <polygon points={`${cx},${node.y} ${node.x+w},${cy} ${cx},${node.y+h} ${node.x},${cy}`}
                  fill={fill} stroke={col} strokeWidth={sw} />
                <text x={cx} y={node.y + h + 13} textAnchor="middle" fill={col} fontSize={8} fontWeight={cur ? 700 : 400}>
                  {(node.name || node.id).slice(0, 16)}
                </text>
              </g>
            );
          }

          if (node.type?.includes("Event")) {
            const r = w / 2;
            return (
              <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: "pointer" }}>
                <circle cx={cx} cy={cy} r={r} fill={fill} stroke={col} strokeWidth={sw} />
                {node.type === "endEvent" && <circle cx={cx} cy={cy} r={r - 3} fill="none" stroke={col} strokeWidth={2} />}
                {cur && <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={1} opacity={0.4}>
                  <animate attributeName="r" values={`${r};${r+5};${r}`} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.5s" repeatCount="indefinite" />
                </circle>}
                <text x={cx} y={node.y + h + 13} textAnchor="middle" fill={col} fontSize={8} fontWeight={cur ? 700 : 400}>
                  {(node.name || node.id).slice(0, 16)}
                </text>
              </g>
            );
          }

          const maxC = Math.max(6, Math.floor(w / 7));
          const lines = wrapText(node.name || node.id, maxC);
          const lh = 10, startY = cy - ((lines.length - 1) * lh / 2);
          return (
            <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: "pointer" }}>
              <rect x={node.x} y={node.y} width={w} height={h} rx={4}
                fill={fill} stroke={col} strokeWidth={sw}
                strokeDasharray={skip ? "4,2" : undefined} />
              {node.type === "serviceTask" &&
                <rect x={node.x} y={node.y} width={3} height={h} rx={1} fill={col} opacity={0.7} />}
              {sel && <rect x={node.x-2} y={node.y-2} width={w+4} height={h+4} rx={5}
                fill="none" stroke={col} strokeWidth={1} opacity={0.5} />}
              {cur && <rect x={node.x} y={node.y} width={w} height={h} rx={4}
                fill="none" stroke={col} strokeWidth={2} opacity={0.4}>
                <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
              </rect>}
              {lines.map((ln, i) => (
                <text key={i} x={cx} y={startY + i * lh}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={col} fontSize={9} fontWeight={cur ? 700 : isDirectTraced ? 600 : vis ? 500 : 400}>{ln}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─── Node detail drawer (shows tracker IN/OUT for clicked node) ─── */
function NodeDetailDrawer({ node, tracker, onClose }) {
  if (!node) return null;
  const nodeId = node.id;

  // Match tracker events: exact service_id match, then partial
  const events = tracker.filter(ev =>
    ev.service_id === nodeId ||
    ev.stage === nodeId ||
    (ev.service_id && nodeId.includes(ev.service_id.replace(/^task_/, ""))) ||
    (ev.service_id && ev.service_id.includes(nodeId.replace(/^task_/, "")))
  );

  const inEv  = events.find(e => e.direction === "IN"  || e.direction === "REQUEST");
  const outEv = events.find(e => e.direction === "OUT" || e.direction === "RESPONSE");

  const elapsed = (a, b) => {
    if (!a || !b) return null;
    const ms = new Date(b) - new Date(a);
    return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60000)}m`;
  };

  const typeTag = node.type?.includes("service") ? "http"
    : node.type?.includes("Gateway") ? "gateway"
    : node.type?.includes("Event")   ? "event" : "script";

  return (
    <div className="fl-ndd">
      <div className="fl-ndd-hdr">
        <div className="fl-ndd-title">
          {node.name || node.id}
          <span className={`fl-type-chip ${typeTag}`} style={{ marginLeft: 6 }}>{node.type}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="mono fl-muted" style={{ fontSize: 9 }}>{node.id}</span>
          <button className="fl-btn-ghost" onClick={onClose}>✕</button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="fl-ndd-empty">No tracker events for this activity in the selected instance</div>
      ) : (
        <div className="fl-ndd-body">
          {inEv && (
            <div className="fl-ndd-section">
              <div className="fl-ndd-lbl in">→ Input <span className="mono fl-muted">{(inEv.created_at || "").slice(11, 19)}</span></div>
              {inEv.title && <div className="fl-ndd-ev">{inEv.title}</div>}
              {(inEv.payload || inEv.data || inEv.request_body) && (
                <pre className="fl-pre">{JSON.stringify(inEv.payload ?? inEv.data ?? inEv.request_body, null, 2)}</pre>
              )}
            </div>
          )}
          {outEv && (
            <div className="fl-ndd-section">
              <div className="fl-ndd-lbl out">
                ← Output
                {inEv && outEv && elapsed(inEv.created_at, outEv.created_at) &&
                  <span className="fl-ndd-dur">{elapsed(inEv.created_at, outEv.created_at)}</span>}
                <span className="mono fl-muted">{(outEv.created_at || "").slice(11, 19)}</span>
              </div>
              {outEv.title && <div className="fl-ndd-ev">{outEv.title}</div>}
              {outEv.status && <Chip s={outEv.status} />}
              {(outEv.payload || outEv.data || outEv.response_body) && (
                <pre className="fl-pre">{JSON.stringify(outEv.payload ?? outEv.data ?? outEv.response_body, null, 2)}</pre>
              )}
            </div>
          )}
          {events.filter(e => !["IN","OUT","REQUEST","RESPONSE"].includes(e.direction)).map((ev, i) => (
            <div key={i} className="fl-ndd-section">
              <div className="fl-ndd-lbl state">{ev.direction || "●"} {ev.title}</div>
              {ev.status && <Chip s={ev.status} />}
              <span className="mono fl-muted" style={{ fontSize: 9 }}>{(ev.created_at || "").slice(11, 19)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FlowableOpsPage({ canManage }) {
  const [tab, setTab] = useState("health");
  const [items, setItems] = useState([]);
  const [sf, setSf] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [processModel, setProcessModel] = useState(null);
  const [activities, setActivities] = useState(FALLBACK_ACTIVITIES);
  const [instTab, setInstTab] = useState("overview");
  const [selectedNode, setSelectedNode] = useState(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pg, setPg] = useState(0);
  const PS = 20;

  const loadInstances = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100", status: sf });
      if (q.trim()) params.set("request_id", q.trim());
      const d = await get(`/api/v1/flowable/instances?${params}`);
      setItems(d.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const openDetail = async (instanceId) => {
    if (!instanceId) return;
    setSel(instanceId);
    setInstTab("overview");
    setTab("detail");
    setDetail(null);
    try {
      const d = await get(`/api/v1/flowable/instances/${instanceId}`);
      setDetail(d);
    } catch (e) { setError(e.message); }
  };

  const loadModel = async () => {
    try {
      const m = await get("/api/v1/process-model");
      setProcessModel(m);
      const derived = (m.nodes || [])
        .filter(n => !n.id.includes("skip") && !n.id.includes("degrade") && !n.id.includes("err_"))
        .sort((a, b) => a.x - b.x)
        .map(n => {
          let type = "script";
          if (n.type === "serviceTask") type = "http";
          else if (n.type.endsWith("Gateway")) type = "gateway";
          else if (n.type.endsWith("Event")) type = "event";
          return { id: n.id, label: n.name || n.id, type };
        });
      if (derived.length > 0) setActivities(derived);
    } catch (_) { /* keep fallback */ }
  };

  const doAction = async (label, path) => {
    if (!path) return;
    setError("");
    try {
      const r = await post(path, { reason });
      setNotice(`${label} — ${r.status || "ok"}`);
      setTimeout(() => setNotice(""), 3000);
      await loadInstances();
      if (sel) {
        const d = await get(`/api/v1/flowable/instances/${sel}`);
        setDetail(d);
      }
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { loadInstances(); }, [sf]);
  useEffect(() => { if (tab === "model" && !processModel) loadModel(); }, [tab]);
  useEffect(() => { loadModel(); }, []); // load model on mount for health tab diagram

  const selInst = detail?.instance || null;
  const selJobs = detail?.jobs || [];
  const selVars = detail?.variables || {};
  const selTracker = detail?.tracker || [];
  const varEntries = Object.entries(selVars);
  const failedJobs = selJobs.filter(j => j.exceptionMessage);

  const tracedNodeIds = useMemo(() => {
    const s = new Set();
    selTracker.filter(ev => ev.status !== "SKIPPED").forEach(ev => {
      if (ev.service_id) s.add(ev.service_id);
      if (ev.stage) s.add(ev.stage);
    });
    if (selInst?.current_activity) s.add(selInst.current_activity);
    return s;
  }, [selTracker, selInst?.current_activity]);

  const skippedNodeIds = useMemo(() => {
    const s = new Set();
    selTracker.filter(ev => ev.status === "SKIPPED").forEach(ev => {
      if (ev.service_id) s.add(ev.service_id);
    });
    return s;
  }, [selTracker]);

  const pathNodeIds = useMemo(() => {
    if (!processModel) return tracedNodeIds;
    return inferPathNodes(processModel.nodes, processModel.edges, buildIsTraced(tracedNodeIds), skippedNodeIds);
  }, [processModel, tracedNodeIds, skippedNodeIds]);

  const stats = useMemo(() => {
    const bySt = {};
    STATUSES.forEach(s => bySt[s] = 0);
    items.forEach(i => { bySt[i.engine_status] = (bySt[i.engine_status] || 0) + 1; });
    const deadJobs = items.reduce((s, i) => s + (i.failed_jobs || 0), 0);
    const problems = items.filter(i => ["FAILED", "ENGINE_ERROR", "ORPHANED"].includes(i.engine_status) || i.failed_jobs > 0);
    const actHeat = {};
    items.filter(i => i.engine_status !== "COMPLETED").forEach(i => {
      const lbl = activities.find(a => a.id === i.current_activity)?.label || i.current_activity_label || i.current_activity;
      if (lbl) actHeat[lbl] = (actHeat[lbl] || 0) + 1;
    });
    const hotspots = Object.entries(actHeat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { bySt, deadJobs, problems, hotspots, total: items.length };
  }, [items, activities]);

  const filtered = useMemo(() => {
    let r = items;
    if (sf !== "all") {
      if (sf === "failed") r = r.filter(x => ["FAILED", "ENGINE_ERROR"].includes(x.engine_status) || x.failed_jobs > 0);
      else r = r.filter(x => (x.engine_status || "").toLowerCase() === sf);
    }
    if (q) {
      const ql = q.toLowerCase();
      r = r.filter(x => x.instance_id?.includes(ql) || x.request_id?.toLowerCase().includes(ql));
    }
    return r;
  }, [items, sf, q]);

  const pages = Math.ceil(filtered.length / PS);
  const rows = filtered.slice(pg * PS, (pg + 1) * PS);
  useEffect(() => setPg(0), [sf, q]);

  const actLabel = (id) => activities.find(a => a.id === id)?.label;

  return (
    <div className="fl-root">
      <header className="fl-header">
        <div className="fl-header-left">
          <div className="fl-logo">FL</div>
          <div>
            <div className="fl-title">Flowable Engine</div>
            <div className="fl-subtitle">BPMN Runtime Operations • v6.8.0 • {stats.total} instances</div>
          </div>
        </div>
        <div className="fl-header-right">
          <span className="fl-health-badge up"><span className="fl-live-dot" /> Engine UP</span>
          {stats.deadJobs > 0 && <span className="fl-health-badge alert">⚠ {stats.deadJobs} dead letter jobs</span>}
        </div>
      </header>

      <div className="fl-tabs">
        {[
          { id: "health",    label: "Health & Overview" },
          { id: "instances", label: `Instances (${stats.total})` },
          { id: "model",     label: "Process Model" },
        ].map(t => (
          <button key={t.id} className={`fl-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => { setTab(t.id); setSel(null); setDetail(null); }}>{t.label}</button>
        ))}
        {selInst && (
          <button className="fl-tab active" style={{ borderLeft: "2px solid var(--c-blue)" }}>
            Instance: {selInst.instance_id?.slice(0, 8)}…
          </button>
        )}
      </div>

      {error  && <div className="fl-notice" style={{ background: "var(--c-red-bg)", color: "var(--c-red)" }}>{error}</div>}
      {notice && <div className="fl-notice">{notice}</div>}

      <div className="fl-layout">
        <div className="fl-main">

          {/* ─── HEALTH ─── */}
          {tab === "health" && (<>
            <div className="fl-stat-grid">
              {[
                { label: "Total", value: stats.total, color: "var(--c-text)" },
                ...STATUSES.map(s => ({ label: s.toLowerCase().replace("_", " "), value: stats.bySt[s] || 0, color: SM[s]?.color, status: s })),
                { label: "Dead jobs", value: stats.deadJobs, color: stats.deadJobs > 0 ? "var(--c-red)" : "var(--c-green)" },
              ].map((s, i) => (
                <div key={i}
                  className={`fl-stat ${sf === (s.status || "").toLowerCase() ? "active" : ""}`}
                  style={{ cursor: s.status ? "pointer" : "default" }}
                  onClick={() => { if (s.status) { setSf(sf === (s.status || "").toLowerCase() ? "all" : (s.status || "").toLowerCase()); setTab("instances"); } }}>
                  <div className="fl-stat-label">{s.label}</div>
                  <div className="fl-stat-value" style={{ color: s.color }}>{s.value}</div>
                  {s.status && <div className="fl-stat-pct">{stats.total > 0 ? Math.round((s.value / stats.total) * 100) : 0}%</div>}
                </div>
              ))}
            </div>

            <div className="fl-card" style={{ marginBottom: 12 }}>
              <div className="fl-card-title">
                Process Model — {processModel ? `${processModel.process_key} v${processModel.version}` : "creditServiceChainOrchestration"}
              </div>
              <BpmnCanvas2D model={processModel} />
              <div className="fl-muted" style={{ marginTop: 4 }}>
                {(processModel?.nodes?.length || activities.length)} activities • dynamic from Flowable
              </div>
            </div>

            <div className="fl-grid-3">
              <div className="fl-card">
                <div className="fl-card-title">Engine Health</div>
                <KV k="Status" v="UP" color="var(--c-green)" />
                <KV k="Database" v="PostgreSQL — connected" mono />
                <KV k="Async executor" v="ACTIVE" color="var(--c-green)" />
                <KV k="Version" v="6.8.0" mono />
                <KV k="Dead letter jobs" v={String(stats.deadJobs)} color={stats.deadJobs > 0 ? "var(--c-red)" : "var(--c-green)"} mono />
              </div>
              <div className="fl-card">
                <div className="fl-card-title">Activity Hotspots</div>
                {stats.hotspots.length === 0
                  ? <div className="fl-muted">No stuck instances</div>
                  : stats.hotspots.map(([act, cnt], i) => (
                    <div key={act} className="fl-hotspot-row">
                      <span className="fl-hotspot-num">{i + 1}.</span>
                      <span className="fl-hotspot-name">{act}</span>
                      <div className="fl-hotspot-bar"><div style={{ width: `${Math.min(100, (cnt / stats.total) * 400)}%` }} /></div>
                      <span className="fl-hotspot-cnt">{cnt}</span>
                    </div>
                  ))}
              </div>
              <div className="fl-card">
                <div className="fl-card-title">Recent Issues</div>
                {stats.problems.length === 0
                  ? <div className="fl-muted">No issues</div>
                  : stats.problems.slice(0, 5).map(p => (
                    <div key={p.instance_id} className="fl-issue-row" onClick={() => openDetail(p.instance_id)}>
                      <div className="fl-issue-rid">{p.request_id}</div>
                      <Chip s={p.engine_status} />
                      <span className="fl-issue-act">{actLabel(p.current_activity) || p.current_activity_label || "—"}</span>
                      {p.failed_jobs > 0 && <span className="fl-issue-jobs">{p.failed_jobs}j</span>}
                    </div>
                  ))}
              </div>
            </div>
          </>)}

          {/* ─── INSTANCES ─── */}
          {tab === "instances" && (<>
            <div className="fl-toolbar">
              <input className="fl-input" value={q} onChange={e => setQ(e.target.value)} placeholder="⌕ Instance ID, Request ID…" />
              <div className="fl-filter-group">
                {["all", "running", "completed", "suspended", "failed", "orphaned"].map(s => (
                  <button key={s} className={`fl-filter-btn ${sf === s ? "active" : ""}`} onClick={() => setSf(s)}>{s}</button>
                ))}
              </div>
              <button className="fl-btn-ghost" onClick={loadInstances}>{loading ? "…" : "Refresh"}</button>
              <span className="fl-muted" style={{ marginLeft: "auto" }}>{filtered.length} results</span>
            </div>

            <div className="fl-card fl-card-flush">
              <table className="fl-table">
                <thead><tr>
                  <th style={{ width: 28 }}></th>
                  <th>Request</th><th>Instance</th><th>Engine</th><th>Request</th><th>Activity</th><th>Jobs</th><th>Started</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.instance_id} className={sel === r.instance_id ? "selected" : ""} onClick={() => openDetail(r.instance_id)}>
                      <td>{(r.failed_jobs > 0 || r.engine_status === "ORPHANED") && <span className={`fl-pulse-dot ${r.failed_jobs > 0 ? "red" : "amber"}`} />}</td>
                      <td className="mono fw-600">{r.request_id}</td>
                      <td className="mono sm muted">{r.instance_id?.slice(0, 12)}…</td>
                      <td><Chip s={r.engine_status} /></td>
                      <td><Chip s={r.request_status} /></td>
                      <td className="sm">{actLabel(r.current_activity) || r.current_activity_label || r.current_activity}</td>
                      <td className={`mono ${r.failed_jobs > 0 ? "red fw-600" : ""}`}>{r.failed_jobs}/{r.job_count}</td>
                      <td className="mono sm muted">{timeFull(r.start_time)}</td>
                      <td><button className="fl-btn-ghost" onClick={e => { e.stopPropagation(); openDetail(r.instance_id); }}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fl-pagination">
              {Array.from({ length: Math.min(9, pages) }, (_, i) => {
                let n;
                if (pages <= 9) n = i;
                else if (pg < 4) n = i;
                else if (pg > pages - 5) n = pages - 9 + i;
                else n = pg - 4 + i;
                return <button key={n} className={`fl-pg-btn ${pg === n ? "active" : ""}`} onClick={() => setPg(n)}>{n + 1}</button>;
              })}
            </div>
          </>)}

          {/* ─── MODEL ─── */}
          {tab === "model" && (<>
            <div className="fl-card" style={{ marginBottom: 12 }}>
              <div className="fl-card-title" style={{ justifyContent: "space-between" }}>
                <span>{processModel ? `${processModel.process_key} — v${processModel.version} (latest)` : "Loading process model…"}</span>
                <button className="fl-btn-ghost" onClick={loadModel}>↺ Reload</button>
              </div>
              <BpmnCanvas2D model={processModel} onNodeClick={setSelectedNode} selectedNodeId={selectedNode?.id} />
              <NodeDetailDrawer node={selectedNode} tracker={[]} onClose={() => setSelectedNode(null)} />
              <div className="fl-muted" style={{ marginTop: 6 }}>
                {processModel ? `${processModel.nodes?.length || 0} nodes · ${processModel.edges?.length || 0} edges · auto-updates when BPMN model changes` : "Loading…"}
              </div>
            </div>
            {processModel && (
              <div className="fl-card fl-card-flush">
                <table className="fl-table">
                  <thead><tr><th>#</th><th>Activity ID</th><th>Label</th><th>Type</th><th>X</th><th>Y</th></tr></thead>
                  <tbody>{(processModel.nodes || []).map((n, i) => {
                    const t = n.type.endsWith("Task") ? (n.type === "serviceTask" ? "http" : "script") : n.type.endsWith("Gateway") ? "gateway" : "event";
                    return (
                      <tr key={n.id}>
                        <td className="mono muted">{i + 1}</td>
                        <td className="mono">{n.id}</td>
                        <td>{n.name || "—"}</td>
                        <td><span className={`fl-type-chip ${t}`}>{n.type}</span></td>
                        <td className="mono muted">{n.x}</td>
                        <td className="mono muted">{n.y}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </>)}

          {/* ─── DETAIL ─── */}
          {tab === "detail" && !selInst && (
            <div className="fl-card"><div className="fl-muted">{sel ? "Loading instance detail…" : "Select an instance from the Instances tab."}</div></div>
          )}

          {tab === "detail" && selInst && (<>
            <div className="fl-detail-header">
              <button className="fl-btn-ghost" onClick={() => { setTab("instances"); setSel(null); setDetail(null); }}>← Instances</button>
              <span className="mono fw-600">{selInst.instance_id?.slice(0, 20)}…</span>
              <Chip s={selInst.engine_status} size="lg" />
              <span className="mono sm muted">{selInst.request_id}</span>
            </div>

            <div className="fl-card" style={{ marginBottom: 10 }}>
              <div className="fl-card-title" style={{ marginBottom: 8 }}>
                Process Path — click a node to inspect input/output
                {selectedNode && <button className="fl-btn-ghost" style={{ marginLeft: 8 }} onClick={() => setSelectedNode(null)}>clear selection</button>}
              </div>
              <BpmnCanvas2D
                model={processModel}
                tracedNodeIds={tracedNodeIds}
                pathNodeIds={pathNodeIds}
                skippedNodeIds={skippedNodeIds}
                currentActivity={selInst.current_activity}
                instanceStatus={selInst.engine_status}
                onNodeClick={setSelectedNode}
                selectedNodeId={selectedNode?.id}
              />
              <NodeDetailDrawer
                node={selectedNode}
                tracker={selTracker}
                onClose={() => setSelectedNode(null)}
              />
            </div>

            {selInst.engine_status === "ORPHANED" && <div className="fl-alert warn">⚠ Runtime instance alive but platform request already finalized. Safe to terminate.</div>}
            {failedJobs.length > 0 && <div className="fl-alert error">⚠ {failedJobs.length} failed job(s) — process stalled at {actLabel(selInst.current_activity) || selInst.current_activity_label}. Review and retry.</div>}

            <div className="fl-toolbar">
              <input className="fl-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for audit log…" style={{ flex: 1 }} />
              {selInst.engine_status === "RUNNING"   && canManage && <button className="fl-btn amber" onClick={() => doAction("Suspend",          `/api/v1/flowable/instances/${selInst.instance_id}/suspend`)}>⏸ Suspend</button>}
              {selInst.engine_status === "SUSPENDED" && canManage && <button className="fl-btn green" onClick={() => doAction("Activate",         `/api/v1/flowable/instances/${selInst.instance_id}/activate`)}>▶ Activate</button>}
              {failedJobs.length > 0                && canManage && <button className="fl-btn red"   onClick={() => doAction("Retry failed jobs", `/api/v1/flowable/instances/${selInst.instance_id}/retry-failed-jobs`)}>↻ Retry jobs ({failedJobs.length})</button>}
              {selInst.request_id && !["COMPLETED","REVIEW","REJECTED"].includes(selInst.request_status) && canManage &&
                <button className="fl-btn blue" onClick={() => doAction("Reconcile", `/api/v1/flowable/requests/${selInst.request_id}/reconcile`)}>↻ Reconcile</button>}
              {["RUNNING","SUSPENDED","ORPHANED"].includes(selInst.engine_status) && canManage &&
                <button className="fl-btn red" onClick={() => doAction("Terminate", `/api/v1/flowable/instances/${selInst.instance_id}/terminate`)}>✕ Terminate</button>}
            </div>

            <div className="fl-tabs inner">
              {[
                { id: "overview",  label: "Overview" },
                { id: "variables", label: `Variables (${varEntries.length})` },
                { id: "jobs",      label: `Jobs (${selJobs.length})`, alert: failedJobs.length > 0 },
                { id: "tracker",   label: `Tracker (${selTracker.length})` },
              ].map(t => (
                <button key={t.id} className={`fl-tab ${instTab === t.id ? "active" : ""} ${t.alert ? "has-alert" : ""}`} onClick={() => setInstTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {instTab === "overview" && (
              <div className="fl-grid-2">
                <div className="fl-card">
                  <div className="fl-card-title">Instance</div>
                  <KV k="Instance ID" v={selInst.instance_id} mono />
                  <KV k="Request ID"  v={selInst.request_id}  mono />
                  <KV k="Engine"      v={<Chip s={selInst.engine_status} />} />
                  <KV k="Request"     v={<Chip s={selInst.request_status} />} />
                  <KV k="Suspended"   v={selInst.suspended ? "Yes" : "No"} />
                  <KV k="Activity"    v={actLabel(selInst.current_activity) || selInst.current_activity_label || selInst.current_activity} mono />
                  <KV k="Process"     v={selInst.process_definition_key} mono />
                  <KV k="Correlation" v={selInst.correlation_id} mono />
                  <KV k="Started"     v={timeFull(selInst.start_time)} mono />
                  <KV k="Ended"       v={timeFull(selInst.end_time)} mono />
                  <KV k="Failed jobs" v={String(selInst.failed_jobs || 0)} color={selInst.failed_jobs > 0 ? "var(--c-red)" : undefined} mono />
                  <KV k="Duration"    v={selInst.duration > 0 ? `${(selInst.duration / 1000).toFixed(1)}s` : "running"} mono />
                </div>
                <div className="fl-card">
                  <div className="fl-card-title">Quick Variables</div>
                  {varEntries.slice(0, 14).map(([k, v]) => (
                    <KV key={k} k={k} v={typeof v === "object" ? JSON.stringify(v).slice(0, 50) + "…" : String(v).slice(0, 50)} mono />
                  ))}
                  {varEntries.length > 14 && <div className="fl-muted" style={{ marginTop: 6 }}>+{varEntries.length - 14} more — see Variables tab</div>}
                </div>
              </div>
            )}

            {instTab === "variables" && (
              <div className="fl-card fl-card-flush">
                <table className="fl-table">
                  <thead><tr><th>Name</th><th>Value</th></tr></thead>
                  <tbody>{varEntries.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono fw-600" style={{ whiteSpace: "nowrap" }}>{k}</td>
                      <td className="mono sm muted" title={typeof v === "object" ? JSON.stringify(v) : String(v)}
                        style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {instTab === "jobs" && (
              <div className="fl-card">
                <div className="fl-card-title">Jobs ({selJobs.length}) {failedJobs.length > 0 && <Chip s="FAILED" />}</div>
                {selJobs.length === 0
                  ? <div className="fl-muted">No jobs</div>
                  : (
                    <table className="fl-table">
                      <thead><tr><th>Job ID</th><th>Type</th><th>Retries</th><th>Exception</th></tr></thead>
                      <tbody>{selJobs.map(j => (
                        <tr key={j.id}>
                          <td className="mono sm">{j.id?.slice(0, 24)}</td>
                          <td className="sm">{j.jobHandlerType || "—"}</td>
                          <td className="mono">{j.retries ?? "—"}</td>
                          <td>{j.exceptionMessage
                            ? <details>
                                <summary className="mono sm" style={{ color: "var(--c-red)", cursor: "pointer" }}>{j.exceptionMessage.slice(0, 70)}…</summary>
                                <pre className="fl-pre">{j.exceptionMessage}{j.exceptionStacktrace ? "\n\n" + j.exceptionStacktrace : ""}</pre>
                              </details>
                            : <span className="muted">—</span>}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                {failedJobs.length > 0 && canManage && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="fl-btn red" onClick={() => doAction("Retry all failed jobs", `/api/v1/flowable/instances/${selInst.instance_id}/retry-failed-jobs`)}>
                      ↻ Retry all failed ({failedJobs.length})
                    </button>
                    <span className="fl-muted">Re-executes each failed job through Flowable job executor</span>
                  </div>
                )}
              </div>
            )}

            {instTab === "tracker" && (
              <div className="fl-card">
                <div className="fl-card-title">Request Tracker ({selTracker.length} events)</div>
                <div className="fl-timeline">
                  {selTracker.map((ev, i) => {
                    const dc = ["COMPLETED","OK","PASS","STARTED"].includes(ev.status) ? "green"
                      : ["FAILED","REJECTED","TERMINATED"].includes(ev.status) ? "red"
                      : ["REVIEW","SKIPPED","PENDING","SUSPENDED"].includes(ev.status) ? "amber" : "blue";
                    return (
                      <div className="fl-tl-item" key={ev.id}>
                        <div className="fl-tl-rail">
                          <div className={`fl-tl-dot ${dc}`} />
                          {i < selTracker.length - 1 && <div className="fl-tl-line" />}
                        </div>
                        <div className="fl-tl-body">
                          <div className="fl-tl-title">{ev.title}</div>
                          <div className="fl-tl-meta">
                            <span className="mono">{timeShort(ev.created_at)}</span>
                            <span>{ev.service_id}</span>
                            <span className={`fl-dir-chip ${ev.direction}`}>{ev.direction}</span>
                            <Chip s={ev.status} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>)}

        </div>
      </div>

      <style>{`
        .fl-root {
          --c-bg: #05080f; --c-surface: #0a0f1c; --c-surface2: #111827; --c-surface3: #1a2235;
          --c-border: #1e2d45; --c-text: #f0f4fc; --c-text2: #c5cee0; --c-muted: #4a5b78;
          --c-green: #00e5a0; --c-green-bg: rgba(0,229,160,0.12);
          --c-red: #ff4d6a; --c-red-bg: rgba(255,77,106,0.12);
          --c-amber: #ffb628; --c-amber-bg: rgba(255,182,40,0.12);
          --c-blue: #3d8bfd; --c-blue-bg: rgba(61,139,253,0.12);
          --c-purple: #a78bfa; --c-purple-bg: rgba(167,139,250,0.12);
          --c-teal: #22d3ee; --c-teal-bg: rgba(34,211,238,0.12);
          --c-gray: #7b8ba8; --c-gray-bg: rgba(123,139,168,0.1);
          --font: 'Outfit','Satoshi',system-ui,sans-serif;
          --mono: 'Geist Mono','JetBrains Mono','Fira Code',monospace;
        }
        .fl-root * { box-sizing: border-box; margin: 0; padding: 0; }
        .fl-root { font-family: var(--font); background: var(--c-bg); color: var(--c-text2); min-height: 60vh; font-size: 13px; border-radius: 8px; overflow: hidden; }
        .fl-header { padding: 10px 16px; border-bottom: 1px solid var(--c-border); display: flex; align-items: center; justify-content: space-between; background: var(--c-surface); }
        .fl-header-left { display: flex; align-items: center; gap: 10px; }
        .fl-header-right { display: flex; align-items: center; gap: 6px; }
        .fl-logo { width: 26px; height: 26px; border-radius: 6px; background: linear-gradient(135deg, var(--c-purple), var(--c-blue)); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: var(--c-bg); }
        .fl-title { font-size: 14px; font-weight: 700; color: var(--c-text); letter-spacing: -0.3px; }
        .fl-subtitle { font-size: 10px; color: var(--c-muted); }
        .fl-health-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 600; }
        .fl-health-badge.up { background: rgba(0,229,160,0.1); color: var(--c-green); }
        .fl-health-badge.alert { background: var(--c-red-bg); color: var(--c-red); }
        .fl-live-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--c-green); animation: flLive 2s infinite; }
        .fl-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--c-border); background: var(--c-surface); padding: 0 16px; }
        .fl-tabs.inner { padding: 0; margin-bottom: 12px; border-radius: 6px; background: var(--c-surface); border: 1px solid var(--c-border); overflow: hidden; }
        .fl-tab { padding: 9px 14px; font-size: 12px; font-weight: 500; color: var(--c-muted); border: none; border-bottom: 2px solid transparent; background: transparent; cursor: pointer; transition: all 0.15s; position: relative; }
        .fl-tab.active { color: var(--c-blue); border-bottom-color: var(--c-blue); font-weight: 700; }
        .fl-tab:hover { color: var(--c-text2); }
        .fl-tab.has-alert::after { content: ''; position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--c-red); }
        .fl-layout { display: flex; flex: 1; }
        .fl-main { flex: 1; padding: 14px 16px; }
        .fl-notice { padding: 8px 16px; background: var(--c-blue-bg); color: var(--c-blue); font-size: 12px; font-weight: 600; text-align: center; }
        .fl-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 6px; margin-bottom: 12px; }
        .fl-stat { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 8px; padding: 8px 10px; transition: all 0.15s; position: relative; overflow: hidden; }
        .fl-stat.active { border-color: var(--c-blue); }
        .fl-stat.active::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--c-blue); }
        .fl-stat-label { font-size: 9px; color: var(--c-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fl-stat-value { font-size: 20px; font-weight: 800; font-family: var(--mono); line-height: 1; }
        .fl-stat-pct { font-size: 9px; color: var(--c-muted); margin-top: 2px; }
        .fl-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
        .fl-card-flush { padding: 0; }
        .fl-card-title { font-size: 12px; font-weight: 700; color: var(--c-text); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
        .fl-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .fl-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .fl-muted { font-size: 10px; color: var(--c-muted); }
        .fl-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; background: var(--c-surface2); border: 1px solid var(--c-border); border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
        .fl-input { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 6px; padding: 5px 10px; color: var(--c-text2); font-size: 12px; outline: none; width: 220px; }
        .fl-input:focus { border-color: var(--c-blue); }
        .fl-filter-group { display: flex; gap: 2px; background: var(--c-surface); border-radius: 6px; border: 1px solid var(--c-border); padding: 2px; }
        .fl-filter-btn { padding: 3px 8px; border-radius: 4px; border: none; cursor: pointer; font-size: 10px; font-weight: 600; background: transparent; color: var(--c-muted); transition: all 0.15s; }
        .fl-filter-btn.active { background: var(--c-surface3); color: var(--c-text); }
        .fl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .fl-table th { padding: 8px 10px; text-align: left; font-size: 9px; font-weight: 700; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid var(--c-border); }
        .fl-table td { padding: 6px 10px; border-bottom: 1px solid var(--c-bg); vertical-align: middle; }
        .fl-table tr { cursor: pointer; transition: background 0.1s; }
        .fl-table tr:hover td { background: var(--c-surface2); }
        .fl-table tr.selected td { background: var(--c-surface3); }
        .fl-pagination { display: flex; justify-content: center; gap: 3px; margin: 10px 0; }
        .fl-pg-btn { padding: 3px 8px; border-radius: 4px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-muted); cursor: pointer; font-size: 11px; font-family: var(--mono); }
        .fl-pg-btn.active { background: var(--c-blue); color: var(--c-bg); font-weight: 700; border-color: var(--c-blue); }
        .chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px 1px 4px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--chip-bg); color: var(--chip-c); border: 1px solid color-mix(in srgb, var(--chip-c) 15%, transparent); }
        .chip-lg { padding: 2px 10px 2px 6px; font-size: 12px; }
        .chip-dot { font-size: 8px; line-height: 1; }
        .kv { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--c-border) 40%, transparent); }
        .kv-k { font-size: 10px; color: var(--c-muted); font-weight: 500; }
        .kv-v { font-size: 11px; color: var(--c-text2); font-weight: 500; }
        .fl-root .mono { font-family: var(--mono); }
        .fl-root .fw-600 { font-weight: 600; }
        .fl-root .sm { font-size: 11px; }
        .fl-root .muted { color: var(--c-muted); }
        .fl-root .red { color: var(--c-red); }
        .fl-btn { padding: 4px 10px; border-radius: 5px; border: none; cursor: pointer; font-size: 10px; font-weight: 700; transition: all 0.15s; }
        .fl-btn.red   { background: var(--c-red-bg);   color: var(--c-red);   border: 1px solid color-mix(in srgb, var(--c-red)   30%, transparent); }
        .fl-btn.green { background: var(--c-green-bg); color: var(--c-green); border: 1px solid color-mix(in srgb, var(--c-green) 30%, transparent); }
        .fl-btn.blue  { background: var(--c-blue-bg);  color: var(--c-blue);  border: 1px solid color-mix(in srgb, var(--c-blue)  30%, transparent); }
        .fl-btn.amber { background: var(--c-amber-bg); color: var(--c-amber); border: 1px solid color-mix(in srgb, var(--c-amber) 30%, transparent); }
        .fl-btn-ghost { padding: 3px 8px; border-radius: 4px; border: 1px solid var(--c-border); background: transparent; color: var(--c-muted); cursor: pointer; font-size: 10px; font-weight: 600; }
        .fl-btn-ghost:hover { background: var(--c-surface2); color: var(--c-text2); }
        .fl-pulse-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; animation: flPulse 2s infinite; }
        .fl-pulse-dot.red   { background: var(--c-red);   box-shadow: 0 0 6px var(--c-red); }
        .fl-pulse-dot.amber { background: var(--c-amber); box-shadow: 0 0 6px var(--c-amber); }
        .fl-alert { padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 10px; }
        .fl-alert.error { background: var(--c-red-bg);   color: var(--c-red);   border: 1px solid color-mix(in srgb, var(--c-red)   25%, transparent); }
        .fl-alert.warn  { background: var(--c-amber-bg); color: var(--c-amber); border: 1px solid color-mix(in srgb, var(--c-amber) 25%, transparent); }
        .fl-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        .fl-pre { font-size: 10px; font-family: var(--mono); color: var(--c-muted); white-space: pre-wrap; padding: 8px; background: var(--c-surface2); border-radius: 4px; margin-top: 6px; max-height: 200px; overflow: auto; }
        .bpmn-scroll { overflow-x: auto; margin: 4px 0; }
        .bpmn-scroll svg { display: block; }
        .fl-hotspot-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid color-mix(in srgb, var(--c-border) 40%, transparent); }
        .fl-hotspot-num  { font-size: 10px; font-weight: 700; color: var(--c-muted); width: 16px; }
        .fl-hotspot-name { font-size: 11px; font-weight: 600; color: var(--c-text); flex: 1; }
        .fl-hotspot-bar  { width: 40px; height: 4px; border-radius: 2px; background: var(--c-surface3); overflow: hidden; }
        .fl-hotspot-bar div { height: 100%; background: var(--c-red); border-radius: 2px; }
        .fl-hotspot-cnt  { font-size: 11px; font-family: var(--mono); font-weight: 700; color: var(--c-red); min-width: 20px; text-align: right; }
        .fl-issue-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--c-border) 40%, transparent); cursor: pointer; }
        .fl-issue-rid  { font-size: 11px; font-family: var(--mono); font-weight: 600; color: var(--c-text2); min-width: 130px; }
        .fl-issue-act  { font-size: 10px; color: var(--c-muted); flex: 1; }
        .fl-issue-jobs { font-size: 10px; font-family: var(--mono); font-weight: 700; color: var(--c-red); }
        .fl-timeline { display: flex; flex-direction: column; }
        .fl-tl-item { display: flex; gap: 10px; }
        .fl-tl-rail { display: flex; flex-direction: column; align-items: center; width: 14px; flex-shrink: 0; }
        .fl-tl-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
        .fl-tl-dot.green { background: var(--c-green); } .fl-tl-dot.red { background: var(--c-red); } .fl-tl-dot.amber { background: var(--c-amber); } .fl-tl-dot.blue { background: var(--c-blue); }
        .fl-tl-line { width: 1px; flex: 1; background: var(--c-border); min-height: 12px; }
        .fl-tl-body { padding-bottom: 10px; flex: 1; min-width: 0; }
        .fl-tl-title { font-size: 12px; font-weight: 500; color: var(--c-text); }
        .fl-tl-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
        .fl-dir-chip { padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700; }
        .fl-dir-chip.OUT   { background: var(--c-blue-bg);  color: var(--c-blue);  }
        .fl-dir-chip.IN    { background: var(--c-green-bg); color: var(--c-green); }
        .fl-dir-chip.STATE { background: var(--c-amber-bg); color: var(--c-amber); }
        .fl-type-chip { padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; font-family: var(--mono); }
        .fl-type-chip.http    { background: var(--c-blue-bg);   color: var(--c-blue);   }
        .fl-type-chip.gateway { background: var(--c-amber-bg);  color: var(--c-amber);  }
        .fl-type-chip.event   { background: var(--c-purple-bg); color: var(--c-purple); }
        .fl-type-chip.script  { background: var(--c-surface3);  color: var(--c-muted);  }
        @keyframes flPulse  { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes flLive   { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
        .fl-canvas2d-wrap { overflow-x: auto; overflow-y: hidden; background: var(--c-surface2); border-radius: 6px; padding: 8px 0; }
        .fl-canvas2d-empty { padding: 20px; text-align: center; color: var(--c-muted); font-size: 12px; }
        .fl-ndd { background: var(--c-surface2); border: 1px solid var(--c-border); border-radius: 6px; margin-top: 10px; overflow: hidden; }
        .fl-ndd-hdr { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--c-border); background: var(--c-surface); }
        .fl-ndd-title { font-size: 12px; font-weight: 700; color: var(--c-text); display: flex; align-items: center; }
        .fl-ndd-empty { padding: 14px; font-size: 11px; color: var(--c-muted); text-align: center; }
        .fl-ndd-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1px; background: var(--c-border); max-height: 320px; overflow-y: auto; }
        .fl-ndd-section { padding: 10px 12px; background: var(--c-surface); }
        .fl-ndd-lbl { font-size: 10px; font-weight: 700; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
        .fl-ndd-lbl.in    { color: var(--c-green); }
        .fl-ndd-lbl.out   { color: var(--c-blue);  }
        .fl-ndd-lbl.state { color: var(--c-amber); }
        .fl-ndd-ev { font-size: 11px; color: var(--c-text2); margin-bottom: 4px; }
        .fl-ndd-dur { font-size: 9px; font-family: var(--mono); background: var(--c-surface3); padding: 1px 5px; border-radius: 3px; color: var(--c-muted); }
        .fl-root ::-webkit-scrollbar { width: 5px; height: 5px; }
        .fl-root ::-webkit-scrollbar-track { background: var(--c-bg); }
        .fl-root ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 3px; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    </div>
  );
}
