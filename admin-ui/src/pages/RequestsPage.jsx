import { useEffect, useMemo, useRef, useState } from 'react'
import { get, getUserRole, post } from '../lib/api'

/* ── helpers ── */
function StatusBadge({ status }) {
  const m = {
    COMPLETED: 'badge-green', APPROVED: 'badge-green', REJECTED: 'badge-red',
    FAILED: 'badge-red', REVIEW: 'badge-amber', RUNNING: 'badge-blue',
    SUBMITTED: 'badge-blue', ENGINE_ERROR: 'badge-red', ENGINE_UNREACHABLE: 'badge-red',
    ORPHANED: 'badge-red', SUSPENDED: 'badge-amber', RETRIED: 'badge-blue',
    CLONED: 'badge-purple', NOTED: 'badge-amber', IGNORED: 'badge-gray', RESTORED: 'badge-teal',
  }
  return <span className={`badge ${m[status] || 'badge-gray'}`}>{(status || '').toLowerCase() || 'n/a'}</span>
}

function DecisionBadge({ decision }) {
  if (!decision) return <span className="badge badge-gray">n/a</span>
  const p = { APPROVED: 'badge-green', REJECTED: 'badge-red', 'PASS TO CUSTOM': 'badge-amber' }
  return <span className={`badge ${p[decision] || 'badge-gray'}`}>{decision}</span>
}

function ClassBadge({ value }) {
  const m = { technical: 'badge-red', integration: 'badge-amber', business: 'badge-green' }
  if (!value) return <span className="badge badge-gray">n/a</span>
  return <span className={`badge ${m[value] || 'badge-gray'}`}>{value}</span>
}

function applicantName(row) {
  return row.applicant_name || [row.applicant_profile?.firstName, row.applicant_profile?.lastName].filter(Boolean).join(' ') || 'Unknown'
}
function applicantLocation(row) {
  return [row.applicant_profile?.city, row.applicant_profile?.state].filter(Boolean).join(', ') || '-'
}
function dotColor(status) {
  if (['COMPLETED','PASS','OK'].includes(status)) return 'green'
  if (['REJECTED','FAILED','REJECT','UNAVAILABLE','ENGINE_ERROR','ENGINE_UNREACHABLE'].includes(status)) return 'red'
  if (['REVIEW','SKIPPED'].includes(status)) return 'amber'
  return ''
}
function toUtcIso(value) {
  if (!value) return ''
  const p = new Date(value)
  return Number.isNaN(p.getTime()) ? '' : p.toISOString()
}
function noteTime(v) { return v ? String(v).slice(0, 19).replace('T', ' ') : '-' }
function metricValue(result, key) {
  if (!result || typeof result !== 'object') return '-'
  const v = (result.summary || {})[key]
  return v === undefined || v === null || v === '' ? '-' : String(v)
}
function matchedRuleLabel(result) {
  const rule = result?.matched_rule || result?.summary?.matched_rule
  if (!rule || typeof rule !== 'object') return '-'
  return rule.name || rule.id || '-'
}
function decisionReason(result, fallbackStatus) {
  if (!result || typeof result !== 'object')
    return fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-'
  return result.decision_reason || result.summary?.decision_reason || result.post_stop_factor?.reason
    || (fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-')
}
function engineHint(detail) {
  if (detail?.flowable_live_state?.hint) return detail.flowable_live_state.hint
  return decisionReason(detail?.result, detail?.status)
}

const FILTERS = ['', 'COMPLETED', 'RUNNING', 'REVIEW', 'REJECTED', 'FAILED', 'ENGINE_ERROR', 'ENGINE_UNREACHABLE']

/* ── Pipeline swimlane (tracker events visualized as a compact pipeline) ── */
function PipelineLane({ events }) {
  if (!events.length) return <p className="text-muted text-sm">No pipeline events recorded</p>

  // Group events by service_id / stage into lanes
  const lanes = []
  const seen = {}
  events.forEach(ev => {
    const key = ev.service_id || ev.stage || ev.title
    if (!seen[key]) {
      seen[key] = { key, title: ev.service_id || ev.stage || ev.title, events: [] }
      lanes.push(seen[key])
    }
    seen[key].events.push(ev)
  })

  return (
    <div className="rq-pipeline">
      {lanes.map((lane, i) => {
        const inEv  = lane.events.find(e => e.direction === 'IN'  || e.direction === 'REQUEST')
        const outEv = lane.events.find(e => e.direction === 'OUT' || e.direction === 'RESPONSE')
        const stEv  = lane.events.find(e => e.status)
        const status = stEv?.status
        const success = ['COMPLETED','OK','PASS','STARTED'].includes(status)
        const fail    = ['FAILED','REJECTED','TERMINATED'].includes(status)
        const skip    = ['SKIPPED'].includes(status)
        const dotCls  = success ? 'green' : fail ? 'red' : skip ? 'amber' : 'blue'

        const elapsed = (a, b) => {
          if (!a || !b) return null
          const ms = new Date(b) - new Date(a)
          return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${Math.round(ms/60000)}m`
        }

        return (
          <div key={lane.key} className="rq-pl-item">
            <div className="rq-pl-rail">
              <div className={`rq-pl-dot ${dotCls}`} />
              {i < lanes.length - 1 && <div className="rq-pl-line" />}
            </div>
            <div className="rq-pl-body">
              <div className="rq-pl-header">
                <span className="rq-pl-name">{lane.title}</span>
                {status && <StatusBadge status={status} />}
                {inEv && outEv && elapsed(inEv.created_at, outEv.created_at) && (
                  <span className="rq-pl-dur">{elapsed(inEv.created_at, outEv.created_at)}</span>
                )}
                <span className="rq-pl-time mono">{(stEv?.created_at || inEv?.created_at || '').slice(11, 19)}</span>
              </div>
              {inEv?.title && <div className="rq-pl-ev in">→ {inEv.title}</div>}
              {outEv?.title && <div className="rq-pl-ev out">← {outEv.title}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function RequestsPage() {
  const userRole = useMemo(() => getUserRole(), [])
  const canOperate = ['admin', 'senior_analyst'].includes(userRole)

  const [items,          setItems]          = useState([])
  const [filter,         setFilter]         = useState('')
  const [createdFrom,    setCreatedFrom]    = useState('')
  const [createdTo,      setCreatedTo]      = useState('')
  const [needsActionOnly, setNeedsActionOnly] = useState(false)
  const [ignoredFilter,  setIgnoredFilter]  = useState('active')
  const [searchQ,        setSearchQ]        = useState('')
  const [detail,         setDetail]         = useState(null)
  const [tracker,        setTracker]        = useState([])
  const [detailTab,      setDetailTab]      = useState('summary')
  const [actionReason,   setActionReason]   = useState('')
  const [noteText,       setNoteText]       = useState('')
  const [error,          setError]          = useState('')
  const [notice,         setNotice]         = useState('')
  const [busyAction,     setBusyAction]     = useState('')
  const detailBodyRef = useRef(null)

  const load = (overrides = {}) => {
    const nf  = overrides.filter         !== undefined ? overrides.filter         : filter
    const nFr = overrides.createdFrom    !== undefined ? overrides.createdFrom    : createdFrom
    const nTo = overrides.createdTo      !== undefined ? overrides.createdTo      : createdTo
    const nNA = overrides.needsActionOnly !== undefined ? overrides.needsActionOnly : needsActionOnly
    const nIg = overrides.ignoredFilter  !== undefined ? overrides.ignoredFilter  : ignoredFilter
    const p = new URLSearchParams()
    if (nf)  p.set('status', nf)
    if (nFr) p.set('created_from', toUtcIso(nFr))
    if (nTo) p.set('created_to', toUtcIso(nTo))
    if (nNA) p.set('needs_action', 'true')
    if (nIg === 'active')  p.set('ignored', 'false')
    if (nIg === 'ignored') p.set('ignored', 'true')
    return get(`/api/v1/requests${p.toString() ? `?${p}` : ''}`)
      .then(d => { setItems(d.items || []); setError('') })
      .catch(e => setError(e.message))
  }

  const openDetail = async (rid) => {
    setDetailTab('summary')
    try {
      const [d, t] = await Promise.all([
        get(`/api/v1/requests/${rid}`),
        get(`/api/v1/requests/${rid}/tracker`),
      ])
      setDetail(d)
      setTracker((t.items || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  const runAction = async (path, successMessage, options = {}) => {
    setBusyAction(path)
    try {
      const response = await post(path, { reason: actionReason })
      await load()
      if (options.openNewRequest && response.request_id) {
        await openDetail(response.request_id)
        setNotice(`${successMessage}: ${response.request_id}`)
      } else if (detail?.request_id) {
        await openDetail(detail.request_id)
        setNotice(successMessage)
      } else {
        setNotice(successMessage)
      }
      setError('')
      return response
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusyAction('')
    }
  }

  const addNote = async () => {
    if (!detail?.request_id || !noteText.trim()) return
    setBusyAction('note')
    try {
      await post(`/api/v1/requests/${detail.request_id}/notes`, { note: noteText.trim() })
      setNoteText('')
      await openDetail(detail.request_id)
      setNotice('Operator note added')
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyAction('')
    }
  }

  useEffect(() => { load() }, [filter, needsActionOnly, ignoredFilter])

  useEffect(() => {
    if (!detail?.request_id || detail.status !== 'RUNNING') return undefined
    const t = setInterval(() => openDetail(detail.request_id), 3000)
    return () => clearInterval(t)
  }, [detail?.request_id, detail?.status])

  const filteredItems = useMemo(() => {
    if (!searchQ.trim()) return items
    const q = searchQ.toLowerCase()
    return items.filter(r =>
      r.request_id?.toLowerCase().includes(q) ||
      applicantName(r).toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    )
  }, [items, searchQ])

  const ops = detail?.ops || {}

  return (
    <>
      <style>{`
        .rq-layout { display: flex; gap: 0; height: calc(100vh - 170px); min-height: 500px; }
        .rq-left  { width: 360px; min-width: 280px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border-1); }
        .rq-right { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
        .rq-left-toolbar { padding: 10px 12px; border-bottom: 1px solid var(--border-1); display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .rq-search { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-1); background: var(--bg-2); color: var(--text-1); font-size: 12px; outline: none; }
        .rq-search:focus { border-color: var(--blue); }
        .rq-filter-row { display: flex; gap: 4px; flex-wrap: wrap; }
        .rq-filter-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-1); background: transparent; color: var(--text-3); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
        .rq-filter-btn.active { background: var(--blue); color: #fff; border-color: var(--blue); }
        .rq-filter-btn:hover:not(.active) { color: var(--text-1); border-color: var(--text-3); }
        .rq-list { flex: 1; overflow-y: auto; }
        .rq-row { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px; border-bottom: 1px solid var(--border-1); cursor: pointer; transition: background 0.1s; }
        .rq-row:hover { background: var(--bg-2); }
        .rq-row.active { background: color-mix(in srgb, var(--blue) 10%, transparent); border-left: 2px solid var(--blue); }
        .rq-row-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .rq-row-id { font-size: 11px; font-family: monospace; font-weight: 700; color: var(--text-1); }
        .rq-row-sub { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-3); }
        .rq-row-action { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); flex-shrink: 0; }
        .rq-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--text-3); text-align: center; padding: 20px; }
        .rq-right-header { padding: 12px 16px; border-bottom: 1px solid var(--border-1); display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
        .rq-right-title { font-size: 13px; font-weight: 700; font-family: monospace; color: var(--text-1); }
        .rq-right-sub { font-size: 11px; color: var(--text-3); }
        .rq-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-1); padding: 0 16px; flex-shrink: 0; }
        .rq-tab { padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--text-3); border: none; border-bottom: 2px solid transparent; background: transparent; cursor: pointer; transition: all 0.12s; }
        .rq-tab.active { color: var(--blue); border-bottom-color: var(--blue); }
        .rq-tab:hover:not(.active) { color: var(--text-1); }
        .rq-right-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
        .rq-kv { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border-1); border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
        .rq-kv-item { background: var(--bg-1); padding: 7px 10px; }
        .rq-kv-key { font-size: 9px; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
        .rq-kv-val { font-size: 12px; color: var(--text-1); word-break: break-all; }
        .rq-section-title { font-size: 11px; font-weight: 700; color: var(--text-1); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border-1); }
        /* pipeline */
        .rq-pipeline { display: flex; flex-direction: column; gap: 0; }
        .rq-pl-item { display: flex; gap: 10px; }
        .rq-pl-rail { display: flex; flex-direction: column; align-items: center; width: 14px; flex-shrink: 0; }
        .rq-pl-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
        .rq-pl-dot.green { background: var(--green); } .rq-pl-dot.red { background: var(--red); }
        .rq-pl-dot.amber { background: var(--amber); } .rq-pl-dot.blue { background: var(--blue); }
        .rq-pl-line { width: 1px; flex: 1; background: var(--border-1); min-height: 10px; }
        .rq-pl-body { padding-bottom: 10px; flex: 1; min-width: 0; }
        .rq-pl-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .rq-pl-name { font-size: 12px; font-weight: 600; color: var(--text-1); font-family: monospace; }
        .rq-pl-dur { font-size: 9px; font-family: monospace; background: var(--bg-2); padding: 1px 5px; border-radius: 3px; color: var(--text-3); }
        .rq-pl-time { font-size: 10px; color: var(--text-3); margin-left: auto; }
        .rq-pl-ev { font-size: 10px; color: var(--text-3); margin-top: 1px; }
        .rq-pl-ev.in  { color: color-mix(in srgb, var(--green) 80%, var(--text-3)); }
        .rq-pl-ev.out { color: color-mix(in srgb, var(--blue)  80%, var(--text-3)); }
      `}</style>

      {error  && <div className="notice notice-error mb-16" onClick={() => setError('')}>{error} ✕</div>}
      {notice && <div className="notice mb-16" onClick={() => setNotice('')}>{notice} ✕</div>}

      <div className="rq-layout">
        {/* ── LEFT: filter + list ── */}
        <div className="rq-left">
          <div className="rq-left-toolbar">
            <input className="rq-search" placeholder="⌕ Request ID, applicant…"
              value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            <div className="rq-filter-row">
              {FILTERS.map(f => (
                <button key={f} className={`rq-filter-btn${filter === f ? ' active' : ''}`}
                  onClick={() => setFilter(f)}>{f || 'All'}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={needsActionOnly}
                  onChange={e => setNeedsActionOnly(e.target.checked)} />
                Needs action
              </label>
              <select value={ignoredFilter} onChange={e => setIgnoredFilter(e.target.value)}
                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                <option value="active">Active</option>
                <option value="ignored">Ignored</option>
                <option value="all">All</option>
              </select>
              <button className="btn btn-ghost btn-xs" onClick={() => load()} style={{ marginLeft: 'auto' }}>↻</button>
            </div>
          </div>

          <div className="rq-list">
            {filteredItems.length === 0 ? (
              <div className="rq-empty">No requests match filters</div>
            ) : (
              filteredItems.map(r => (
                <div key={r.request_id}
                  className={`rq-row${detail?.request_id === r.request_id ? ' active' : ''}`}
                  onClick={() => openDetail(r.request_id)}>
                  <div className="rq-row-top">
                    <span className="rq-row-id">{r.request_id}</span>
                    <StatusBadge status={r.status} />
                    {r.needs_operator_action && <span className="rq-row-action" title="Needs action" />}
                  </div>
                  <div className="rq-row-sub">
                    <span>{applicantName(r)}</span>
                    <span>·</span>
                    <span>{applicantLocation(r)}</span>
                    <span style={{ marginLeft: 'auto' }} className="mono">{(r.created_at || '').slice(11, 19)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: detail ── */}
        <div className="rq-right">
          {!detail ? (
            <div className="rq-empty">← Select a request to inspect</div>
          ) : (
            <>
              <div className="rq-right-header">
                <div className="rq-right-title">{detail.request_id}</div>
                <StatusBadge status={detail.status} />
                <ClassBadge value={detail.error_class} />
                {detail.needs_operator_action && <span className="badge badge-amber">needs action</span>}
                {detail.ignored && <span className="badge badge-gray">ignored</span>}
                <div className="rq-right-sub" style={{ marginLeft: 'auto' }}>
                  {applicantName(detail)} · {applicantLocation(detail)}
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => setDetail(null)}>✕</button>
              </div>

              <div className="rq-tabs">
                {[
                  { id: 'summary',  label: 'Summary'  },
                  { id: 'pipeline', label: `Pipeline (${tracker.length} events)` },
                  { id: 'actions',  label: 'Actions'  },
                ].map(t => (
                  <button key={t.id} className={`rq-tab${detailTab === t.id ? ' active' : ''}`}
                    onClick={() => setDetailTab(t.id)}>{t.label}</button>
                ))}
              </div>

              <div className="rq-right-body" ref={detailBodyRef}>

                {/* ── Summary tab ── */}
                {detailTab === 'summary' && (
                  <>
                    <div className="rq-kv">
                      {[
                        ['Applicant',     applicantName(detail)],
                        ['Location',      applicantLocation(detail)],
                        ['Mode',          detail.orchestration_mode],
                        ['Correlation',   detail.correlation_id],
                        ['Address',       detail.applicant_profile?.address || '-'],
                        ['ZIP',           detail.applicant_profile?.zipCode || '-'],
                        ['SSN',           detail.ssn_masked || '***'],
                        ['DOB',           detail.applicant_profile?.dateOfBirth || '-'],
                        ['Email',         detail.email_masked || detail.applicant_profile?.email || '-'],
                        ['Phone',         detail.phone_masked || detail.applicant_profile?.phone || '-'],
                      ].map(([k, v]) => (
                        <div key={k} className="rq-kv-item">
                          <div className="rq-kv-key">{k}</div>
                          <div className="rq-kv-val">{v}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid-2" style={{ gap: 12, marginBottom: 14 }}>
                      <div className="card" style={{ margin: 0 }}>
                        <div className="rq-section-title">Outcome</div>
                        <div className="kv-row"><span className="kv-key">Final status</span><span className="kv-val"><StatusBadge status={detail.status} /></span></div>
                        <div className="kv-row"><span className="kv-key">Decision</span><span className="kv-val"><DecisionBadge decision={detail.result?.decision} /></span></div>
                        <div className="kv-row"><span className="kv-key">Reason</span><span className="kv-val">{engineHint(detail)}</span></div>
                        <div className="kv-row"><span className="kv-key">Decision source</span><span className="kv-val">{detail.result?.decision_source || '-'}</span></div>
                        <div className="kv-row"><span className="kv-key">Matched rule</span><span className="kv-val">{matchedRuleLabel(detail.result)}</span></div>
                        {detail.flowable_live_state && (
                          <>
                            <div className="kv-row"><span className="kv-key">Engine state</span><span className="kv-val"><StatusBadge status={detail.flowable_live_state.engine_status} /></span></div>
                            <div className="kv-row"><span className="kv-key">Current activity</span><span className="kv-val">{detail.flowable_live_state.current_activity || '-'}</span></div>
                          </>
                        )}
                      </div>
                      <div className="card" style={{ margin: 0 }}>
                        <div className="rq-section-title">Decision inputs</div>
                        <div className="kv-row"><span className="kv-key">Rules evaluated</span><span className="kv-val">{metricValue(detail.result, 'rules_evaluated')}</span></div>
                        <div className="kv-row"><span className="kv-key">Required reports</span><span className="kv-val">{metricValue(detail.result, 'required_reports_available')}</span></div>
                        <div className="kv-row"><span className="kv-key">Credit score</span><span className="kv-val">{metricValue(detail.result, 'credit_score')}</span></div>
                        <div className="kv-row"><span className="kv-key">Collections</span><span className="kv-val">{metricValue(detail.result, 'collection_count')}</span></div>
                        <div className="kv-row"><span className="kv-key">CS alerts</span><span className="kv-val">{metricValue(detail.result, 'creditsafe_compliance_alert_count')}</span></div>
                      </div>
                    </div>

                    {(detail.notes || []).length > 0 && (
                      <div className="card" style={{ marginBottom: 14 }}>
                        <div className="rq-section-title">Operator notes</div>
                        {detail.notes.map(note => (
                          <div key={note.id} className="detail-panel" style={{ marginBottom: 8 }}>
                            <div className="kv-row"><span className="kv-key">Time</span><span className="kv-val mono">{noteTime(note.created_at)}</span></div>
                            <div className="kv-row"><span className="kv-key">Author</span><span className="kv-val">{note.created_by || '-'}</span></div>
                            <div className="kv-row"><span className="kv-key">Note</span><span className="kv-val">{note.note_text}</span></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* ── Pipeline tab ── */}
                {detailTab === 'pipeline' && (
                  <PipelineLane events={tracker} />
                )}

                {/* ── Actions tab ── */}
                {detailTab === 'actions' && (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="card" style={{ margin: 0 }}>
                      <div className="rq-section-title">Operator actions</div>
                      {!canOperate && <p className="text-muted text-sm">Senior analyst or admin role required.</p>}
                      <div className="form-row">
                        <label>Reason</label>
                        <input value={actionReason} onChange={e => setActionReason(e.target.value)}
                          placeholder="Reason for audit log" />
                      </div>
                      <div className="form-actions">
                        <button className="btn btn-primary btn-sm"
                          disabled={!canOperate || !ops.can_retry_as_new || !!busyAction}
                          onClick={() => runAction(`/api/v1/requests/${detail.request_id}/retry-as-new`, 'Retry as new created', { openNewRequest: true })}>
                          Retry as new
                        </button>
                        <button className="btn btn-ghost btn-sm"
                          disabled={!canOperate || !ops.can_clone || !!busyAction}
                          onClick={() => runAction(`/api/v1/requests/${detail.request_id}/clone`, 'Cloned', { openNewRequest: true })}>
                          Clone
                        </button>
                        {!detail.ignored ? (
                          <button className="btn btn-warn btn-sm"
                            disabled={!canOperate || !ops.can_ignore || !!busyAction}
                            onClick={() => runAction(`/api/v1/requests/${detail.request_id}/ignore`, 'Marked ignored')}>
                            Mark ignored
                          </button>
                        ) : (
                          <button className="btn btn-success btn-sm"
                            disabled={!canOperate || !ops.can_restore || !!busyAction}
                            onClick={() => runAction(`/api/v1/requests/${detail.request_id}/restore`, 'Restored')}>
                            Restore
                          </button>
                        )}
                      </div>
                      <div className="form-actions">
                        <button className="btn btn-danger btn-sm"
                          disabled={!canOperate || !ops.can_retry_failed_flowable_jobs || !!busyAction}
                          onClick={() => runAction(`/api/v1/requests/${detail.request_id}/flowable/retry-failed-jobs`, 'Retry Flowable jobs requested')}>
                          Retry Flowable jobs
                        </button>
                        <button className="btn btn-ghost btn-sm"
                          disabled={!canOperate || !ops.can_reconcile_flowable || !!busyAction}
                          onClick={() => runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`, 'Reconcile requested')}>
                          Reconcile Flowable
                        </button>
                      </div>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="rq-section-title">Add note</div>
                      <div className="form-row">
                        <label>Note</label>
                        <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                          rows={4} placeholder="What happened, what was checked, what to do next" />
                      </div>
                      <div className="form-actions">
                        <button className="btn btn-primary btn-sm"
                          disabled={!detail.ops?.can_add_note || !noteText.trim() || busyAction === 'note'}
                          onClick={addNote}>
                          Add note
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
