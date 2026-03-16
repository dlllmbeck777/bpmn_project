import { useEffect, useMemo, useRef, useState } from 'react'
import { get, getUserRole, post } from '../lib/api'

function StatusBadge({ status }) {
  const m = {
    COMPLETED: 'badge-green',
    REJECTED: 'badge-red',
    FAILED: 'badge-red',
    REVIEW: 'badge-amber',
    RUNNING: 'badge-blue',
    SUBMITTED: 'badge-blue',
    ENGINE_ERROR: 'badge-red',
    ENGINE_UNREACHABLE: 'badge-red',
    ORPHANED: 'badge-red',
    UNAVAILABLE: 'badge-red',
    SUSPENDED: 'badge-amber',
    RETRIED: 'badge-blue',
    CLONED: 'badge-purple',
    NOTED: 'badge-amber',
    IGNORED: 'badge-gray',
    RESTORED: 'badge-teal',
  }
  return <span className={`badge ${m[status] || 'badge-gray'}`}>{(status || '').toLowerCase() || 'n/a'}</span>
}

function ModeBadge({ mode }) {
  const css = mode === 'flowable' ? 'badge-blue' : mode === 'custom' ? 'badge-purple' : 'badge-gray'
  return <span className={`badge ${css}`}>{mode || 'n/a'}</span>
}

function ClassBadge({ value }) {
  const m = { technical: 'badge-red', integration: 'badge-amber', business: 'badge-green' }
  if (!value) return <span className="badge badge-gray">n/a</span>
  return <span className={`badge ${m[value] || 'badge-gray'}`}>{value}</span>
}

function applicantName(row) {
  return row.applicant_name || [
    row.applicant_profile?.firstName,
    row.applicant_profile?.lastName,
  ].filter(Boolean).join(' ') || 'Unknown applicant'
}

function applicantLocation(row) {
  return row.applicant_location || [
    row.applicant_profile?.city,
    row.applicant_profile?.state,
  ].filter(Boolean).join(', ') || '-'
}

function dotColor(status) {
  if (['COMPLETED', 'PASS', 'OK'].includes(status)) return 'green'
  if (['REJECTED', 'FAILED', 'REJECT', 'UNAVAILABLE', 'ENGINE_ERROR', 'ENGINE_UNREACHABLE'].includes(status)) return 'red'
  if (['REVIEW', 'SKIPPED'].includes(status)) return 'amber'
  return ''
}

function toUtcIso(value) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function decisionReason(result, fallbackStatus) {
  if (!result || typeof result !== 'object') return fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-'
  return result.decision_reason || result.summary?.decision_reason || result.post_stop_factor?.reason || (fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-')
}

function metricValue(result, key) {
  if (!result || typeof result !== 'object') return '-'
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {}
  const value = summary[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function noteTime(value) {
  return value ? String(value).slice(0, 19).replace('T', ' ') : '-'
}

function engineHint(detail) {
  if (detail?.flowable_live_state?.hint) return detail.flowable_live_state.hint
  return decisionReason(detail?.result, detail?.status)
}

export default function RequestsPage() {
  const userRole = useMemo(() => getUserRole(), [])
  const canOperate = ['admin', 'senior_analyst'].includes(userRole)
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [needsActionOnly, setNeedsActionOnly] = useState(false)
  const [ignoredFilter, setIgnoredFilter] = useState('active')
  const [detail, setDetail] = useState(null)
  const [tracker, setTracker] = useState([])
  const [actionReason, setActionReason] = useState('')
  const [noteText, setNoteText] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const detailRef = useRef(null)

  const load = (overrides = {}) => {
    const nextFilter = overrides.filter !== undefined ? overrides.filter : filter
    const nextFrom = overrides.createdFrom !== undefined ? overrides.createdFrom : createdFrom
    const nextTo = overrides.createdTo !== undefined ? overrides.createdTo : createdTo
    const nextNeedsAction = overrides.needsActionOnly !== undefined ? overrides.needsActionOnly : needsActionOnly
    const nextIgnoredFilter = overrides.ignoredFilter !== undefined ? overrides.ignoredFilter : ignoredFilter
    const params = new URLSearchParams()
    if (nextFilter) params.set('status', nextFilter)
    if (nextFrom) params.set('created_from', toUtcIso(nextFrom))
    if (nextTo) params.set('created_to', toUtcIso(nextTo))
    if (nextNeedsAction) params.set('needs_action', 'true')
    if (nextIgnoredFilter === 'active') params.set('ignored', 'false')
    if (nextIgnoredFilter === 'ignored') params.set('ignored', 'true')
    const query = params.toString()
    return get(`/api/v1/requests${query ? `?${query}` : ''}`)
      .then((d) => {
        setItems(d.items || [])
        setError('')
      })
      .catch((e) => setError(e.message))
  }

  const openDetail = async (rid) => {
    try {
      const [d, t] = await Promise.all([get(`/api/v1/requests/${rid}`), get(`/api/v1/requests/${rid}/tracker`)])
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
      if (options.openNewRequest && response.request_id && response.source_request_id) {
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
    if (detail && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [detail])

  useEffect(() => {
    if (!detail?.request_id || detail.status !== 'RUNNING') return undefined
    const timer = setInterval(() => {
      openDetail(detail.request_id)
    }, 3000)
    return () => clearInterval(timer)
  }, [detail?.request_id, detail?.status])

  const ops = detail?.ops || {}

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      {notice && <div className="notice mb-16">{notice}</div>}

      <div className="flex-between mb-16">
        <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {['', 'COMPLETED', 'RUNNING', 'REVIEW', 'REJECTED', 'FAILED', 'ENGINE_ERROR', 'ENGINE_UNREACHABLE'].map((f) => (
            <button key={f} className={`tab-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f || 'All'}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => load()}>Refresh</button>
      </div>

      <div className="card mb-16">
        <div className="card-title">Operator filters</div>
        <div className="form-inline">
          <label className="flex-center gap-8" style={{ minWidth: 180 }}>
            <input type="checkbox" checked={needsActionOnly} onChange={(e) => setNeedsActionOnly(e.target.checked)} />
            Needs operator action
          </label>
          <div className="form-row" style={{ minWidth: 180 }}>
            <label>Visibility</label>
            <select value={ignoredFilter} onChange={(e) => setIgnoredFilter(e.target.value)}>
              <option value="active">Active only</option>
              <option value="ignored">Ignored only</option>
              <option value="all">All requests</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">Date and time filters</div>
        <div className="form-inline">
          <div className="form-row">
            <label>From</label>
            <input type="datetime-local" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
          </div>
          <div className="form-row">
            <label>To</label>
            <input type="datetime-local" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={() => load()}>Apply</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setCreatedFrom('')
              setCreatedTo('')
              load({ createdFrom: '', createdTo: '' })
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card mb-20">
        <table className="tbl">
          <thead><tr><th>Request ID</th><th>Applicant</th><th>Mode</th><th>Status</th><th>Class</th><th>Action</th><th>Time</th><th></th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.request_id} data-clickable onClick={() => openDetail(r.request_id)} style={{ cursor: 'pointer' }}>
                <td className="mono" style={{ fontWeight: 600 }}>
                  {r.request_id}
                  {r.ignored && <div className="text-muted text-xs">ignored</div>}
                </td>
                <td>
                  <div>{applicantName(r)}</div>
                  <div className="text-muted text-xs">{applicantLocation(r)}</div>
                </td>
                <td><ModeBadge mode={r.orchestration_mode} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td><ClassBadge value={r.error_class} /></td>
                <td>{r.needs_operator_action ? <span className="badge badge-amber">needs action</span> : <span className="text-muted text-xs">-</span>}</td>
                <td className="mono text-sm" style={{ color: 'var(--text-3)' }}>{(r.created_at || '').slice(11, 19)}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={(e) => { e.stopPropagation(); openDetail(r.request_id) }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card" ref={detailRef}>
          <div className="flex-between mb-16">
            <div className="card-title" style={{ margin: 0 }}>{detail.request_id} - Timeline</div>
            <div className="flex-center gap-8">
              <StatusBadge status={detail.status} />
              <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>

          <div className="detail-panel mb-16">
            <div className="kv-row"><span className="kv-key">Applicant</span><span className="kv-val">{applicantName(detail)}</span></div>
            <div className="kv-row"><span className="kv-key">Location</span><span className="kv-val">{applicantLocation(detail)}</span></div>
            <div className="kv-row"><span className="kv-key">Mode</span><span className="kv-val">{detail.orchestration_mode}</span></div>
            <div className="kv-row"><span className="kv-key">Class</span><span className="kv-val"><ClassBadge value={detail.error_class} /></span></div>
            <div className="kv-row"><span className="kv-key">Needs action</span><span className="kv-val">{detail.needs_operator_action ? 'Yes' : 'No'}</span></div>
            <div className="kv-row"><span className="kv-key">Ignored</span><span className="kv-val">{detail.ignored ? `Yes${detail.ignored_reason ? ` - ${detail.ignored_reason}` : ''}` : 'No'}</span></div>
            <div className="kv-row"><span className="kv-key">Address</span><span className="kv-val">{detail.applicant_profile?.address || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">ZIP</span><span className="kv-val">{detail.applicant_profile?.zipCode || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">SSN</span><span className="kv-val">{detail.ssn_masked || '***'}</span></div>
            <div className="kv-row"><span className="kv-key">DOB</span><span className="kv-val">{detail.applicant_profile?.dateOfBirth || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Email</span><span className="kv-val">{detail.email_masked || detail.applicant_profile?.email || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Phone</span><span className="kv-val">{detail.phone_masked || detail.applicant_profile?.phone || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Correlation</span><span className="kv-val">{detail.correlation_id}</span></div>
          </div>

          <div className="grid-2 mb-16">
            <div className="card">
              <div className="card-title">Outcome</div>
              <div className="kv-row"><span className="kv-key">Final status</span><span className="kv-val"><StatusBadge status={detail.status} /></span></div>
              <div className="kv-row"><span className="kv-key">Decision</span><span className="kv-val">{engineHint(detail)}</span></div>
              <div className="kv-row"><span className="kv-key">Engine instance</span><span className="kv-val">{detail.result?.engine?.instance_id || '-'}</span></div>
              {detail.flowable_live_state && (
                <>
                  <div className="kv-row"><span className="kv-key">Engine state</span><span className="kv-val"><StatusBadge status={detail.flowable_live_state.engine_status} /></span></div>
                  <div className="kv-row"><span className="kv-key">Current activity</span><span className="kv-val">{detail.flowable_live_state.current_activity || '-'}</span></div>
                  <div className="kv-row"><span className="kv-key">Jobs</span><span className="kv-val">{`${detail.flowable_live_state.failed_jobs || 0}/${detail.flowable_live_state.job_count || 0} failed`}</span></div>
                </>
              )}
            </div>
            <div className="card">
              <div className="card-title">Decision inputs</div>
              <div className="kv-row"><span className="kv-key">Credit score</span><span className="kv-val">{metricValue(detail.result, 'credit_score')}</span></div>
              <div className="kv-row"><span className="kv-key">Collections</span><span className="kv-val">{metricValue(detail.result, 'collection_count')}</span></div>
              <div className="kv-row"><span className="kv-key">Creditsafe alerts</span><span className="kv-val">{metricValue(detail.result, 'creditsafe_compliance_alert_count')}</span></div>
            </div>
          </div>

          <div className="grid-2 mb-16">
            <div className="card">
              <div className="card-title">Operator actions</div>
              {!canOperate && <p className="text-muted text-sm">Senior analyst or admin role is required for retry/ignore actions.</p>}
              <div className="form-row">
                <label>Reason</label>
                <input value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Reason for audit log and operator actions" />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary btn-sm" disabled={!canOperate || !ops.can_retry_as_new || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/retry-as-new`, 'Retry as new created', { openNewRequest: true })}>Retry as new</button>
                <button className="btn btn-ghost btn-sm" disabled={!canOperate || !ops.can_clone || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/clone`, 'Request cloned', { openNewRequest: true })}>Clone request</button>
                {!detail.ignored ? (
                  <button className="btn btn-warn btn-sm" disabled={!canOperate || !ops.can_ignore || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/ignore`, 'Request marked as ignored')}>Mark ignored</button>
                ) : (
                  <button className="btn btn-success btn-sm" disabled={!canOperate || !ops.can_restore || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/restore`, 'Ignored request restored')}>Restore</button>
                )}
              </div>
              <div className="form-actions">
                <button className="btn btn-danger btn-sm" disabled={!canOperate || !ops.can_retry_failed_flowable_jobs || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/flowable/retry-failed-jobs`, 'Retry failed Flowable jobs requested')}>Retry Flowable jobs</button>
                <button className="btn btn-ghost btn-sm" disabled={!canOperate || !ops.can_reconcile_flowable || !!busyAction} onClick={() => runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`, 'Flowable reconcile requested')}>Reconcile Flowable</button>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Operator notes</div>
              <div className="form-row">
                <label>Add note</label>
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} placeholder="What happened, what was checked, what to do next" />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary btn-sm" disabled={!detail.ops?.can_add_note || !noteText.trim() || busyAction === 'note'} onClick={addNote}>Add note</button>
              </div>
              {(detail.notes || []).length === 0 ? (
                <p className="text-muted text-sm">No operator notes yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {(detail.notes || []).map((note) => (
                    <div key={note.id} className="detail-panel">
                      <div className="kv-row"><span className="kv-key">Time</span><span className="kv-val mono">{noteTime(note.created_at)}</span></div>
                      <div className="kv-row"><span className="kv-key">Author</span><span className="kv-val">{note.created_by || '-'}</span></div>
                      <div className="kv-row"><span className="kv-key">Note</span><span className="kv-val">{note.note_text}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {tracker.length === 0 ? (
            <p className="text-muted text-sm">No tracker events recorded</p>
          ) : (
            <div className="timeline">
              {tracker.map((ev, i) => (
                <div className="tl-item" key={ev.id}>
                  <div className="tl-rail">
                    <div className={`tl-dot ${dotColor(ev.status)}`} />
                    {i < tracker.length - 1 && <div className="tl-line" />}
                  </div>
                  <div className="tl-body">
                    <div className="tl-title">{ev.title}</div>
                    <div className="tl-meta">
                      <span className="mono">{(ev.created_at || '').slice(11, 19)}</span>
                      <span>{ev.service_id || ev.stage}</span>
                      <span className={`badge ${ev.direction === 'OUT' ? 'badge-blue' : ev.direction === 'IN' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 10 }}>{ev.direction}</span>
                      {ev.status && <StatusBadge status={ev.status} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
