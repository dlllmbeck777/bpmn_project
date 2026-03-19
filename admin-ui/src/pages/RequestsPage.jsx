import { useEffect, useMemo, useRef, useState } from 'react'
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

/* ── isTracedNode: match "isoftpull" ↔ "task_isoftpull" ── */
function buildIsTraced(tracedSet) {
  return (nodeId) => {
    if (!tracedSet?.size) return false
    if (tracedSet.has(nodeId)) return true
    const bare = nodeId.replace(/^task_/, '').replace(/^parse_/, '')
    for (const t of tracedSet) {
      const tBare = t.replace(/^task_/, '').replace(/^parse_/, '')
      if (tBare === bare || t === bare || t === 'task_'+bare) return true
    }
    return false
  }
}

/* ── BPMN canvas (app-themed) ── */
function BpmnCanvas({ model, tracedNodeIds, failedNodeIds, onNodeClick, selectedNodeId }) {
  const { nodes = [], edges = [] } = model || {}
  const isTraced = useMemo(() => buildIsTraced(tracedNodeIds), [tracedNodeIds])
  const isFailed = useMemo(() => buildIsTraced(failedNodeIds), [failedNodeIds])

  const matchedCount = useMemo(() => nodes.filter(n => isTraced(n.id)).length, [nodes, isTraced])
  const hasTrace = (tracedNodeIds?.size > 0) && matchedCount > 0

  if (!nodes.length) return (
    <div className="rqb-empty">Loading BPMN model…</div>
  )

  const allX = nodes.flatMap(n => [n.x, n.x+(n.w||80)])
  const allY = nodes.flatMap(n => [n.y, n.y+(n.h||50)])
  const P = 30
  const minX = Math.min(...allX)-P, minY = Math.min(...allY)-P
  const vw = Math.max(...allX)-minX+P, vh = Math.max(...allY)-minY+P+22
  const nodeMap = {}; nodes.forEach(n => { nodeMap[n.id]=n })

  const nodeCol = (node) => {
    if (selectedNodeId === node.id) return 'var(--blue)'
    if (isFailed(node.id))          return 'var(--red)'
    if (hasTrace && isTraced(node.id)) return 'var(--green)'
    return 'var(--text-3)'
  }
  const nodeOp = (node) => {
    if (!hasTrace) return 0.8
    return isTraced(node.id)||isFailed(node.id)||selectedNodeId===node.id ? 1 : 0.2
  }

  return (
    <div style={{ overflowX:'auto', overflowY:'hidden', background:'var(--bg-2)', borderRadius:6 }}>
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} width={Math.max(680,vw)} height={vh}
        xmlns="http://www.w3.org/2000/svg" style={{ display:'block' }}>
        <defs>
          <marker id="rq-a"  markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--border-1)"/></marker>
          <marker id="rq-ag" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--green)"/></marker>
          <marker id="rq-ar" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0,0 7,3 0,6" fill="var(--red)"/></marker>
        </defs>
        {edges.map(edge => {
          const sv = hasTrace && (isTraced(edge.sourceRef)||isFailed(edge.sourceRef))
          const tv = hasTrace && (isTraced(edge.targetRef)||isFailed(edge.targetRef))
          const active = sv&&tv
          const hasFail = active&&(isFailed(edge.sourceRef)||isFailed(edge.targetRef))
          let pts = ''
          if (edge.waypoints?.length) pts = edge.waypoints.map(wp=>Array.isArray(wp)?`${wp[0]},${wp[1]}`:`${wp.x},${wp.y}`).join(' ')
          else { const s=nodeMap[edge.sourceRef],t=nodeMap[edge.targetRef]; if(!s||!t) return null; pts=`${s.x+(s.w||80)/2},${s.y+(s.h||50)/2} ${t.x+(t.w||80)/2},${t.y+(t.h||50)/2}` }
          return <polyline key={edge.id} points={pts} fill="none"
            stroke={hasFail?'var(--red)':active?'var(--green)':'var(--border-1)'}
            strokeWidth={active?1.5:0.8} opacity={hasTrace?(active?0.9:0.15):0.45}
            markerEnd={hasFail?'url(#rq-ar)':active?'url(#rq-ag)':'url(#rq-a)'} />
        })}
        {nodes.map(node => {
          const col = nodeCol(node), op = nodeOp(node)
          const vis = hasTrace&&isTraced(node.id), sel = selectedNodeId===node.id
          const fail = isFailed(node.id)
          const fill = (vis||sel||fail) ? col+'22' : 'transparent'
          const sw = sel?2.5:(vis||fail)?1.5:0.7
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
              <rect x={node.x} y={node.y} width={w} height={h} rx={4} fill={fill} stroke={col} strokeWidth={sw}/>
              {node.type==='serviceTask'&&<rect x={node.x} y={node.y} width={3} height={h} rx={1} fill={col} opacity={0.7}/>}
              {sel&&<rect x={node.x-2} y={node.y-2} width={w+4} height={h+4} rx={5} fill="none" stroke={col} strokeWidth={1.5} opacity={0.6}/>}
              {lines.map((ln,i)=><text key={i} x={cx} y={sy+i*lh} textAnchor="middle" dominantBaseline="middle" fill={col} fontSize={9} fontWeight={sel||fail?700:vis?600:400}>{ln}</text>)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Node detail (IN/OUT payload) ── */
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
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {dur&&<span className="rqb-dur">{dur}</span>}
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>
      </div>
      {evs.length===0 ? (
        <div style={{padding:'10px 14px',fontSize:11,color:'var(--text-3)'}}>No tracker events for this activity</div>
      ) : (
        <div className="rqb-nd-body">
          {inEv&&<div className="rqb-nd-col">
            <div className="rqb-nd-lbl in">→ Input <span style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)'}}>{(inEv.created_at||'').slice(11,19)}</span></div>
            {inEv.title&&<div style={{fontSize:11,color:'var(--text-2)',marginBottom:4}}>{inEv.title}</div>}
            <pre className="rqb-json">{JSON.stringify(inEv.payload||inEv.data||{},null,2)}</pre>
          </div>}
          {outEv&&<div className="rqb-nd-col">
            <div className="rqb-nd-lbl out">← Output <span style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)'}}>{(outEv.created_at||'').slice(11,19)}</span>
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

/* ── Main ── */
const FILTERS = ['','COMPLETED','RUNNING','REVIEW','REJECTED','FAILED','ENGINE_ERROR','ENGINE_UNREACHABLE']
const PAGE_SIZE = 30

export default function RequestsPage() {
  const userRole = useMemo(()=>getUserRole(),[])
  const canOperate = ['admin','senior_analyst'].includes(userRole)

  const [items,          setItems]          = useState([])
  const [processModel,   setProcessModel]   = useState(null)
  const [filter,         setFilter]         = useState('')
  const [createdFrom,    setCreatedFrom]    = useState('')
  const [createdTo,      setCreatedTo]      = useState('')
  const [needsAction,    setNeedsAction]    = useState(false)
  const [ignoredFilter,  setIgnoredFilter]  = useState('active')
  const [searchQ,        setSearchQ]        = useState('')
  const [page,           setPage]           = useState(0)
  const [detail,         setDetail]         = useState(null)
  const [tracker,        setTracker]        = useState([])
  const [detailTab,      setDetailTab]      = useState('flow')
  const [selectedNode,   setSelectedNode]   = useState(null)
  const [actionReason,   setActionReason]   = useState('')
  const [noteText,       setNoteText]       = useState('')
  const [error,          setError]          = useState('')
  const [notice,         setNotice]         = useState('')
  const [busy,           setBusy]           = useState('')
  const detailRef = useRef(null)

  const loadRequests = (ov={}) => {
    const nf  = ov.filter         !== undefined ? ov.filter         : filter
    const nFr = ov.createdFrom    !== undefined ? ov.createdFrom    : createdFrom
    const nTo = ov.createdTo      !== undefined ? ov.createdTo      : createdTo
    const nNA = ov.needsAction    !== undefined ? ov.needsAction    : needsAction
    const nIg = ov.ignoredFilter  !== undefined ? ov.ignoredFilter  : ignoredFilter
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

  const openDetail = async (rid) => {
    setSelectedNode(null); setDetailTab('flow')
    try {
      const [d, t] = await Promise.all([
        get(`/api/v1/requests/${rid}`),
        get(`/api/v1/requests/${rid}/tracker`),
      ])
      setDetail(d)
      setTracker((t.items||[]).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)))
      setError('')
      setTimeout(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50)
    } catch(e) { setError(e.message) }
  }

  const closeDetail = () => { setDetail(null); setTracker([]); setSelectedNode(null) }

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

  useEffect(() => { loadRequests() }, [filter, needsAction, ignoredFilter])
  useEffect(() => { get('/api/v1/process-model').then(setProcessModel).catch(()=>{}) }, [])
  useEffect(() => {
    if (!detail?.request_id||detail.status!=='RUNNING') return
    const t = setInterval(()=>openDetail(detail.request_id),3000)
    return ()=>clearInterval(t)
  }, [detail?.request_id, detail?.status])
  useEffect(() => { setPage(0) }, [filter, needsAction, searchQ])

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return items
    const q = searchQ.toLowerCase()
    return items.filter(r=>r.request_id?.toLowerCase().includes(q)||applicantName(r).toLowerCase().includes(q)||(r.status||'').toLowerCase().includes(q))
  }, [items, searchQ])

  const pages = Math.ceil(filtered.length/PAGE_SIZE)
  const rows  = filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)

  const tracedNodeIds = useMemo(()=>{
    const s=new Set()
    tracker.forEach(ev=>{ if(ev.service_id) s.add(ev.service_id); if(ev.stage) s.add(ev.stage) })
    return s
  },[tracker])

  const failedNodeIds = useMemo(()=>{
    const s=new Set()
    tracker.filter(e=>SC.red.includes(e.status)).forEach(e=>{ if(e.service_id) s.add(e.service_id) })
    return s
  },[tracker])

  const ops = detail?.ops || {}

  return (
    <>
      <style>{`
        .rqb-toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:10px; }
        .rqb-search { padding:5px 10px; border-radius:6px; border:1px solid var(--border-1); background:var(--bg-2); color:var(--text-1); font-size:11px; outline:none; width:200px; }
        .rqb-search:focus { border-color:var(--blue); }
        .rqb-flt { padding:2px 7px; border-radius:3px; border:1px solid var(--border-1); background:transparent; color:var(--text-3); font-size:9px; font-weight:700; cursor:pointer; }
        .rqb-flt.active { background:var(--blue); color:#fff; border-color:var(--blue); }
        .rqb-flt:hover:not(.active) { color:var(--text-1); }
        .rqb-tbl-wrap { border:1px solid var(--border-1); border-radius:8px; overflow:hidden; margin-bottom:12px; }
        .rqb-tbl { width:100%; border-collapse:collapse; font-size:11px; }
        .rqb-tbl thead tr { background:var(--bg-2); }
        .rqb-tbl th { padding:6px 10px; text-align:left; font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.6px; border-bottom:1px solid var(--border-1); white-space:nowrap; }
        .rqb-tbl td { padding:5px 10px; border-bottom:1px solid color-mix(in srgb,var(--border-1) 60%,transparent); vertical-align:middle; }
        .rqb-tbl tr:last-child td { border-bottom:none; }
        .rqb-tbl tbody tr { cursor:pointer; transition:background 0.08s; }
        .rqb-tbl tbody tr:hover td { background:var(--bg-2); }
        .rqb-tbl tbody tr.active td { background:color-mix(in srgb,var(--blue) 8%,transparent); }
        .rqb-tbl tbody tr.active td:first-child { border-left:2px solid var(--blue); }
        .rqb-action-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--amber); }
        .rqb-pages { display:flex; gap:3px; justify-content:center; margin-bottom:16px; }
        .rqb-pg { padding:3px 8px; border-radius:4px; border:1px solid var(--border-1); background:var(--bg-1); color:var(--text-3); cursor:pointer; font-size:10px; font-family:monospace; }
        .rqb-pg.active { background:var(--blue); color:#fff; border-color:var(--blue); font-weight:700; }
        /* detail panel */
        .rqb-detail { border:1px solid var(--border-1); border-radius:8px; overflow:hidden; margin-bottom:24px; }
        .rqb-detail-hdr { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 14px; background:var(--bg-2); border-bottom:1px solid var(--border-1); }
        .rqb-detail-id { font-family:monospace; font-size:13px; font-weight:700; color:var(--text-1); }
        .rqb-detail-tabs { display:flex; border-bottom:1px solid var(--border-1); padding:0 14px; background:var(--bg-1); }
        .rqb-detail-tab { padding:7px 12px; font-size:11px; font-weight:600; color:var(--text-3); border:none; border-bottom:2px solid transparent; background:transparent; cursor:pointer; transition:all 0.1s; }
        .rqb-detail-tab.active { color:var(--blue); border-bottom-color:var(--blue); }
        .rqb-detail-body { padding:14px; }
        .rqb-kv-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:1px; background:var(--border-1); border-radius:6px; overflow:hidden; margin-bottom:12px; }
        .rqb-kv-cell { background:var(--bg-1); padding:7px 10px; }
        .rqb-kv-k { font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px; }
        .rqb-kv-v { font-size:12px; color:var(--text-1); word-break:break-all; }
        .rqb-sec-title { font-size:11px; font-weight:700; color:var(--text-1); margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border-1); }
        /* node detail */
        .rqb-nd { border:1px solid var(--border-1); border-radius:6px; overflow:hidden; margin-top:10px; }
        .rqb-nd-hdr { display:flex; align-items:center; justify-content:space-between; padding:7px 12px; background:var(--bg-2); border-bottom:1px solid var(--border-1); }
        .rqb-nd-body { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:1px; background:var(--border-1); max-height:280px; overflow-y:auto; }
        .rqb-nd-col { padding:10px 12px; background:var(--bg-1); }
        .rqb-nd-lbl { font-size:10px; font-weight:700; margin-bottom:5px; display:flex; align-items:center; gap:6px; }
        .rqb-nd-lbl.in    { color:var(--green); }
        .rqb-nd-lbl.out   { color:var(--blue);  }
        .rqb-nd-lbl.state { color:var(--amber); }
        .rqb-dur { font-size:9px; font-family:monospace; background:var(--bg-2); padding:2px 6px; border-radius:4px; color:var(--blue); font-weight:700; }
        .rqb-json { font-size:10px; font-family:monospace; color:var(--text-3); background:var(--bg-2); padding:8px; border-radius:4px; overflow:auto; white-space:pre-wrap; word-break:break-all; max-height:180px; margin:4px 0 0; }
        .rqb-empty { padding:20px; text-align:center; color:var(--text-3); font-size:11px; }
        .rqb-canvas-hint { font-size:10px; color:var(--text-3); text-align:right; margin-bottom:6px; }
      `}</style>

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
        <label style={{display:'flex',gap:5,alignItems:'center',fontSize:11,cursor:'pointer'}}>
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
          <span style={{fontSize:11,color:'var(--text-3)'}}>{filtered.length} requests</span>
          <button className="btn btn-ghost btn-sm" onClick={()=>loadRequests()}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Date filters ── */}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
        <span style={{fontSize:11,color:'var(--text-3)'}}>Period:</span>
        <input type="datetime-local" value={createdFrom} onChange={e=>setCreatedFrom(e.target.value)}
          style={{fontSize:11,padding:'3px 6px',borderRadius:4,border:'1px solid var(--border-1)',background:'var(--bg-2)',color:'var(--text-2)'}} />
        <span style={{fontSize:11,color:'var(--text-3)'}}>—</span>
        <input type="datetime-local" value={createdTo} onChange={e=>setCreatedTo(e.target.value)}
          style={{fontSize:11,padding:'3px 6px',borderRadius:4,border:'1px solid var(--border-1)',background:'var(--bg-2)',color:'var(--text-2)'}} />
        <button className="btn btn-primary btn-sm" onClick={()=>loadRequests()}>Apply</button>
        <button className="btn btn-ghost btn-sm" onClick={()=>{setCreatedFrom('');setCreatedTo('');loadRequests({createdFrom:'',createdTo:''})}}>Clear</button>
      </div>

      {/* ── Table ── */}
      <div className="rqb-tbl-wrap">
        <table className="rqb-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Request ID</th>
              <th>Applicant</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Class</th>
              <th>Decision</th>
              <th>Score</th>
              <th>⚑</th>
              <th>Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} style={{textAlign:'center',padding:20,color:'var(--text-3)'}}>No requests match filters</td></tr>
            ) : rows.map((r, i) => {
              const decision = r.result?.decision || r.result?.summary?.decision
              const score    = r.result?.summary?.credit_score ?? r.result?.credit_score
              return (
                <tr key={r.request_id} className={detail?.request_id===r.request_id?'active':''}
                  onClick={()=>detail?.request_id===r.request_id?closeDetail():openDetail(r.request_id)}>
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
                  <td>{r.needs_operator_action&&<span className="rqb-action-dot" title="Needs action"/>}</td>
                  <td style={{fontFamily:'monospace',fontSize:10,color:'var(--text-3)',whiteSpace:'nowrap'}}>{(r.created_at||'').slice(11,19)}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" onClick={e=>{e.stopPropagation();openDetail(r.request_id)}}>
                      {detail?.request_id===r.request_id?'▲':'↗'}
                    </button>
                  </td>
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

      {/* ── Detail panel ── */}
      {detail && (
        <div className="rqb-detail" ref={detailRef}>
          {/* Header */}
          <div className="rqb-detail-hdr">
            <span className="rqb-detail-id">{detail.request_id}</span>
            <span className={`badge ${sBadge(detail.status)}`}>{(detail.status||'').toLowerCase()}</span>
            {detail.error_class&&<span className={`badge ${detail.error_class==='technical'?'badge-red':detail.error_class==='integration'?'badge-amber':'badge-green'}`}>{detail.error_class}</span>}
            {detail.needs_operator_action&&<span className="badge badge-amber">needs action</span>}
            {detail.ignored&&<span className="badge badge-gray">ignored</span>}
            {detail.result?.decision&&(
              <span style={{fontWeight:700,fontSize:12,color:detail.result.decision==='APPROVED'?'var(--green)':detail.result.decision==='REJECTED'?'var(--red)':'var(--amber)'}}>
                {detail.result.decision}
              </span>
            )}
            <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:11,color:'var(--text-3)'}}>{applicantName(detail)}</span>
              <button className="btn btn-ghost btn-xs" onClick={closeDetail}>✕ Close</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="rqb-detail-tabs">
            {[
              {id:'flow',    label:'⬡ Flow Path'},
              {id:'summary', label:'ℹ Summary'},
              {id:'actions', label:'⚙ Actions'},
            ].map(t=>(
              <button key={t.id} className={`rqb-detail-tab${detailTab===t.id?' active':''}`}
                onClick={()=>{setDetailTab(t.id);setSelectedNode(null)}}>{t.label}</button>
            ))}
          </div>

          <div className="rqb-detail-body">

            {/* ── Flow Path ── */}
            {detailTab==='flow' && (
              <>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:'var(--text-1)'}}>
                    BPMN Process Path — {tracedNodeIds.size} activities traced
                    {selectedNode&&<button className="btn btn-ghost btn-xs" style={{marginLeft:8}} onClick={()=>setSelectedNode(null)}>clear</button>}
                  </span>
                  <span className="rqb-canvas-hint">Click a node to inspect input / output data</span>
                </div>
                <BpmnCanvas
                  model={processModel}
                  tracedNodeIds={tracedNodeIds}
                  failedNodeIds={failedNodeIds}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                />
                <NodeDetail node={selectedNode} tracker={tracker} onClose={()=>setSelectedNode(null)} />
                {!selectedNode && decisionReason(detail.result, detail.status) !== '—' && (
                  <div style={{marginTop:10,padding:'8px 12px',background:'var(--bg-2)',borderRadius:6,fontSize:12,color:'var(--text-2)'}}>
                    <span style={{fontWeight:700,marginRight:8}}>Decision reason:</span>
                    {decisionReason(detail.result, detail.status)}
                  </div>
                )}
              </>
            )}

            {/* ── Summary ── */}
            {detailTab==='summary' && (
              <>
                <div className="rqb-kv-grid">
                  {[
                    ['Applicant',   applicantName(detail)],
                    ['Location',    [detail.applicant_profile?.city, detail.applicant_profile?.state].filter(Boolean).join(', ')||'—'],
                    ['Mode',        detail.orchestration_mode],
                    ['Correlation', detail.correlation_id||'—'],
                    ['Address',     detail.applicant_profile?.address||'—'],
                    ['ZIP',         detail.applicant_profile?.zipCode||'—'],
                    ['SSN',         detail.ssn_masked||'***'],
                    ['DOB',         detail.applicant_profile?.dateOfBirth||'—'],
                    ['Email',       detail.email_masked||detail.applicant_profile?.email||'—'],
                    ['Phone',       detail.phone_masked||detail.applicant_profile?.phone||'—'],
                  ].map(([k,v])=>(
                    <div key={k} className="rqb-kv-cell">
                      <div className="rqb-kv-k">{k}</div>
                      <div className="rqb-kv-v">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="grid-2" style={{gap:12,marginBottom:12}}>
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Outcome</div>
                    {[
                      ['Status',       <span className={`badge ${sBadge(detail.status)}`}>{detail.status}</span>],
                      ['Decision',     detail.result?.decision||'—'],
                      ['Reason',       decisionReason(detail.result,detail.status)],
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
                    {[
                      ['Rules evaluated',    metricVal(detail.result,'rules_evaluated')],
                      ['Required reports',   metricVal(detail.result,'required_reports_available')],
                      ['Credit score',       metricVal(detail.result,'credit_score')],
                      ['Collections',        metricVal(detail.result,'collection_count')],
                      ['CS alerts',          metricVal(detail.result,'creditsafe_compliance_alert_count')],
                    ].map(([k,v])=>(
                      <div key={k} className="kv-row"><span className="kv-key">{k}</span><span className="kv-val">{v}</span></div>
                    ))}
                  </div>
                </div>

                {(detail.notes||[]).length>0&&(
                  <div className="card" style={{margin:0}}>
                    <div className="rqb-sec-title">Operator notes</div>
                    {detail.notes.map(n=>(
                      <div key={n.id} className="detail-panel" style={{marginBottom:8}}>
                        <div className="kv-row"><span className="kv-key">Time</span><span className="kv-val mono">{noteTime(n.created_at)}</span></div>
                        <div className="kv-row"><span className="kv-key">Author</span><span className="kv-val">{n.created_by||'—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Note</span><span className="kv-val">{n.note_text}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Actions ── */}
            {detailTab==='actions' && (
              <div style={{display:'grid',gap:12}}>
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
