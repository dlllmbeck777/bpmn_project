import { useEffect, useMemo, useState } from 'react'
import { get, getUserRole, post } from '../lib/api'

/* ── helpers ── */
const SC = {
  green: ['COMPLETED','APPROVED','OK','PASS'],
  red:   ['FAILED','REJECTED','ENGINE_ERROR','ENGINE_UNREACHABLE','ORPHANED','REJECT','UNAVAILABLE'],
  amber: ['REVIEW','SUSPENDED','PENDING','RETRIED'],
  blue:  ['RUNNING','SUBMITTED','STARTED','CLONED'],
}
function sBadge(s) {
  if (SC.green.includes(s)) return 'badge-green'
  if (SC.red.includes(s))   return 'badge-red'
  if (SC.amber.includes(s)) return 'badge-amber'
  if (SC.blue.includes(s))  return 'badge-blue'
  return 'badge-gray'
}
function sColor(s) {
  if (SC.green.includes(s)) return 'var(--green)'
  if (SC.red.includes(s))   return 'var(--red)'
  if (SC.amber.includes(s)) return 'var(--amber)'
  return 'var(--blue)'
}
function applicantName(r) {
  return r.applicant_name || [r.applicant_profile?.firstName, r.applicant_profile?.lastName].filter(Boolean).join(' ') || '—'
}
function toUtcIso(v) { const p = new Date(v); return isNaN(p) ? '' : p.toISOString() }
function noteTime(v) { return v ? String(v).slice(0, 19).replace('T', ' ') : '—' }
function metricVal(result, key) {
  const v = result?.summary?.[key] ?? result?.[key]
  return v === undefined || v === null ? '—' : String(v)
}
function decisionReason(result, status) {
  return result?.decision_reason || result?.summary?.decision_reason || result?.post_stop_factor?.reason
    || (status === 'RUNNING' ? 'Awaiting async callback…' : '—')
}
function elapsed(a, b) {
  if (!a || !b) return null
  const ms = new Date(b) - new Date(a)
  return ms < 0 ? null : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${Math.round(ms/60000)}m`
}
function ts(v) { return v ? String(v).slice(11, 19) : '—' }

/* ── word-wrap for SVG ── */
function wrapSvg(text, maxC) {
  const words = (text||'').split(/\s+/)
  const lines = []; let ln = ''
  for (const w of words) {
    if (!ln) { ln = w; continue }
    if ((ln+' '+w).length <= maxC) ln += ' '+w
    else { lines.push(ln); ln = w }
  }
  if (ln) lines.push(ln)
  return lines.length ? lines : [text||'']
}

/* ── Infer execution path: Dijkstra start→end
     cost: traced=0, skip-variant=1.5 (penalised), other=1
     skip variants of TRACED services are blocked; call variants of SKIPPED services are blocked ── */
function isSkipVariantNode(nodeId) {
  const b = nodeId.toLowerCase().replace(/^task_/, '')
  return b.endsWith('_skip') || b.startsWith('skip_')
}
function inferPathNodes(allNodes, allEdges, isTracedFn, skippedIds) {
  if (!allNodes?.length || !allEdges?.length) return new Set()
  const isBlockedBySkipped = buildIsTraced(skippedIds)  // call nodes of skipped services → blocked
  const fwd = {}
  allNodes.forEach(n => { fwd[n.id] = [] })
  allEdges.forEach(e => { if (fwd[e.sourceRef]) fwd[e.sourceRef].push(e.targetRef) })
  const hasIncoming = new Set(allEdges.map(e => e.targetRef))
  const hasOutgoing  = new Set(allEdges.map(e => e.sourceRef))
  // prefer typed start/end events; boundary events have no incoming but are not start events
  const startNode = allNodes.find(n => n.type === 'startEvent')
    || allNodes.find(n => !hasIncoming.has(n.id) && n.type?.includes('Event'))
    || allNodes.find(n => !hasIncoming.has(n.id))
  const endNode = allNodes.find(n => n.type === 'endEvent')
    || allNodes.find(n => !hasOutgoing.has(n.id) && n.type?.includes('Event'))
    || allNodes.find(n => !hasOutgoing.has(n.id))
  if (!startNode || !endNode) return new Set()
  const dist = {}; const prev = {}
  allNodes.forEach(n => { dist[n.id] = Infinity })
  dist[startNode.id] = 0
  const queue = [startNode.id]; const visited = new Set()
  while (queue.length) {
    queue.sort((a, b) => dist[a] - dist[b])
    const curr = queue.shift()
    if (visited.has(curr)) continue
    visited.add(curr)
    if (curr === endNode.id) break
    for (const next of (fwd[curr] || [])) {
      if (visited.has(next)) continue
      if (isBlockedBySkipped(next) && !isSkipVariantNode(next)) continue  // block call nodes of skipped services
      const nodeCost = isTracedFn(next) ? 0 : isSkipVariantNode(next) ? 1.5 : 1
      const cost = dist[curr] + nodeCost
      if (cost < dist[next]) { dist[next] = cost; prev[next] = curr; queue.push(next) }
    }
  }
  if (dist[endNode.id] === Infinity) return new Set()
  const path = []; let c = endNode.id
  while (c !== undefined) { path.unshift(c); c = prev[c] }
  return new Set(path)
}

/* ── isTracedNode: match "isoftpull" ↔ "task_isoftpull", case-insensitive ── */
function buildIsTraced(tracedSet) {
  return (nodeId) => {
    if (!tracedSet?.size) return false
    if (tracedSet.has(nodeId)) return true
    const bare = nodeId.replace(/^task_/, '').replace(/^parse_/, '').toLowerCase()
    for (const t of tracedSet) {
      const tBare = t.replace(/^task_/, '').replace(/^parse_/, '').toLowerCase()
      if (tBare === bare || t.toLowerCase() === bare || t.toLowerCase() === 'task_'+bare) return true
    }
    return false
  }
}

/* ── BPMN canvas ── */
function BpmnCanvas({ model, tracedNodeIds, pathNodeIds, failedNodeIds, skippedNodeIds, onNodeClick, selectedNodeId }) {
  const { nodes = [], edges = [] } = model || {}
  const isTraced  = useMemo(() => buildIsTraced(tracedNodeIds),  [tracedNodeIds])
  const isPath    = useMemo(() => buildIsTraced(pathNodeIds?.size ? pathNodeIds : tracedNodeIds), [pathNodeIds, tracedNodeIds])
  const isFailed  = useMemo(() => buildIsTraced(failedNodeIds),  [failedNodeIds])
  const isSkipped = useMemo(() => buildIsTraced(skippedNodeIds), [skippedNodeIds])
  const matchedCount = useMemo(() => nodes.filter(n => isPath(n.id)).length, [nodes, isPath])
  const hasTrace = ((pathNodeIds?.size || tracedNodeIds?.size) > 0) && matchedCount > 0

  if (!nodes.length) return <div className="rqb-empty">Loading BPMN model…</div>

  const allX = nodes.flatMap(n => [n.x, n.x+(n.w||80)])
  const allY = nodes.flatMap(n => [n.y, n.y+(n.h||50)])
  const P = 30
  const minX = Math.min(...allX)-P, minY = Math.min(...allY)-P
  const vw = Math.max(...allX)-minX+P, vh = Math.max(...allY)-minY+P+22
  const nodeMap = {}; nodes.forEach(n => { nodeMap[n.id]=n })

  const nodeCol = (node) => {
    if (selectedNodeId === node.id)       return 'var(--blue)'
    if (isFailed(node.id))               return 'var(--red)'
    if (hasTrace && isPath(node.id))     return 'var(--green)'
    if (isSkipped(node.id))              return 'var(--amber)'
    return 'var(--text-3)'
  }
  const nodeOp = (node) => {
    if (!hasTrace) return 0.8
    if (isPath(node.id)||isFailed(node.id)||selectedNodeId===node.id) return 1
    if (isSkipped(node.id)) return 0.65
    return 0.2
  }

  return (
    <div style={{ background:'var(--bg-2)', borderRadius:6 }}>
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`}
        xmlns="http://www.w3.org/2000/svg" style={{ display:'block', width:'100%', height:'auto' }}>
        <defs>
          <marker id="rq-a"  markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--border-1)"/></marker>
          <marker id="rq-ag" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--green)"/></marker>
          <marker id="rq-ar" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--red)"/></marker>
          <marker id="rq-aa" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--amber)"/></marker>
        </defs>
        {edges.map(edge => {
          const sv = hasTrace && (isPath(edge.sourceRef)||isFailed(edge.sourceRef))
          const tv = hasTrace && (isPath(edge.targetRef)||isFailed(edge.targetRef))
          const active = sv && tv   // both ends on path = definite path edge
          const hasFail = active&&(isFailed(edge.sourceRef)||isFailed(edge.targetRef))
          const isSkippedEdge = !active && hasTrace && (isSkipped(edge.sourceRef)||isSkipped(edge.targetRef))
          let pts = ''
          if (edge.waypoints?.length) pts = edge.waypoints.map(wp=>Array.isArray(wp)?`${wp[0]},${wp[1]}`:`${wp.x},${wp.y}`).join(' ')
          else { const s=nodeMap[edge.sourceRef],t=nodeMap[edge.targetRef]; if(!s||!t) return null; pts=`${s.x+(s.w||80)/2},${s.y+(s.h||50)/2} ${t.x+(t.w||80)/2},${t.y+(t.h||50)/2}` }
          const stroke = hasFail?'var(--red)':active?'var(--green)':isSkippedEdge?'var(--amber)':'var(--border-1)'
          const mEnd = hasFail?'url(#rq-ar)':active?'url(#rq-ag)':isSkippedEdge?'url(#rq-aa)':'url(#rq-a)'
          return <polyline key={edge.id} points={pts} fill="none"
            stroke={stroke} strokeWidth={active?2.5:isSkippedEdge?1:0.7}
            strokeDasharray={isSkippedEdge?'3,3':undefined}
            opacity={hasTrace?(active?1:isSkippedEdge?0.55:0.2):0.5}
            markerEnd={mEnd} />
        })}
        {nodes.map(node => {
          const col = nodeCol(node), op = nodeOp(node)
          const vis = hasTrace&&isPath(node.id)
          const isDirectTraced = hasTrace&&isTraced(node.id)
          const sel = selectedNodeId===node.id
          const fail = isFailed(node.id), skip = isSkipped(node.id)
          const fill = (vis||sel||fail||skip) ? col+'22' : 'transparent'
          const sw = sel?2.5:(isDirectTraced||fail)?1.5:vis?1.0:skip?1:0.7
          const w=node.w||80, h=node.h||50, cx=node.x+w/2, cy=node.y+h/2
          const click = ()=>onNodeClick?.(node)
          if (node.type?.includes('Gateway')) return (
            <g key={node.id} opacity={op} onClick={click} style={{cursor:'pointer'}}>
              <polygon points={`${cx},${node.y} ${node.x+w},${cy} ${cx},${node.y+h} ${node.x},${cy}`} fill={fill} stroke={col} strokeWidth={sw}/>
              <text x={cx} y={node.y+h+13} textAnchor="middle" fill={col} fontSize={8} fontWeight={sel?700:400}>{(node.name||node.id).slice(0,16)}</text>
            </g>
          )
          if (node.type?.includes('Event')) { const r=w/2; return (
            <g key={node.id} opacity={op} onClick={click} style={{cursor:'pointer'}}>
              <circle cx={cx} cy={cy} r={r} fill={fill} stroke={col} strokeWidth={sw}/>
              {node.type==='endEvent'&&<circle cx={cx} cy={cy} r={r-3} fill="none" stroke={col} strokeWidth={2}/>}
              <text x={cx} y={node.y+h+13} textAnchor="middle" fill={col} fontSize={8} fontWeight={sel?700:400}>{(node.name||node.id).slice(0,16)}</text>
            </g>
          )}
          const lines = wrapSvg(node.name||node.id, Math.max(6,Math.floor(w/7)))
          const lh=10, sy=cy-((lines.length-1)*lh/2)
          return (
            <g key={node.id} opacity={op} onClick={click} style={{cursor:'pointer'}}>
              <rect x={node.x} y={node.y} width={w} height={h} rx={4} fill={fill} stroke={col} strokeWidth={sw}
                strokeDasharray={skip?'4,2':undefined}/>
              {node.type==='serviceTask'&&<rect x={node.x} y={node.y} width={3} height={h} rx={1} fill={col} opacity={0.7}/>}
              {sel&&<rect x={node.x-2} y={node.y-2} width={w+4} height={h+4} rx={5} fill="none" stroke={col} strokeWidth={1.5} opacity={0.6}/>}
              {lines.map((ln,i)=><text key={i} x={cx} y={sy+i*lh} textAnchor="middle" dominantBaseline="middle" fill={col} fontSize={9} fontWeight={sel||fail?700:isDirectTraced?600:vis?500:400}>{ln}</text>)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Node IN/OUT payload drawer ── */
function NodeDetail({ node, tracker, onClose }) {
  if (!node) return null
  const isT = buildIsTraced(new Set([node.id]))
  const evs = tracker.filter(ev => isT(ev.service_id||'')||isT(ev.stage||'')||ev.service_id===node.id||ev.stage===node.id)
  const inEv  = evs.find(e=>e.direction==='IN'||e.direction==='REQUEST')
  const outEv = evs.find(e=>e.direction==='OUT'||e.direction==='RESPONSE')
  const dur = elapsed(inEv?.created_at, outEv?.created_at)
  return (
    <div className="rqb-nd">
      <div className="rqb-nd-hdr">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontWeight:700,fontSize:12,color:'var(--text-1)'}}>{node.name||node.id}</span>
          <span style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)'}}>{node.id}</span>
          {node.type&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'var(--bg-2)',color:'var(--text-3)',fontFamily:'monospace'}}>{node.type}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {dur&&<span className="rqb-dur">{dur}</span>}
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>
      </div>
      {evs.length===0 ? (
        <div style={{padding:'10px 14px',fontSize:11,color:'var(--text-3)'}}>No tracker events for this node</div>
      ) : (
        <div className="rqb-nd-body">
          {inEv&&<div className="rqb-nd-col">
            <div className="rqb-nd-lbl in">→ Input <span style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)'}}>{ts(inEv.created_at)}</span></div>
            {inEv.title&&<div style={{fontSize:11,color:'var(--text-2)',marginBottom:4}}>{inEv.title}</div>}
            <pre className="rqb-json">{JSON.stringify(inEv.payload||inEv.data||{},null,2)}</pre>
          </div>}
          {outEv&&<div className="rqb-nd-col">
            <div className="rqb-nd-lbl out">← Output <span style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)'}}>{ts(outEv.created_at)}</span>
              {outEv.status&&<span className={`badge ${sBadge(outEv.status)}`} style={{fontSize:9,marginLeft:4}}>{outEv.status}</span>}
            </div>
            {outEv.title&&<div style={{fontSize:11,color:'var(--text-2)',marginBottom:4}}>{outEv.title}</div>}
            <pre className="rqb-json">{JSON.stringify(outEv.payload||outEv.data||{},null,2)}</pre>
          </div>}
          {evs.filter(e=>!['IN','OUT','REQUEST','RESPONSE'].includes(e.direction)).map((ev,i)=>(
            <div key={i} className="rqb-nd-col">
              <div className="rqb-nd-lbl state">{ev.direction||'●'} {ev.title}</div>
              {ev.status&&<span className={`badge ${sBadge(ev.status)}`} style={{fontSize:9}}>{ev.status}</span>}
              <pre className="rqb-json">{JSON.stringify(ev.payload||ev.data||{},null,2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Waterfall timeline ── */
function WaterfallChart({ events }) {
  if (!events.length) return <p style={{color:'var(--text-3)',fontSize:11}}>No events</p>
  const t0 = new Date(events[0].created_at||0).getTime()
  const tLast = new Date(events[events.length-1].created_at||0).getTime()
  const totalMs = Math.max(tLast-t0, 1)
  const serviceOrder = []; const seen = new Set()
  events.forEach(ev => { const k=ev.service_id||ev.stage||'unknown'; if(!seen.has(k)){seen.add(k);serviceOrder.push(k)} })
  const rows = serviceOrder.map(svcId => {
    const evs = events.filter(e=>(e.service_id||e.stage||'unknown')===svcId)
    const inEv  = evs.find(e=>e.direction==='IN'||e.direction==='REQUEST')||evs[0]
    const outEv = evs.find(e=>e.direction==='OUT'||e.direction==='RESPONSE')||evs[evs.length-1]
    const stEv  = evs.find(e=>e.status)
    const startMs = inEv  ? new Date(inEv.created_at).getTime()-t0 : 0
    const endMs   = outEv ? new Date(outEv.created_at).getTime()-t0 : startMs+10
    const durMs = Math.max(endMs-startMs, 1)
    return { svcId, startMs, durMs, status: stEv?.status }
  })
  return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--text-3)',fontWeight:700,textTransform:'uppercase',padding:'4px 0',borderBottom:'1px solid var(--border-1)',marginBottom:4}}>
        <span style={{width:180,flexShrink:0}}>Activity</span><span>Timeline →</span><span style={{width:60,textAlign:'right',flexShrink:0}}>Duration</span>
      </div>
      {rows.map(row => {
        const left = (row.startMs/totalMs*100).toFixed(1)
        const width = Math.max(row.durMs/totalMs*100,0.5).toFixed(1)
        const col = sColor(row.status)
        return (
          <div key={row.svcId} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',borderBottom:'1px solid color-mix(in srgb,var(--border-1) 40%,transparent)'}}>
            <div style={{width:180,flexShrink:0,display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:col,flexShrink:0}}/>
              <span style={{fontSize:10,fontFamily:'monospace',color:'var(--text-2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.svcId}</span>
            </div>
            <div style={{flex:1,height:12,background:'var(--bg-2)',borderRadius:3,position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',left:`${left}%`,width:`${width}%`,height:'100%',background:col,borderRadius:3,opacity:0.85}}/>
            </div>
            <div style={{width:60,fontSize:9,fontFamily:'monospace',textAlign:'right',color:col,flexShrink:0}}>
              {row.durMs<1000?`${row.durMs}ms`:`${(row.durMs/1000).toFixed(1)}s`}
            </div>
          </div>
        )
      })}
      <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--text-3)',paddingTop:4,marginLeft:188}}>
        <span>0ms</span><span>{Math.round(totalMs/2)}ms</span><span>{totalMs}ms</span>
      </div>
    </div>
  )
}

/* ── Payload inspector ── */
function PayloadList({ events }) {
  const [open, setOpen] = useState(new Set())
  const toggle = id => setOpen(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  return (
    <div style={{display:'flex',flexDirection:'column'}}>
      {events.map((ev,i) => {
        const hasP = ev.payload && Object.keys(ev.payload).length>0
        const isOpen = open.has(ev.id||i)
        const col = sColor(ev.status)
        return (
          <div key={ev.id||i} style={{borderBottom:'1px solid color-mix(in srgb,var(--border-1) 40%,transparent)'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 2px',cursor:hasP?'pointer':'default',flexWrap:'wrap'}}
              onClick={()=>hasP&&toggle(ev.id||i)}>
              <span style={{width:6,height:6,borderRadius:'50%',background:col,flexShrink:0}}/>
              <span style={{fontFamily:'monospace',fontSize:10,color:'var(--text-3)'}}>{ts(ev.created_at)}</span>
              <span style={{padding:'1px 5px',borderRadius:3,fontSize:9,fontWeight:700,
                background:`color-mix(in srgb,${col} 15%,transparent)`,color:col}}>{ev.direction}</span>
              <span style={{fontSize:10,fontFamily:'monospace',fontWeight:600,color:'var(--text-1)'}}>{ev.service_id||ev.stage}</span>
              <span style={{fontSize:10,color:'var(--text-2)',flex:1}}>{ev.title}</span>
              {ev.status&&<span className={`badge ${sBadge(ev.status)}`} style={{fontSize:9}}>{ev.status}</span>}
              {hasP&&<span style={{marginLeft:'auto',fontSize:10,color:'var(--text-3)'}}>{isOpen?'▲':'▼'}</span>}
            </div>
            {isOpen&&hasP&&<pre className="rqb-json rqb-json-sm">{JSON.stringify(ev.payload,null,2)}</pre>}
          </div>
        )
      })}
    </div>
  )
}

/* ── Constants ── */
const FILTERS = ['','COMPLETED','RUNNING','REVIEW','REJECTED','FAILED','ENGINE_ERROR','ENGINE_UNREACHABLE']
const PAGE_SIZE = 30
const DATE_PRESETS = [
  { id: 'today',     label: 'Today'     },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d',        label: '7 days'    },
  { id: '30d',       label: '30 days'   },
  { id: 'all',       label: 'All'       },
]
function todayLocalStr() { return new Date().toISOString().slice(0, 10) }

export default function RequestsPage() {
  const userRole = useMemo(()=>getUserRole(),[])
  const canOperate = ['admin','senior_analyst'].includes(userRole)

  /* ── List state ── */
  const [items,         setItems]         = useState([])
  const [processModel,  setProcessModel]  = useState(null)
  const [filter,        setFilter]        = useState('')
  const [createdFrom,   setCreatedFrom]   = useState(todayLocalStr)
  const [createdTo,     setCreatedTo]     = useState('')
  const [datePreset,    setDatePreset]    = useState('today')
  const [needsAction,   setNeedsAction]   = useState(false)
  const [ignoredFilter, setIgnoredFilter] = useState('active')
  const [searchQ,       setSearchQ]       = useState('')
  const [page,          setPage]          = useState(0)

  /* ── Detail state ── */
  const [view,         setView]         = useState('list')   // 'list' | 'detail'
  const [detail,       setDetail]       = useState(null)
  const [detailLoading,setDetailLoading]= useState(false)
  const [tracker,      setTracker]      = useState([])
  const [detailTab,    setDetailTab]    = useState('flow')
  const [selectedNode, setSelectedNode] = useState(null)
  const [actionReason, setActionReason] = useState('')
  const [noteText,     setNoteText]     = useState('')
  const [busy,         setBusy]         = useState('')
  const [error,        setError]        = useState('')
  const [notice,       setNotice]       = useState('')
  const [plaidStatus,  setPlaidStatus]  = useState(null)
  const [plaidChecking,setPlaidChecking]= useState(false)

  /* ── Load list ── */
  const loadRequests = (ov={}) => {
    const nf  = ov.filter        !== undefined ? ov.filter        : filter
    const nFr = ov.createdFrom   !== undefined ? ov.createdFrom   : createdFrom
    const nTo = ov.createdTo     !== undefined ? ov.createdTo     : createdTo
    const nNA = ov.needsAction   !== undefined ? ov.needsAction   : needsAction
    const nIg = ov.ignoredFilter !== undefined ? ov.ignoredFilter : ignoredFilter
    const p = new URLSearchParams()
    if (nf)  p.set('status', nf)
    if (nFr) p.set('created_from', toUtcIso(nFr))
    if (nTo) p.set('created_to', toUtcIso(nTo))
    if (nNA) p.set('needs_action', 'true')
    if (nIg==='active')  p.set('ignored','false')
    if (nIg==='ignored') p.set('ignored','true')
    return get(`/api/v1/requests${p.toString()?`?${p}`:''}`)
      .then(d => { setItems(d.items||[]); setError('') })
      .catch(e => setError(e.message))
  }

  /* ── Open detail (full page) ── */
  const openDetail = async (rid) => {
    setDetailLoading(true); setSelectedNode(null); setDetailTab('flow')
    sessionStorage.setItem('requests_open_id', rid)
    try {
      const [d, t] = await Promise.all([
        get(`/api/v1/requests/${rid}`),
        get(`/api/v1/requests/${rid}/tracker`),
      ])
      setDetail(d)
      setTracker((t.items||[]).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)))
      setError('')
      setView('detail')
    } catch(e) { setError(e.message) }
    finally { setDetailLoading(false) }
  }

  const backToList = () => { sessionStorage.removeItem('requests_open_id'); setView('list'); setDetail(null); setTracker([]); setSelectedNode(null) }

  // restore last open request after page refresh
  useEffect(() => {
    const saved = sessionStorage.getItem('requests_open_id')
    if (saved) openDetail(saved)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Actions ── */
  const runAction = async (path, msg, opts={}) => {
    setBusy(path)
    try {
      const res = await post(path, {reason: actionReason})
      await loadRequests()
      if (opts.openNew && res.request_id) { await openDetail(res.request_id); setNotice(`${msg}: ${res.request_id}`) }
      else if (detail?.request_id) { await openDetail(detail.request_id); setNotice(msg) }
      else setNotice(msg)
      setError('')
    } catch(e) { setError(e.message) }
    finally { setBusy('') }
  }

  const addNote = async () => {
    if (!detail?.request_id||!noteText.trim()) return
    setBusy('note')
    try {
      await post(`/api/v1/requests/${detail.request_id}/notes`,{note:noteText.trim()})
      setNoteText(''); await openDetail(detail.request_id); setNotice('Note added')
    } catch(e){ setError(e.message) } finally { setBusy('') }
  }

  const applyDatePreset = (p) => {
    setDatePreset(p)
    const now = new Date(); let f='',t=''
    if (p==='today') { f=todayLocalStr() }
    else if (p==='yesterday') { const d=new Date(now); d.setDate(d.getDate()-1); f=t=d.toISOString().slice(0,10) }
    else if (p==='7d')  { const d=new Date(now); d.setDate(d.getDate()-7);  f=d.toISOString().slice(0,10) }
    else if (p==='30d') { const d=new Date(now); d.setDate(d.getDate()-30); f=d.toISOString().slice(0,10) }
    setCreatedFrom(f); setCreatedTo(t)
    loadRequests({ createdFrom: f, createdTo: t })
  }

  /* ── Extract Plaid tracking ID from request data ── */
  const plaidTrackingId = useMemo(() => {
    if (!detail) return null
    const r = detail.result
    if (r?.plaid?.tracking_id) return r.plaid.tracking_id
    if (r?.plaid?.trackingId)  return r.plaid.trackingId
    if (r?.rawResponse?.trackingId) return r.rawResponse.trackingId
    const plaidOut = tracker.find(e => e.service_id === 'plaid' && (e.direction === 'OUT' || e.direction === 'RESPONSE'))
    if (plaidOut?.payload?.trackingId) return plaidOut.payload.trackingId
    if (plaidOut?.payload?.rawResponse?.trackingId) return plaidOut.payload.rawResponse.trackingId
    return null
  }, [detail, tracker])

  const plaidTrackingUrl = useMemo(() => {
    if (!detail) return null
    const r = detail.result
    if (r?.plaid?.trackingUrl)  return r.plaid.trackingUrl
    if (r?.rawResponse?.trackingUrl) return r.rawResponse.trackingUrl
    const plaidOut = tracker.find(e => e.service_id === 'plaid' && (e.direction === 'OUT' || e.direction === 'RESPONSE'))
    return plaidOut?.payload?.trackingUrl || plaidOut?.payload?.rawResponse?.trackingUrl || null
  }, [detail, tracker])

  /* ── Check Plaid status ── */
  const checkPlaidStatus = async () => {
    if (!plaidTrackingId) return
    setPlaidChecking(true)
    try {
      const s = await get(`/api/v1/plaid/link/${plaidTrackingId}/status`)
      setPlaidStatus(s)
      if (s.reportReady && detail?.request_id && !busy) {
        await runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`, 'Reconcile triggered — Plaid report ready')
      }
    } catch(e) { /* ignore polling errors */ }
    finally { setPlaidChecking(false) }
  }

  /* ── Auto-refresh list when there are pending/suspended requests ── */
  const pendingCount = useMemo(() =>
    items.filter(r => ['SUSPENDED','PENDING','REVIEW'].includes(r.status)).length
  , [items])

  useEffect(() => { loadRequests() }, [filter, needsAction, ignoredFilter])
  useEffect(() => { get('/api/v1/process-model').then(setProcessModel).catch(()=>{}) }, [])
  useEffect(() => {
    if (!detail?.request_id||detail.status!=='RUNNING') return
    const t = setInterval(()=>openDetail(detail.request_id),3000)
    return ()=>clearInterval(t)
  }, [detail?.request_id, detail?.status])
  // Poll Plaid status every 30s when request is waiting
  useEffect(() => {
    if (!plaidTrackingId || !['SUSPENDED','PENDING','RUNNING'].includes(detail?.status)) return
    checkPlaidStatus()
    const t = setInterval(checkPlaidStatus, 30000)
    return () => clearInterval(t)
  }, [plaidTrackingId, detail?.status, detail?.request_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-refresh list every 30s when there are pending requests (list view only)
  useEffect(() => {
    if (pendingCount === 0 || view === 'detail') return
    const t = setInterval(() => loadRequests(), 30000)
    return () => clearInterval(t)
  }, [pendingCount, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0) }, [filter, needsAction, searchQ])

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return items
    const q = searchQ.toLowerCase()
    return items.filter(r=>r.request_id?.toLowerCase().includes(q)||applicantName(r).toLowerCase().includes(q)||(r.status||'').toLowerCase().includes(q))
  }, [items, searchQ])

  const pages = Math.ceil(filtered.length/PAGE_SIZE)
  const rows  = filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)

  const tracedNodeIds = useMemo(()=>{
    const s=new Set(); tracker.filter(ev=>ev.status!=='SKIPPED').forEach(ev=>{ if(ev.service_id) s.add(ev.service_id); if(ev.stage) s.add(ev.stage) }); return s
  },[tracker])
  const skippedNodeIds = useMemo(()=>{
    const isT = buildIsTraced(tracedNodeIds)
    const s=new Set(); tracker.filter(ev=>ev.status==='SKIPPED' && !isT(ev.service_id||'')).forEach(ev=>{ if(ev.service_id) s.add(ev.service_id) }); return s
  },[tracker, tracedNodeIds])
  // debug: log tracker events and computed sets
  useEffect(()=>{
    if (!tracker.length) return
    console.log('[BPMN DEBUG] tracker events:', tracker.map(e=>({service_id:e.service_id,status:e.status,stage:e.stage})))
    console.log('[BPMN DEBUG] tracedNodeIds:', [...tracedNodeIds])
    console.log('[BPMN DEBUG] skippedNodeIds:', [...skippedNodeIds])
  },[tracker, tracedNodeIds, skippedNodeIds])
  const pathNodeIds = useMemo(()=>{
    if (!processModel) return tracedNodeIds
    return inferPathNodes(processModel.nodes, processModel.edges, buildIsTraced(tracedNodeIds), skippedNodeIds)
  },[processModel, tracedNodeIds, skippedNodeIds])
  const failedNodeIds = useMemo(()=>{
    const s=new Set(); tracker.filter(e=>SC.red.includes(e.status)).forEach(e=>{ if(e.service_id) s.add(e.service_id) }); return s
  },[tracker])

  const ops = detail?.ops || {}
  const totalTime = tracker.length>=2 ? elapsed(tracker[0]?.created_at, tracker[tracker.length-1]?.created_at) : null

  /* ═══════════════════════════════════════════════════════
     CSS
  ═══════════════════════════════════════════════════════ */
  const css = `
    /* list */
    .rqb-toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:10px; }
    .rqb-search { padding:5px 10px; border-radius:6px; border:1px solid var(--border-1); background:var(--bg-2); color:var(--text-1); font-size:11px; outline:none; width:200px; }
    .rqb-search:focus { border-color:var(--blue); }
    .rqb-flt { padding:2px 7px; border-radius:3px; border:1px solid var(--border-1); background:transparent; color:var(--text-3); font-size:9px; font-weight:700; cursor:pointer; }
    .rqb-flt.active { background:var(--blue); color:#fff; border-color:var(--blue); }
    .rqb-flt:hover:not(.active) { color:var(--text-1); }
    .rqb-tbl-wrap { border:1px solid var(--border-1); border-radius:8px; overflow:hidden; margin-bottom:12px; }
    .rqb-tbl { width:100%; border-collapse:collapse; font-size:11px; }
    .rqb-tbl thead tr { background:var(--bg-2); }
    .rqb-tbl th { padding:4px 8px; text-align:left; font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.6px; border-bottom:1px solid var(--border-1); white-space:nowrap; }
    .rqb-tbl td { padding:3px 8px; border-bottom:1px solid color-mix(in srgb,var(--border-1) 60%,transparent); vertical-align:middle; }
    .rqb-tbl tr:last-child td { border-bottom:none; }
    .rqb-tbl tbody tr { cursor:pointer; transition:background 0.08s; }
    .rqb-tbl tbody tr:hover td { background:var(--bg-2); }
    .rqb-action-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--amber); }
    .rqb-pages { display:flex; gap:3px; justify-content:center; margin-bottom:16px; }
    .rqb-pg { padding:3px 8px; border-radius:4px; border:1px solid var(--border-1); background:var(--bg-1); color:var(--text-3); cursor:pointer; font-size:10px; font-family:monospace; }
    .rqb-pg.active { background:var(--blue); color:#fff; border-color:var(--blue); font-weight:700; }
    /* detail full-page */
    .rqd-root { display:flex; flex-direction:column; height:calc(100vh - 160px); min-height:500px; }
    .rqd-back { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-shrink:0; }
    .rqd-hdr { background:var(--bg-1); border:1px solid var(--border-1); border-radius:8px; padding:12px 16px; margin-bottom:0; flex-shrink:0; }
    .rqd-hdr-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
    .rqd-id { font-family:monospace; font-size:14px; font-weight:800; color:var(--text-1); }
    .rqd-decision { font-size:16px; font-weight:900; font-family:monospace; margin-left:4px; }
    .rqd-metrics { display:flex; gap:0; flex-wrap:wrap; border-top:1px solid var(--border-1); padding-top:8px; }
    .rqd-metric { display:flex; flex-direction:column; padding:0 16px 0 0; border-right:1px solid var(--border-1); margin-right:16px; margin-bottom:4px; }
    .rqd-metric:last-child { border-right:none; margin-right:0; }
    .rqd-metric-lbl { font-size:8px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.6px; }
    .rqd-metric-val { font-size:13px; font-weight:700; font-family:monospace; color:var(--text-1); line-height:1.2; }
    .rqd-tabs { display:flex; border-bottom:1px solid var(--border-1); background:var(--bg-1); flex-shrink:0; }
    .rqd-tab { padding:8px 14px; font-size:11px; font-weight:600; color:var(--text-3); border:none; border-bottom:2px solid transparent; background:transparent; cursor:pointer; transition:all 0.1s; white-space:nowrap; }
    .rqd-tab.active { color:var(--blue); border-bottom-color:var(--blue); }
    .rqd-tab:hover:not(.active) { color:var(--text-1); }
    .rqd-body { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
    /* kv grid */
    .rqb-kv-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:1px; background:var(--border-1); border-radius:6px; overflow:hidden; }
    .rqb-kv-cell { background:var(--bg-1); padding:7px 10px; }
    .rqb-kv-k { font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px; }
    .rqb-kv-v { font-size:12px; color:var(--text-1); word-break:break-all; }
    .rqb-sec-title { font-size:11px; font-weight:700; color:var(--text-1); margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border-1); }
    /* node detail */
    .rqb-nd { border:1px solid var(--border-1); border-radius:6px; overflow:hidden; }
    .rqb-nd-hdr { display:flex; align-items:center; justify-content:space-between; padding:7px 12px; background:var(--bg-2); border-bottom:1px solid var(--border-1); }
    .rqb-nd-body { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1px; background:var(--border-1); max-height:320px; overflow-y:auto; }
    .rqb-nd-col { padding:10px 12px; background:var(--bg-1); }
    .rqb-nd-lbl { font-size:10px; font-weight:700; margin-bottom:5px; display:flex; align-items:center; gap:6px; }
    .rqb-nd-lbl.in { color:var(--green); } .rqb-nd-lbl.out { color:var(--blue); } .rqb-nd-lbl.state { color:var(--amber); }
    .rqb-dur { font-size:9px; font-family:monospace; background:var(--bg-2); padding:2px 6px; border-radius:4px; color:var(--blue); font-weight:700; }
    .rqb-json { font-size:10px; font-family:monospace; color:var(--text-3); background:var(--bg-2); padding:8px; border-radius:4px; overflow:auto; white-space:pre-wrap; word-break:break-all; max-height:200px; margin:4px 0 0; }
    .rqb-json-sm { font-size:9px; max-height:150px; margin:0 12px 8px; }
    .rqb-empty { padding:20px; text-align:center; color:var(--text-3); font-size:11px; }
  `

  /* ═══════════════════════════════════════════════════════
     DETAIL VIEW (full page)
  ═══════════════════════════════════════════════════════ */
  if (view === 'detail') {
    const dec = detail?.result?.decision || detail?.result?.summary?.decision
    const score = metricVal(detail?.result, 'credit_score')
    const collections = metricVal(detail?.result, 'collection_count')
    const reason = decisionReason(detail?.result, detail?.status)
    const createdAt = (detail?.created_at||'').slice(0,19).replace('T',' ')
    const aiPreRec = detail?.result?.ai_prescreen?.recommendation
    const aiAdvRec = detail?.result?.ai_advisor?.recommendation
    const aiAdvRisk = detail?.result?.ai_advisor?.risk_level
    const aiRecColor = (v) => { if (!v) return 'var(--text-3)'; const u=String(v).toUpperCase(); return ['APPROVE','APPROVED','PASS','ACCEPT'].includes(u)?'var(--green)':['REJECT','REJECTED','FAIL','FAILED'].includes(u)?'var(--red)':'var(--amber)' }

    return (
      <>
        <style>{css}</style>
        {error  && <div className="notice notice-error mb-10" onClick={()=>setError('')}>{error} ✕</div>}
        {notice && <div className="notice mb-10" onClick={()=>setNotice('')}>{notice} ✕</div>}

        {detailLoading || !detail ? (
          <div style={{padding:40,textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
        ) : (
          <div className="rqd-root">

            {/* Back */}
            <div className="rqd-back">
              <button className="btn btn-ghost btn-sm" onClick={backToList}>← Requests</button>
              {detail.status==='RUNNING' && (
                <span style={{fontSize:10,color:'var(--blue)',fontFamily:'monospace'}}>● live — auto-refreshing</span>
              )}
            </div>

            {/* Header */}
            <div className="rqd-hdr">
              <div className="rqd-hdr-top">
                <span className="rqd-id">{detail.request_id}</span>
                <span className={`badge ${sBadge(detail.status)}`} style={{fontSize:10}}>{(detail.status||'').toLowerCase()}</span>
                {detail.error_class&&<span className={`badge ${detail.error_class==='technical'?'badge-red':detail.error_class==='integration'?'badge-amber':'badge-green'}`} style={{fontSize:10}}>{detail.error_class}</span>}
                {detail.needs_operator_action&&<span className="badge badge-amber" style={{fontSize:10}}>⚠ needs action</span>}
                {detail.ignored&&<span className="badge badge-gray" style={{fontSize:10}}>ignored</span>}
                {dec&&<span className="rqd-decision" style={{color:dec==='APPROVED'?'var(--green)':dec==='REJECTED'?'var(--red)':'var(--amber)'}}>{dec}</span>}
                <button className="btn btn-ghost btn-xs" style={{marginLeft:'auto'}} onClick={()=>openDetail(detail.request_id)}>↻ Reload</button>
              </div>
              <div className="rqd-metrics">
                <div className="rqd-metric">
                  <span className="rqd-metric-lbl">Applicant</span>
                  <span className="rqd-metric-val">{applicantName(detail)}</span>
                </div>
                {score!=='—'&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Credit Score</span>
                  <span className="rqd-metric-val">{score}</span>
                </div>}
                {collections!=='—'&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Collections</span>
                  <span className="rqd-metric-val" style={{color:Number(collections)>0?'var(--red)':undefined}}>{collections}</span>
                </div>}
                {totalTime&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Total time</span>
                  <span className="rqd-metric-val">{totalTime}</span>
                </div>}
                <div className="rqd-metric">
                  <span className="rqd-metric-lbl">Mode</span>
                  <span className="rqd-metric-val">{detail.orchestration_mode||'—'}</span>
                </div>
                {aiPreRec&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Pre-screen AI</span>
                  <span className="rqd-metric-val" style={{color:aiRecColor(aiPreRec),fontSize:11}}>{String(aiPreRec).toUpperCase()}</span>
                </div>}
                {aiAdvRec&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Advisor AI{aiAdvRisk?` · risk`:''}</span>
                  <span className="rqd-metric-val" style={{color:aiRecColor(aiAdvRec),fontSize:11}}>
                    {String(aiAdvRec).toUpperCase()}{aiAdvRisk&&<span style={{fontWeight:400,color:aiAdvRisk.toUpperCase()==='HIGH'?'var(--red)':aiAdvRisk.toUpperCase()==='LOW'?'var(--green)':'var(--amber)',fontSize:10,marginLeft:4}}>{aiAdvRisk}</span>}
                  </span>
                </div>}
                <div className="rqd-metric">
                  <span className="rqd-metric-lbl">Events</span>
                  <span className="rqd-metric-val">{tracker.length}</span>
                </div>
                <div className="rqd-metric">
                  <span className="rqd-metric-lbl">Created</span>
                  <span className="rqd-metric-val" style={{fontSize:11}}>{createdAt}</span>
                </div>
                {detail.correlation_id&&<div className="rqd-metric">
                  <span className="rqd-metric-lbl">Correlation</span>
                  <span className="rqd-metric-val" style={{fontSize:10}}>{detail.correlation_id}</span>
                </div>}
              </div>
            </div>

            {/* Tabs */}
            <div className="rqd-tabs">
              {[
                {id:'flow',     label:'⬡ Flow Path'},
                {id:'summary',  label:'ℹ Summary'},
                {id:'timeline', label:'▦ Timeline'},
                {id:'payloads', label:'{ } Payloads'},
                {id:'actions',  label:'⚙ Actions'},
              ].map(t=>(
                <button key={t.id} className={`rqd-tab${detailTab===t.id?' active':''}`}
                  onClick={()=>{setDetailTab(t.id);setSelectedNode(null)}}>{t.label}</button>
              ))}
            </div>

            {/* Body */}
            <div className="rqd-body">

              {/* ── Flow Path ── */}
              {detailTab==='flow' && (<>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:11,fontWeight:700,color:'var(--text-1)'}}>
                    BPMN Process Path — {tracedNodeIds.size} executed{skippedNodeIds.size ? `, ${skippedNodeIds.size} skipped` : ''}
                    {selectedNode&&<button className="btn btn-ghost btn-xs" style={{marginLeft:8}} onClick={()=>setSelectedNode(null)}>clear selection</button>}
                  </span>
                  <span style={{fontSize:10,color:'var(--text-3)'}}>Click a node to inspect input / output data</span>
                </div>
                <BpmnCanvas model={processModel} tracedNodeIds={tracedNodeIds} pathNodeIds={pathNodeIds} failedNodeIds={failedNodeIds} skippedNodeIds={skippedNodeIds}
                  onNodeClick={setSelectedNode} selectedNodeId={selectedNode?.id} />
                {selectedNode && <NodeDetail node={selectedNode} tracker={tracker} onClose={()=>setSelectedNode(null)} />}
                {!selectedNode && reason !== '—' && (
                  <div style={{padding:'10px 14px',background:'var(--bg-2)',borderRadius:6,fontSize:12,color:'var(--text-2)',border:'1px solid var(--border-1)'}}>
                    <span style={{fontWeight:700,marginRight:8,color:'var(--text-1)'}}>Decision reason:</span>{reason}
                  </div>
                )}
              </>)}

              {/* ── Summary ── */}
              {detailTab==='summary' && (<>
                <div>
                  <div className="rqb-sec-title">Applicant profile</div>
                  <div className="rqb-kv-grid">
                    {[
                      ['Name',        applicantName(detail)],
                      ['DOB',         detail.applicant_profile?.dateOfBirth||'—'],
                      ['SSN',         detail.ssn_masked||'***'],
                      ['Email',       detail.email_masked||detail.applicant_profile?.email||'—'],
                      ['Phone',       detail.phone_masked||detail.applicant_profile?.phone||'—'],
                      ['Address',     detail.applicant_profile?.address||'—'],
                      ['City/State',  [detail.applicant_profile?.city, detail.applicant_profile?.state].filter(Boolean).join(', ')||'—'],
                      ['ZIP',         detail.applicant_profile?.zipCode||'—'],
                    ].map(([k,v])=>(
                      <div key={k} className="rqb-kv-cell"><div className="rqb-kv-k">{k}</div><div className="rqb-kv-v">{v}</div></div>
                    ))}
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Outcome</div>
                    {[
                      ['Status',       <span className={`badge ${sBadge(detail.status)}`}>{detail.status}</span>],
                      ['Decision',     dec ? <span style={{fontWeight:700,color:dec==='APPROVED'?'var(--green)':dec==='REJECTED'?'var(--red)':'var(--amber)'}}>{dec}</span> : '—'],
                      ['Reason',       reason],
                      ['Source',       detail.result?.decision_source||'—'],
                      ['Matched rule', detail.result?.matched_rule?.name||detail.result?.summary?.matched_rule?.name||'—'],
                      ['Engine inst.', detail.result?.engine?.instance_id||'—'],
                    ].map(([k,v])=>(
                      <div key={k} className="kv-row"><span className="kv-key">{k}</span><span className="kv-val">{v}</span></div>
                    ))}
                    {detail.flowable_live_state&&<>
                      <div className="kv-row"><span className="kv-key">Engine state</span><span className="kv-val"><span className={`badge ${sBadge(detail.flowable_live_state.engine_status)}`}>{detail.flowable_live_state.engine_status}</span></span></div>
                      <div className="kv-row"><span className="kv-key">Current activity</span><span className="kv-val mono">{detail.flowable_live_state.current_activity||'—'}</span></div>
                    </>}
                  </div>
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Decision inputs</div>
                    {(() => {
                      const raw = (key) => detail.result?.summary?.[key] ?? detail.result?.[key]
                      const score = raw('credit_score')
                      const scoreVal = (score === null || score === undefined) ? 0 : Number(score)
                      const scoreMissing = score === null || score === undefined
                      const rows = [
                        { k: 'Credit score', v: String(scoreVal), color: scoreVal === 0 ? 'var(--red)' : scoreVal < 500 ? 'var(--amber)' : 'var(--green)', note: scoreMissing ? 'no data → 0' : null },
                        { k: 'Collections',  v: metricVal(detail.result,'collection_count'), color: Number(raw('collection_count')) > 0 ? 'var(--red)' : null },
                        { k: 'CS alerts',    v: metricVal(detail.result,'creditsafe_compliance_alert_count'), color: Number(raw('creditsafe_compliance_alert_count')) > 0 ? 'var(--amber)' : null },
                        { k: 'Rules evaluated',  v: metricVal(detail.result,'rules_evaluated') },
                        { k: 'Required reports', v: metricVal(detail.result,'required_reports_available'), color: raw('required_reports_available') === false ? 'var(--red)' : null },
                      ]
                      return rows.map(({k,v,color,note}) => (
                        <div key={k} className="kv-row">
                          <span className="kv-key">{k}</span>
                          <span className="kv-val" style={color ? {color, fontWeight:600} : {}}>
                            {v}{note && <span style={{fontSize:9,color:'var(--text-3)',fontWeight:400,marginLeft:4}}>({note})</span>}
                          </span>
                        </div>
                      ))
                    })()}
                  </div>
                </div>
                {(() => {
                  const aiPre = detail.result?.ai_prescreen
                    || tracker.find(e=>(e.service_id==='ai-prescreen')&&(e.direction==='OUT'||e.direction==='RESPONSE'))?.payload
                  const aiAdv = detail.result?.ai_advisor
                    || tracker.find(e=>(e.service_id==='ai-advisor')&&(e.direction==='OUT'||e.direction==='RESPONSE'))?.payload
                  if (!aiPre && !aiAdv) return null
                  const recColor = (r) => {
                    if (!r) return 'var(--text-3)'
                    const u = String(r).toUpperCase()
                    if (['APPROVE','APPROVED','PASS','ACCEPT'].includes(u)) return 'var(--green)'
                    if (['REJECT','REJECTED','FAIL','FAILED','DECLINE'].includes(u)) return 'var(--red)'
                    return 'var(--amber)'
                  }
                  const riskColor = (r) => {
                    if (!r) return 'var(--text-3)'
                    const u = String(r).toUpperCase()
                    if (u === 'LOW') return 'var(--green)'
                    if (u === 'HIGH') return 'var(--red)'
                    return 'var(--amber)'
                  }
                  const fmtFactors = (f) => {
                    if (!f) return null
                    if (Array.isArray(f)) return f.join(' · ')
                    if (typeof f === 'object') return JSON.stringify(f)
                    return String(f)
                  }
                  return (
                    <div className="card" style={{margin:0}}>
                      <div className="rqb-sec-title">AI Assessment</div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:12}}>
                        {aiPre && (
                          <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px'}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                              <span style={{fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Pre-screen</span>
                              {aiPre.recommendation&&<span style={{fontWeight:700,fontSize:11,color:recColor(aiPre.recommendation)}}>{String(aiPre.recommendation).toUpperCase()}</span>}
                              {aiPre.confidence!=null&&<span style={{fontSize:10,color:'var(--text-3)',fontFamily:'monospace'}}>conf {(Number(aiPre.confidence)*100).toFixed(0)}%</span>}
                            </div>
                            {aiPre.rationale&&<div style={{fontSize:11,color:'var(--text-2)',lineHeight:1.5,marginBottom:4}}>{aiPre.rationale}</div>}
                            {fmtFactors(aiPre.key_factors)&&<div style={{fontSize:10,color:'var(--text-3)',marginTop:4}}><span style={{fontWeight:600}}>Factors: </span>{fmtFactors(aiPre.key_factors)}</div>}
                          </div>
                        )}
                        {aiAdv && (
                          <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px'}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                              <span style={{fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.5px'}}>AI Advisor</span>
                              {aiAdv.recommendation&&<span style={{fontWeight:700,fontSize:11,color:recColor(aiAdv.recommendation)}}>{String(aiAdv.recommendation).toUpperCase()}</span>}
                              {aiAdv.risk_level&&<span style={{fontWeight:600,fontSize:11,color:riskColor(aiAdv.risk_level)}}>risk: {aiAdv.risk_level}</span>}
                              {aiAdv.confidence!=null&&<span style={{fontSize:10,color:'var(--text-3)',fontFamily:'monospace'}}>conf {(Number(aiAdv.confidence)*100).toFixed(0)}%</span>}
                            </div>
                            {aiAdv.rationale&&<div style={{fontSize:11,color:'var(--text-2)',lineHeight:1.5,marginBottom:4}}>{aiAdv.rationale}</div>}
                            {fmtFactors(aiAdv.key_factors)&&<div style={{fontSize:10,color:'var(--text-3)',marginTop:4}}><span style={{fontWeight:600}}>Factors: </span>{fmtFactors(aiAdv.key_factors)}</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {(detail.notes||[]).length>0&&(
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Operator notes</div>
                    {detail.notes.map(n=>(
                      <div key={n.id} style={{marginBottom:8,padding:'8px 10px',background:'var(--bg-2)',borderRadius:5}}>
                        <div className="kv-row"><span className="kv-key">Time</span><span className="kv-val mono">{noteTime(n.created_at)}</span></div>
                        <div className="kv-row"><span className="kv-key">Author</span><span className="kv-val">{n.created_by||'—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Note</span><span className="kv-val">{n.note_text}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </>)}

              {/* ── Timeline ── */}
              {detailTab==='timeline' && (
                <div className="card" style={{margin:0}}>
                  <div className="rqb-sec-title">Service call waterfall</div>
                  <WaterfallChart events={tracker} />
                </div>
              )}

              {/* ── Payloads ── */}
              {detailTab==='payloads' && (
                <div className="card" style={{margin:0}}>
                  <div className="rqb-sec-title">{tracker.length} tracker events — click to expand payload</div>
                  <PayloadList events={tracker} />
                </div>
              )}

              {/* ── Actions ── */}
              {detailTab==='actions' && (
                <div style={{display:'grid',gap:12}}>

                  {/* Plaid tracking panel — shown when tracking ID exists */}
                  {(plaidTrackingId || plaidTrackingUrl) && (
                    <div className="card" style={{margin:0,borderColor:'var(--blue)'}}>
                      <div className="rqb-sec-title" style={{color:'var(--blue)'}}>🔗 Plaid — ожидание клиента</div>
                      <div style={{display:'grid',gap:8}}>
                        {/* Status indicator */}
                        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:11,color:'var(--text-3)'}}>Статус:</span>
                          {!plaidStatus && <span className="badge badge-blue">CREATED</span>}
                          {plaidStatus && !plaidStatus.clicked && !plaidStatus.reportReady && <span className="badge badge-blue">CREATED — ссылка не открыта</span>}
                          {plaidStatus?.clicked && !plaidStatus.reportReady && <span className="badge badge-amber">CLICKED — клиент подключает банк…</span>}
                          {plaidStatus?.reportReady && <span className="badge badge-green">REPORT_READY — отчёт готов ✓</span>}
                          {plaidStatus?.clickedAt && <span style={{fontSize:10,color:'var(--text-3)'}}>клик: {String(plaidStatus.clickedAt).slice(0,19).replace('T',' ')}</span>}
                          <button className="btn btn-ghost btn-xs" disabled={plaidChecking} onClick={checkPlaidStatus}>
                            {plaidChecking ? '…' : '↻ Проверить'}
                          </button>
                        </div>
                        {/* Tracking URL */}
                        {plaidTrackingUrl && (
                          <div style={{display:'flex',gap:6,alignItems:'center'}}>
                            <span style={{fontSize:10,color:'var(--text-3)',fontFamily:'monospace',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{plaidTrackingUrl}</span>
                            <button className="btn btn-ghost btn-xs" onClick={()=>{navigator.clipboard.writeText(plaidTrackingUrl);setNotice('Ссылка скопирована')}}>📋 Копировать</button>
                          </div>
                        )}
                        {/* Auto-reconcile when ready */}
                        {plaidStatus?.reportReady && (
                          <button className="btn btn-success btn-sm" disabled={!!busy} onClick={()=>runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`,'Reconcile triggered')}>
                            ▶ Применить отчёт и принять решение
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Operator actions</div>
                    {!canOperate&&<p className="text-muted text-sm">Senior analyst or admin required.</p>}
                    <div className="form-row"><label>Reason</label>
                      <input value={actionReason} onChange={e=>setActionReason(e.target.value)} placeholder="Reason for audit log"/>
                    </div>
                    <div className="form-actions">
                      <button className="btn btn-primary btn-sm" disabled={!canOperate||!ops.can_retry_as_new||!!busy} onClick={()=>runAction(`/api/v1/requests/${detail.request_id}/retry-as-new`,'Retry as new',{openNew:true})}>Retry as new</button>
                      <button className="btn btn-ghost btn-sm" disabled={!canOperate||!ops.can_clone||!!busy} onClick={()=>runAction(`/api/v1/requests/${detail.request_id}/clone`,'Cloned',{openNew:true})}>Clone</button>
                      {!detail.ignored
                        ?<button className="btn btn-warn btn-sm" disabled={!canOperate||!ops.can_ignore||!!busy} onClick={()=>runAction(`/api/v1/requests/${detail.request_id}/ignore`,'Ignored')}>Mark ignored</button>
                        :<button className="btn btn-success btn-sm" disabled={!canOperate||!ops.can_restore||!!busy} onClick={()=>runAction(`/api/v1/requests/${detail.request_id}/restore`,'Restored')}>Restore</button>}
                    </div>
                    <div className="form-actions">
                      <button className="btn btn-danger btn-sm" disabled={!canOperate||!ops.can_retry_failed_flowable_jobs||!!busy} onClick={()=>runAction(`/api/v1/requests/${detail.request_id}/flowable/retry-failed-jobs`,'Retry Flowable jobs')}>Retry Flowable jobs</button>
                      <button className="btn btn-ghost btn-sm" disabled={!canOperate||!ops.can_reconcile_flowable||!!busy} onClick={()=>runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`,'Reconcile')}>Reconcile Flowable</button>
                    </div>
                  </div>
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Add note</div>
                    <div className="form-row"><label>Note</label>
                      <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} rows={3} placeholder="What happened, what was checked…"/>
                    </div>
                    <div className="form-actions">
                      <button className="btn btn-primary btn-sm" disabled={!detail.ops?.can_add_note||!noteText.trim()||busy==='note'} onClick={addNote}>Add note</button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </>
    )
  }

  /* ═══════════════════════════════════════════════════════
     LIST VIEW
  ═══════════════════════════════════════════════════════ */
  return (
    <>
      <style>{css}</style>
      {error  && <div className="notice notice-error mb-10" onClick={()=>setError('')}>{error} ✕</div>}
      {notice && <div className="notice mb-10" onClick={()=>setNotice('')}>{notice} ✕</div>}

      {/* ── Toolbar ── */}
      <div className="rqb-toolbar">
        <input className="rqb-search" placeholder="⌕ Request ID, applicant…"
          value={searchQ} onChange={e=>setSearchQ(e.target.value)} />
        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
          {FILTERS.map(f=>(
            <button key={f} className={`rqb-flt${filter===f?' active':''}`} onClick={()=>setFilter(f)}>
              {f||'All'}
            </button>
          ))}
        </div>
        <label style={{display:'flex',gap:5,alignItems:'center',fontSize:11,cursor:'pointer',flexShrink:0}}>
          <input type="checkbox" checked={needsAction} onChange={e=>setNeedsAction(e.target.checked)} />
          Needs action
        </label>
        <select value={ignoredFilter} onChange={e=>setIgnoredFilter(e.target.value)}
          style={{fontSize:11,padding:'3px 6px',borderRadius:4,border:'1px solid var(--border-1)',background:'var(--bg-2)',color:'var(--text-2)'}}>
          <option value="active">Active</option>
          <option value="ignored">Ignored</option>
          <option value="all">All</option>
        </select>
        <div style={{display:'flex',gap:6,marginLeft:'auto',alignItems:'center'}}>
          {pendingCount > 0 && (
            <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:'var(--amber-soft,#fff3cd)',color:'var(--amber)',fontWeight:600,cursor:'pointer'}}
              onClick={()=>setFilter('SUSPENDED')} title="Ожидают действия">
              ⏳ {pendingCount} ожидают
            </span>
          )}
          <span style={{fontSize:11,color:'var(--text-3)'}}>{filtered.length} results</span>
          <button className="btn btn-ghost btn-sm" onClick={()=>loadRequests()}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Date filter row ── */}
      <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
        {DATE_PRESETS.map(p=>(
          <button key={p.id} className={`rqb-flt${datePreset===p.id?' active':''}`}
            onClick={()=>applyDatePreset(p.id)}>{p.label}</button>
        ))}
        <span style={{fontSize:11,color:'var(--text-3)',marginLeft:6}}>From</span>
        <input type="date" value={createdFrom} onChange={e=>{setCreatedFrom(e.target.value);setDatePreset('')}}
          style={{fontSize:11,padding:'3px 7px',borderRadius:4,border:'1px solid var(--border-1)',background:'var(--bg-2)',color:'var(--text-2)'}} />
        <span style={{fontSize:11,color:'var(--text-3)'}}>—</span>
        <input type="date" value={createdTo} onChange={e=>{setCreatedTo(e.target.value);setDatePreset('')}}
          style={{fontSize:11,padding:'3px 7px',borderRadius:4,border:'1px solid var(--border-1)',background:'var(--bg-2)',color:'var(--text-2)'}} />
        <button className="btn btn-primary btn-sm" onClick={()=>loadRequests()}>Apply</button>
      </div>

      {/* ── Table ── */}
      <div className="rqb-tbl-wrap">
        <table className="rqb-tbl">
          <thead>
            <tr>
              <th>#</th><th>Request ID</th><th>Applicant</th><th>Mode</th>
              <th>Status</th><th>Class</th><th>Decision</th><th>Score</th>
              <th>AI Pre</th><th>AI Adv</th>
              <th>⚑</th><th>Time</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} style={{textAlign:'center',padding:20,color:'var(--text-3)'}}>No requests match filters</td></tr>
            ) : rows.map((r, i) => {
              const decision = r.result?.decision || r.result?.summary?.decision
              const score    = r.result?.summary?.credit_score ?? r.result?.credit_score
              const aiPre    = r.result?.ai_prescreen?.recommendation
              const aiAdv    = r.result?.ai_advisor?.recommendation
              const aiColor  = (v) => { if (!v) return 'var(--text-3)'; const u=String(v).toUpperCase(); return ['APPROVE','APPROVED','PASS','ACCEPT'].includes(u)?'var(--green)':['REJECT','REJECTED','FAIL','FAILED'].includes(u)?'var(--red)':'var(--amber)' }
              return (
                <tr key={r.request_id} onClick={()=>openDetail(r.request_id)}
                  style={{cursor: detailLoading ? 'wait' : 'pointer'}}>
                  <td style={{color:'var(--text-3)',fontFamily:'monospace',fontSize:10}}>{page*PAGE_SIZE+i+1}</td>
                  <td style={{fontFamily:'monospace',fontWeight:700,fontSize:11,whiteSpace:'nowrap'}}>{r.request_id}</td>
                  <td style={{maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {applicantName(r)}
                    {r.ignored && <span className="badge badge-gray" style={{fontSize:8,marginLeft:4}}>ignored</span>}
                  </td>
                  <td><span className={`badge ${r.orchestration_mode==='flowable'?'badge-blue':'badge-purple'}`} style={{fontSize:9}}>{r.orchestration_mode}</span></td>
                  <td><span className={`badge ${sBadge(r.status)}`} style={{fontSize:9}}>{(r.status||'').toLowerCase()}</span></td>
                  <td>{r.error_class&&<span className={`badge ${r.error_class==='technical'?'badge-red':r.error_class==='integration'?'badge-amber':'badge-green'}`} style={{fontSize:9}}>{r.error_class}</span>}</td>
                  <td>{decision&&<span style={{fontWeight:700,fontSize:10,color:decision==='APPROVED'?'var(--green)':decision==='REJECTED'?'var(--red)':'var(--amber)'}}>{decision}</span>}</td>
                  <td style={{fontFamily:'monospace',fontSize:11}}>{score!==undefined&&score!==null?score:'—'}</td>
                  <td><span style={{fontSize:9,fontWeight:700,color:aiColor(aiPre)}}>{aiPre||'—'}</span></td>
                  <td><span style={{fontSize:9,fontWeight:700,color:aiColor(aiAdv)}}>{aiAdv||'—'}</span></td>
                  <td>{r.needs_operator_action&&<span className="rqb-action-dot" title="Needs action"/>}</td>
                  <td style={{fontFamily:'monospace',fontSize:10,color:'var(--text-3)',whiteSpace:'nowrap'}}>{(r.created_at||'').slice(11,19)}</td>
                  <td><button className="btn btn-ghost btn-xs" onClick={e=>{e.stopPropagation();openDetail(r.request_id)}}>↗</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {pages > 1 && (
        <div className="rqb-pages">
          {Array.from({length:Math.min(9,pages)},(_,i)=>{
            let n = i
            if(pages>9) { if(page<4) n=i; else if(page>pages-5) n=pages-9+i; else n=page-4+i }
            return <button key={n} className={`rqb-pg${page===n?' active':''}`} onClick={()=>setPage(n)}>{n+1}</button>
          })}
          <span style={{fontSize:10,color:'var(--text-3)',alignSelf:'center',marginLeft:4}}>/ {pages}</span>
        </div>
      )}
    </>
  )
}
