import { useEffect, useMemo, useState } from 'react'
import { get } from '../lib/api'

/* ── color helpers ── */
const SC = {
  green: ['OK','PASS','COMPLETED','APPROVED','STARTED'],
  red:   ['REJECTED','FAILED','REJECT','UNAVAILABLE','ENGINE_ERROR','ENGINE_UNREACHABLE','TERMINATED'],
  amber: ['REVIEW','SKIPPED','SUSPENDED','PENDING'],
}
function sColor(s) {
  if (SC.green.includes(s)) return 'var(--green)'
  if (SC.red.includes(s))   return 'var(--red)'
  if (SC.amber.includes(s)) return 'var(--amber)'
  return 'var(--blue)'
}
function sBadge(s) {
  if (SC.green.includes(s)) return 'badge-green'
  if (SC.red.includes(s))   return 'badge-red'
  if (SC.amber.includes(s)) return 'badge-amber'
  return 'badge-blue'
}

function ts(v) { return v ? String(v).slice(11, 19) : '—' }
function elapsed(a, b) {
  if (!a || !b) return null
  const ms = new Date(b) - new Date(a)
  if (ms < 0) return null
  return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${Math.round(ms/60000)}m`
}

/* ── word wrap for SVG text ── */
function wrapText(text, maxChars) {
  const words = (text || '').split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if (!line) { line = w; continue }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [text || '']
}

/* ── Flexible node ID matching (handles task_X vs X) ── */
function buildIsTraced(tracedSet) {
  return (nodeId) => {
    if (!tracedSet?.size) return false
    if (tracedSet.has(nodeId)) return true
    const bare = nodeId.replace(/^task_/, '').replace(/^parse_/, '')
    for (const t of tracedSet) {
      const tBare = t.replace(/^task_/, '').replace(/^parse_/, '')
      if (tBare === bare || t === bare || t === 'task_' + bare) return true
    }
    return false
  }
}

/* ── BPMN 2D Canvas (app-themed) ── */
function BpmnFlowCanvas({ model, tracedNodeIds, failedNodeIds, onNodeClick, selectedNodeId }) {
  const { nodes = [], edges = [] } = model || {}
  if (!nodes.length) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
      Loading BPMN model…
    </div>
  )

  const allX = nodes.flatMap(n => [n.x, n.x + (n.w || 80)])
  const allY = nodes.flatMap(n => [n.y, n.y + (n.h || 50)])
  const PAD = 30
  const minX = Math.min(...allX) - PAD, minY = Math.min(...allY) - PAD
  const vw = Math.max(...allX) - minX + PAD, vh = Math.max(...allY) - minY + PAD + 22

  const nodeMap = {}
  nodes.forEach(n => { nodeMap[n.id] = n })

  const isTracedNode = buildIsTraced(tracedNodeIds)
  const isFailedNode = (id) => failedNodeIds?.has(id) || buildIsTraced(failedNodeIds)(id)
  const matchedCount = nodes.filter(n => isTracedNode(n.id)).length
  const hasTrace = (tracedNodeIds?.size > 0) && matchedCount > 0

  const nodeColor = (node) => {
    if (selectedNodeId === node.id)    return 'var(--blue)'
    if (isFailedNode(node.id))         return 'var(--red)'
    if (hasTrace && isTracedNode(node.id)) return 'var(--green)'
    return 'var(--border-2, var(--border-1))'
  }
  const nodeOp = (node) => {
    if (!hasTrace) return 0.85
    return isTracedNode(node.id) || selectedNodeId === node.id ? 1 : 0.22
  }

  return (
    <div style={{ borderRadius: 6, background: 'var(--bg-2)' }}>
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`}
        xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: 'auto' }}>
        <defs>
          <marker id="pt-arr"  markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">
            <polygon points="0,0 7,3 0,6" fill="var(--border-1)" />
          </marker>
          <marker id="pt-arrG" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">
            <polygon points="0,0 7,3 0,6" fill="var(--green)" />
          </marker>
          <marker id="pt-arrR" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">
            <polygon points="0,0 7,3 0,6" fill="var(--red)" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map(edge => {
          const sv = hasTrace && (isTracedNode(edge.sourceRef) || isFailedNode(edge.sourceRef))
          const tv = hasTrace && (isTracedNode(edge.targetRef) || isFailedNode(edge.targetRef))
          const active = sv && tv
          const hasFail = active && (isFailedNode(edge.sourceRef) || isFailedNode(edge.targetRef))
          let pts = ''
          if (edge.waypoints?.length) {
            pts = edge.waypoints.map(wp => Array.isArray(wp) ? `${wp[0]},${wp[1]}` : `${wp.x},${wp.y}`).join(' ')
          } else {
            const s = nodeMap[edge.sourceRef], t = nodeMap[edge.targetRef]
            if (!s || !t) return null
            pts = `${s.x+(s.w||80)/2},${s.y+(s.h||50)/2} ${t.x+(t.w||80)/2},${t.y+(t.h||50)/2}`
          }
          return (
            <polyline key={edge.id} points={pts} fill="none"
              stroke={hasFail ? 'var(--red)' : active ? 'var(--green)' : 'var(--border-1)'}
              strokeWidth={active ? 1.5 : 0.8}
              opacity={hasTrace ? (active ? 0.9 : 0.18) : 0.5}
              markerEnd={hasFail ? 'url(#pt-arrR)' : active ? 'url(#pt-arrG)' : 'url(#pt-arr)'} />
          )
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const col = nodeColor(node)
          const op  = nodeOp(node)
          const vis = hasTrace && isTracedNode(node.id)
          const sel = selectedNodeId === node.id
          const fail = isFailedNode(node.id)
          const fill = (vis || sel || fail) ? col + '20' : 'transparent'
          const sw = sel ? 2.5 : (vis || fail) ? 1.5 : 0.8
          const w = node.w || 80, h = node.h || 50
          const cx = node.x + w/2, cy = node.y + h/2
          const onClick = () => onNodeClick?.(node)

          if (node.type?.includes('Gateway')) {
            return (
              <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: 'pointer' }}>
                <polygon points={`${cx},${node.y} ${node.x+w},${cy} ${cx},${node.y+h} ${node.x},${cy}`}
                  fill={fill} stroke={col} strokeWidth={sw} />
                <text x={cx} y={node.y+h+13} textAnchor="middle" fill={col} fontSize={8} fontWeight={sel?700:400}>
                  {(node.name||node.id).slice(0,16)}
                </text>
              </g>
            )
          }
          if (node.type?.includes('Event')) {
            const r = w/2
            return (
              <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: 'pointer' }}>
                <circle cx={cx} cy={cy} r={r} fill={fill} stroke={col} strokeWidth={sw} />
                {node.type === 'endEvent' && <circle cx={cx} cy={cy} r={r-3} fill="none" stroke={col} strokeWidth={2} />}
                <text x={cx} y={node.y+h+13} textAnchor="middle" fill={col} fontSize={8} fontWeight={sel?700:400}>
                  {(node.name||node.id).slice(0,16)}
                </text>
              </g>
            )
          }
          const maxC = Math.max(6, Math.floor(w/7))
          const lines = wrapText(node.name||node.id, maxC)
          const lh = 10, sty = cy - ((lines.length-1)*lh/2)
          return (
            <g key={node.id} opacity={op} onClick={onClick} style={{ cursor: 'pointer' }}>
              <rect x={node.x} y={node.y} width={w} height={h} rx={4} fill={fill} stroke={col} strokeWidth={sw} />
              {node.type === 'serviceTask' && <rect x={node.x} y={node.y} width={3} height={h} rx={1} fill={col} opacity={0.7} />}
              {sel && <rect x={node.x-2} y={node.y-2} width={w+4} height={h+4} rx={5} fill="none" stroke={col} strokeWidth={1.5} opacity={0.6} />}
              {lines.map((ln,i) => (
                <text key={i} x={cx} y={sty+i*lh} textAnchor="middle" dominantBaseline="middle"
                  fill={col} fontSize={9} fontWeight={sel||fail?700:vis?600:400}>{ln}</text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Node stage drawer ── */
function NodeStageDrawer({ node, events, onClose }) {
  if (!node) return null
  const nodeId = node.id
  const evs = events.filter(ev =>
    ev.service_id === nodeId || ev.stage === nodeId ||
    (ev.service_id && nodeId.includes(ev.service_id.replace(/^task_/,''))) ||
    (ev.service_id && ev.service_id.includes(nodeId.replace(/^task_/,'')))
  )
  const inEv  = evs.find(e => e.direction === 'IN'  || e.direction === 'REQUEST')
  const outEv = evs.find(e => e.direction === 'OUT' || e.direction === 'RESPONSE')
  const dur   = elapsed(inEv?.created_at, outEv?.created_at)
  const typeTag = node.type?.includes('service')?'http':node.type?.includes('Gateway')?'gw':node.type?.includes('Event')?'ev':'script'

  return (
    <div className="pt-nsd">
      <div className="pt-nsd-hdr">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span className="pt-nsd-title">{node.name||node.id}</span>
          <span className={`pt-nsd-type pt-nsd-type-${typeTag}`}>{node.type}</span>
          <span className="pt-nsd-id">{node.id}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {dur && <span className="pt-nsd-dur">{dur}</span>}
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>
      </div>
      {evs.length === 0 ? (
        <div className="pt-nsd-empty">No tracker events recorded for this activity</div>
      ) : (
        <div className="pt-nsd-cols">
          {inEv && (
            <div className="pt-nsd-col">
              <div className="pt-nsd-col-hdr in">→ Input <span className="pt-mono">{ts(inEv.created_at)}</span></div>
              {inEv.title && <div className="pt-nsd-ev-title">{inEv.title}</div>}
              <pre className="pt-json">{JSON.stringify(inEv.payload || inEv.data || {}, null, 2)}</pre>
            </div>
          )}
          {outEv && (
            <div className="pt-nsd-col">
              <div className="pt-nsd-col-hdr out">
                ← Output <span className="pt-mono">{ts(outEv.created_at)}</span>
                {outEv.status && <span className={`badge ${sBadge(outEv.status)}`} style={{fontSize:9}}>{outEv.status}</span>}
              </div>
              {outEv.title && <div className="pt-nsd-ev-title">{outEv.title}</div>}
              <pre className="pt-json">{JSON.stringify(outEv.payload || outEv.data || {}, null, 2)}</pre>
            </div>
          )}
          {evs.filter(e=>!['IN','OUT','REQUEST','RESPONSE'].includes(e.direction)).map((ev,i)=>(
            <div key={i} className="pt-nsd-col">
              <div className="pt-nsd-col-hdr state">{ev.direction||'●'} {ev.title}</div>
              {ev.status && <span className={`badge ${sBadge(ev.status)}`} style={{fontSize:9}}>{ev.status}</span>}
              <pre className="pt-json">{JSON.stringify(ev.payload||ev.data||{},null,2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Waterfall bar chart ── */
function WaterfallChart({ events }) {
  if (!events.length) return <p className="text-muted text-sm">No events</p>
  const t0 = new Date(events[0].created_at || 0).getTime()
  const tLast = new Date(events[events.length-1].created_at || 0).getTime()
  const totalMs = Math.max(tLast - t0, 1)

  // Build rows: pair IN/OUT per service
  const serviceOrder = []
  const seen = new Set()
  events.forEach(ev => {
    const key = ev.service_id || ev.stage || 'unknown'
    if (!seen.has(key)) { seen.add(key); serviceOrder.push(key) }
  })

  const rows = serviceOrder.map(svcId => {
    const evs = events.filter(e => (e.service_id || e.stage || 'unknown') === svcId)
    const inEv  = evs.find(e => e.direction === 'IN'  || e.direction === 'REQUEST') || evs[0]
    const outEv = evs.find(e => e.direction === 'OUT' || e.direction === 'RESPONSE') || evs[evs.length-1]
    const stEv  = evs.find(e => e.status)
    const startMs = inEv  ? new Date(inEv.created_at).getTime()  - t0 : 0
    const endMs   = outEv ? new Date(outEv.created_at).getTime() - t0 : startMs + 10
    const durMs = Math.max(endMs - startMs, 1)
    return { svcId, startMs, durMs, status: stEv?.status, inEv, outEv }
  })

  return (
    <div className="pt-wf">
      <div className="pt-wf-header">
        <span>Activity</span><span>Timeline →</span><span style={{textAlign:'right'}}>Duration</span>
      </div>
      {rows.map(row => {
        const left = (row.startMs / totalMs * 100).toFixed(1)
        const width = Math.max(row.durMs / totalMs * 100, 0.5).toFixed(1)
        const col = sColor(row.status)
        return (
          <div key={row.svcId} className="pt-wf-row">
            <div className="pt-wf-svc">
              <span className="pt-wf-dot" style={{background: col}} />
              <span className="pt-wf-name">{row.svcId}</span>
            </div>
            <div className="pt-wf-bar-wrap">
              <div className="pt-wf-bar" style={{ left:`${left}%`, width:`${width}%`, background: col }} />
            </div>
            <div className="pt-wf-dur" style={{ color: col }}>
              {row.durMs < 1000 ? `${row.durMs}ms` : `${(row.durMs/1000).toFixed(1)}s`}
            </div>
          </div>
        )
      })}
      <div className="pt-wf-scale">
        <span>0ms</span>
        <span>{Math.round(totalMs/2)}ms</span>
        <span>{totalMs}ms</span>
      </div>
    </div>
  )
}

/* ── Payload inspector ── */
function PayloadInspector({ events }) {
  const [expanded, setExpanded] = useState(new Set())
  const toggle = id => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div className="pt-payload-list">
      {events.map((ev, i) => {
        const hasPayload = ev.payload && Object.keys(ev.payload).length > 0
        const isOpen = expanded.has(ev.id || i)
        const col = sColor(ev.status)
        return (
          <div key={ev.id || i} className="pt-pay-row">
            <div className="pt-pay-header" onClick={() => hasPayload && toggle(ev.id || i)}
              style={{ cursor: hasPayload ? 'pointer' : 'default' }}>
              <span className="pt-pay-dot" style={{ background: col }} />
              <span className="pt-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{ts(ev.created_at)}</span>
              <span className={`pt-pay-dir pt-dir-${(ev.direction||'').toLowerCase()}`}>{ev.direction}</span>
              <span className="pt-pay-svc">{ev.service_id || ev.stage}</span>
              <span className="pt-pay-title">{ev.title}</span>
              {ev.status && <span className={`badge ${sBadge(ev.status)}`} style={{fontSize:9}}>{ev.status}</span>}
              {hasPayload && <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-3)' }}>{isOpen?'▲':'▼'}</span>}
            </div>
            {isOpen && hasPayload && (
              <pre className="pt-json pt-json-sm">{JSON.stringify(ev.payload, null, 2)}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Main ── */
export default function ProcessTrackerPage() {
  const [items,        setItems]        = useState([])
  const [processModel, setProcessModel] = useState(null)
  const [requestId,    setRequestId]    = useState('')
  const [filter,       setFilter]       = useState('')
  const [selGroupId,   setSelGroupId]   = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [activeTab,    setActiveTab]    = useState('flow')
  const [error,        setError]        = useState('')

  const load = (rid = requestId) => {
    const q = rid ? `?request_id=${encodeURIComponent(rid)}` : ''
    get(`/api/v1/process-tracker${q}`)
      .then(d => { setItems(d.items || []); setError('') })
      .catch(e => setError(e.message))
  }

  useEffect(() => {
    get('/api/v1/process-model').then(setProcessModel).catch(() => {})
    load('')
  }, [])

  // Group events by request_id
  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const key = item.request_id || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return Array.from(map.entries()).map(([k, evts]) => {
      const sorted = [...evts].sort((a, b) => new Date(a.created_at||0) - new Date(b.created_at||0))
      const last = sorted[sorted.length - 1]
      return { request_id: k, events: sorted, status: last?.status || 'UNKNOWN' }
    }).sort((a,b) => (b.events[b.events.length-1]?.created_at||'').localeCompare(a.events[a.events.length-1]?.created_at||''))
  }, [items])

  const filteredGroups = filter ? grouped.filter(g => g.status === filter) : grouped
  const selGroup = grouped.find(g => g.request_id === selGroupId) || filteredGroups[0] || null

  useEffect(() => {
    if (selGroup && !selGroupId) setSelGroupId(selGroup.request_id)
  }, [selGroup?.request_id])

  // Auto-refresh running
  useEffect(() => {
    if (!selGroup?.request_id || selGroup.status !== 'RUNNING') return
    const t = setInterval(() => load(selGroup.request_id), 3000)
    return () => clearInterval(t)
  }, [selGroup?.request_id, selGroup?.status])

  // Traced nodes from selected group's events
  const tracedNodeIds = useMemo(() => {
    if (!selGroup) return new Set()
    const s = new Set()
    selGroup.events.forEach(ev => {
      if (ev.service_id) s.add(ev.service_id)
      if (ev.stage) s.add(ev.stage)
    })
    return s
  }, [selGroup?.request_id, items])

  const tracedMatchCount = useMemo(() => {
    if (!processModel?.nodes || !tracedNodeIds.size) return 0
    const isTraced = buildIsTraced(tracedNodeIds)
    return processModel.nodes.filter(n => isTraced(n.id)).length
  }, [processModel, tracedNodeIds])

  const failedNodeIds = useMemo(() => {
    if (!selGroup) return new Set()
    const s = new Set()
    selGroup.events.filter(e => SC.red.includes(e.status)).forEach(e => {
      if (e.service_id) s.add(e.service_id)
    })
    return s
  }, [selGroup?.request_id, items])

  // Key outcome metrics from events
  const outcome = useMemo(() => {
    if (!selGroup) return {}
    const evts = selGroup.events
    const last = [...evts].reverse().find(e => e.stage === 'request' && e.payload && typeof e.payload === 'object')
    const payload = last?.payload || {}
    const summary = payload.summary || {}
    const t0 = new Date(evts[0]?.created_at || 0)
    const tN = new Date(evts[evts.length-1]?.created_at || 0)
    const totalMs = tN - t0
    return {
      decision: payload.decision || summary.decision || '—',
      reason:   payload.decision_reason || summary.decision_reason || '—',
      score:    summary.credit_score ?? '—',
      collections: summary.collection_count ?? '—',
      totalMs,
    }
  }, [selGroup?.request_id, items])

  return (
    <>
      <style>{`
        .pt-layout { display:flex; height:calc(100vh - 170px); min-height:500px; gap:0; }
        .pt-left { width:260px; min-width:200px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--border-1); }
        .pt-left-top { padding:8px 10px; border-bottom:1px solid var(--border-1); display:flex; flex-direction:column; gap:5px; flex-shrink:0; }
        .pt-search-row { display:flex; gap:5px; align-items:center; }
        .pt-search { flex:1; padding:4px 8px; border-radius:5px; border:1px solid var(--border-1); background:var(--bg-2); color:var(--text-1); font-size:11px; outline:none; }
        .pt-search:focus { border-color:var(--blue); }
        .pt-flt-row { display:flex; gap:3px; flex-wrap:wrap; }
        .pt-flt { padding:1px 6px; border-radius:3px; border:1px solid var(--border-1); background:transparent; color:var(--text-3); font-size:9px; font-weight:600; cursor:pointer; }
        .pt-flt.active { background:var(--blue); color:#fff; border-color:var(--blue); }
        .pt-list { flex:1; overflow-y:auto; }
        .pt-item { padding:6px 10px; border-bottom:1px solid var(--border-1); cursor:pointer; transition:background 0.1s; }
        .pt-item:hover { background:var(--bg-2); }
        .pt-item.active { background:color-mix(in srgb,var(--blue) 10%,transparent); border-left:2px solid var(--blue); }
        .pt-item-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:2px; }
        .pt-item-id { font-size:10px; font-family:monospace; font-weight:700; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
        .pt-item-sub { font-size:9px; color:var(--text-3); display:flex; align-items:center; gap:5px; }
        /* right panel */
        .pt-right { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
        .pt-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-3); font-size:13px; }
        .pt-right-hdr { padding:10px 14px; border-bottom:1px solid var(--border-1); display:flex; flex-wrap:wrap; align-items:center; gap:8px; flex-shrink:0; }
        .pt-right-id { font-size:13px; font-weight:700; font-family:monospace; color:var(--text-1); }
        .pt-metrics { display:flex; gap:10px; flex-wrap:wrap; margin-left:auto; }
        .pt-metric { display:flex; flex-direction:column; align-items:flex-end; }
        .pt-metric-label { font-size:8px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px; }
        .pt-metric-val { font-size:13px; font-weight:700; font-family:monospace; color:var(--text-1); line-height:1; }
        .pt-tabs { display:flex; border-bottom:1px solid var(--border-1); padding:0 14px; flex-shrink:0; }
        .pt-tab { padding:7px 12px; font-size:11px; font-weight:600; color:var(--text-3); border:none; border-bottom:2px solid transparent; background:transparent; cursor:pointer; transition:all 0.12s; }
        .pt-tab.active { color:var(--blue); border-bottom-color:var(--blue); }
        .pt-tab:hover:not(.active) { color:var(--text-1); }
        .pt-body { flex:1; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
        /* node drawer */
        .pt-nsd { border:1px solid var(--border-1); border-radius:6px; overflow:hidden; flex-shrink:0; }
        .pt-nsd-hdr { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg-2); border-bottom:1px solid var(--border-1); }
        .pt-nsd-title { font-size:12px; font-weight:700; color:var(--text-1); }
        .pt-nsd-type { padding:1px 5px; border-radius:3px; font-size:9px; font-weight:700; font-family:monospace; }
        .pt-nsd-type-http { background:color-mix(in srgb,var(--blue) 15%,transparent); color:var(--blue); }
        .pt-nsd-type-gw   { background:color-mix(in srgb,var(--amber) 15%,transparent); color:var(--amber); }
        .pt-nsd-type-ev   { background:color-mix(in srgb,var(--green) 15%,transparent); color:var(--green); }
        .pt-nsd-type-script { background:var(--bg-2); color:var(--text-3); }
        .pt-nsd-id { font-size:9px; font-family:monospace; color:var(--text-3); }
        .pt-nsd-dur { font-size:10px; font-family:monospace; background:var(--bg-2); padding:2px 6px; border-radius:4px; color:var(--blue); font-weight:700; }
        .pt-nsd-empty { padding:14px; text-align:center; color:var(--text-3); font-size:11px; }
        .pt-nsd-cols { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1px; background:var(--border-1); max-height:280px; overflow-y:auto; }
        .pt-nsd-col { padding:10px 12px; background:var(--bg-1); }
        .pt-nsd-col-hdr { font-size:10px; font-weight:700; margin-bottom:5px; display:flex; align-items:center; gap:6px; }
        .pt-nsd-col-hdr.in    { color:var(--green); }
        .pt-nsd-col-hdr.out   { color:var(--blue);  }
        .pt-nsd-col-hdr.state { color:var(--amber); }
        .pt-nsd-ev-title { font-size:11px; color:var(--text-2); margin-bottom:4px; }
        /* waterfall */
        .pt-wf { display:flex; flex-direction:column; gap:0; }
        .pt-wf-header { display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; letter-spacing:0.6px; padding:4px 0; border-bottom:1px solid var(--border-1); margin-bottom:4px; }
        .pt-wf-header span:first-child { width:180px; flex-shrink:0; }
        .pt-wf-header span:last-child { width:50px; text-align:right; }
        .pt-wf-row { display:flex; align-items:center; gap:8px; padding:2px 0; border-bottom:1px solid color-mix(in srgb,var(--border-1) 50%,transparent); }
        .pt-wf-svc { width:180px; flex-shrink:0; display:flex; align-items:center; gap:5px; overflow:hidden; }
        .pt-wf-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .pt-wf-name { font-size:10px; font-family:monospace; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pt-wf-bar-wrap { flex:1; height:10px; background:var(--bg-2); border-radius:3px; position:relative; overflow:hidden; }
        .pt-wf-bar { position:absolute; height:100%; border-radius:3px; opacity:0.8; }
        .pt-wf-dur { width:50px; font-size:9px; font-family:monospace; text-align:right; flex-shrink:0; }
        .pt-wf-scale { display:flex; justify-content:space-between; font-size:9px; color:var(--text-3); padding-top:4px; margin-left:188px; }
        /* payload */
        .pt-payload-list { display:flex; flex-direction:column; gap:0; }
        .pt-pay-row { border-bottom:1px solid color-mix(in srgb,var(--border-1) 50%,transparent); }
        .pt-pay-header { display:flex; align-items:center; gap:6px; padding:5px 2px; flex-wrap:wrap; }
        .pt-pay-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .pt-pay-dir { padding:1px 5px; border-radius:3px; font-size:9px; font-weight:700; flex-shrink:0; }
        .pt-dir-in,.pt-dir-request { background:color-mix(in srgb,var(--green) 15%,transparent); color:var(--green); }
        .pt-dir-out,.pt-dir-response { background:color-mix(in srgb,var(--blue) 15%,transparent); color:var(--blue); }
        .pt-dir-state { background:color-mix(in srgb,var(--amber) 15%,transparent); color:var(--amber); }
        .pt-pay-svc { font-size:10px; font-family:monospace; font-weight:600; color:var(--text-1); }
        .pt-pay-title { font-size:10px; color:var(--text-2); flex:1; }
        /* shared */
        .pt-json { font-size:10px; font-family:monospace; color:var(--text-3); background:var(--bg-2); padding:8px 10px; border-radius:4px; overflow:auto; white-space:pre-wrap; word-break:break-all; max-height:200px; margin:4px 0; }
        .pt-json-sm { font-size:9px; max-height:150px; margin:0 12px 8px; }
        .pt-mono { font-family:monospace; }
      `}</style>

      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="pt-layout">
        {/* ── LEFT: list ── */}
        <div className="pt-left">
          <div className="pt-left-top">
            <div className="pt-search-row">
              <input className="pt-search" placeholder="Request ID…" value={requestId}
                onChange={e => setRequestId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load()} />
              <button className="btn btn-ghost btn-xs" onClick={() => load()}>↵</button>
              <button className="btn btn-ghost btn-xs" onClick={() => { setRequestId(''); load('') }}>✕</button>
            </div>
            <div className="pt-flt-row">
              {['','COMPLETED','RUNNING','REVIEW','FAILED'].map(f => (
                <button key={f} className={`pt-flt${filter===f?' active':''}`} onClick={()=>setFilter(f)}>
                  {f||'All'}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-list">
            {filteredGroups.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>No requests</div>
            ) : filteredGroups.map(g => (
              <div key={g.request_id}
                className={`pt-item${selGroup?.request_id === g.request_id ? ' active' : ''}`}
                onClick={() => { setSelGroupId(g.request_id); setSelectedNode(null); setActiveTab('flow') }}>
                <div className="pt-item-top">
                  <span className="pt-item-id">{g.request_id}</span>
                  <span className={`badge ${sBadge(g.status)}`} style={{ fontSize: 8 }}>{g.status.toLowerCase()}</span>
                </div>
                <div className="pt-item-sub">
                  <span>{g.events.length} events</span>
                  <span>·</span>
                  <span>{ts(g.events[g.events.length-1]?.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: detail ── */}
        <div className="pt-right">
          {!selGroup ? (
            <div className="pt-empty">← Select a request to trace its pipeline path</div>
          ) : (
            <>
              {/* Header with key metrics */}
              <div className="pt-right-hdr">
                <span className="pt-right-id">{selGroup.request_id}</span>
                <span className={`badge ${sBadge(selGroup.status)}`}>{selGroup.status.toLowerCase()}</span>
                <div className="pt-metrics">
                  {outcome.decision !== '—' && (
                    <div className="pt-metric">
                      <span className="pt-metric-label">Decision</span>
                      <span className="pt-metric-val" style={{ color: outcome.decision==='APPROVED'?'var(--green)':outcome.decision==='REJECTED'?'var(--red)':'var(--amber)' }}>
                        {outcome.decision}
                      </span>
                    </div>
                  )}
                  {outcome.score !== '—' && (
                    <div className="pt-metric">
                      <span className="pt-metric-label">Credit Score</span>
                      <span className="pt-metric-val">{outcome.score}</span>
                    </div>
                  )}
                  {outcome.totalMs > 0 && (
                    <div className="pt-metric">
                      <span className="pt-metric-label">Total time</span>
                      <span className="pt-metric-val">
                        {outcome.totalMs < 1000 ? `${outcome.totalMs}ms` : `${(outcome.totalMs/1000).toFixed(1)}s`}
                      </span>
                    </div>
                  )}
                  <div className="pt-metric">
                    <span className="pt-metric-label">Events</span>
                    <span className="pt-metric-val">{selGroup.events.length}</span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="pt-tabs">
                {[
                  { id: 'flow',      label: '⬡ Flow Path'   },
                  { id: 'waterfall', label: '▦ Timeline'    },
                  { id: 'payloads',  label: '{ } Payloads'  },
                ].map(t => (
                  <button key={t.id} className={`pt-tab${activeTab===t.id?' active':''}`}
                    onClick={() => setActiveTab(t.id)}>{t.label}</button>
                ))}
              </div>

              <div className="pt-body">

                {/* ── Flow Path ── */}
                {activeTab === 'flow' && (
                  <>
                    <div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--text-1)' }}>
                          BPMN Process Path
                          {selectedNode && <button className="btn btn-ghost btn-xs" style={{marginLeft:8}} onClick={() => setSelectedNode(null)}>clear</button>}
                        </span>
                        <span style={{ fontSize:10, color:'var(--text-3)' }}>
                          {tracedMatchCount || tracedNodeIds.size} nodes visited · click a node to inspect
                        </span>
                      </div>
                      <BpmnFlowCanvas
                        model={processModel}
                        tracedNodeIds={tracedNodeIds}
                        failedNodeIds={failedNodeIds}
                        onNodeClick={setSelectedNode}
                        selectedNodeId={selectedNode?.id}
                      />
                    </div>

                    <NodeStageDrawer
                      node={selectedNode}
                      events={selGroup.events}
                      onClose={() => setSelectedNode(null)}
                    />

                    {!selectedNode && outcome.reason && outcome.reason !== '—' && (
                      <div className="card" style={{ margin:0, padding:'10px 14px' }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-1)', marginBottom:4 }}>Decision reason</div>
                        <div style={{ fontSize:12, color:'var(--text-2)' }}>{outcome.reason}</div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Waterfall ── */}
                {activeTab === 'waterfall' && (
                  <WaterfallChart events={selGroup.events} />
                )}

                {/* ── Payloads ── */}
                {activeTab === 'payloads' && (
                  <PayloadInspector events={selGroup.events} />
                )}

              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
