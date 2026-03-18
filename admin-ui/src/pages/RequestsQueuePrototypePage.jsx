import { useEffect, useMemo, useState } from 'react'
import { get, getUserRole, post } from '../lib/api'

function StatusBadge({ status }) {
  const map = {
    COMPLETED: 'badge-green',
    APPROVED: 'badge-green',
    REJECTED: 'badge-red',
    FAILED: 'badge-red',
    REVIEW: 'badge-amber',
    'PASS TO CUSTOM': 'badge-amber',
    RUNNING: 'badge-blue',
    SUBMITTED: 'badge-blue',
    ENGINE_ERROR: 'badge-red',
    ENGINE_UNREACHABLE: 'badge-red',
    ORPHANED: 'badge-red',
    UNAVAILABLE: 'badge-red',
    SUSPENDED: 'badge-amber',
  }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{(status || '').toLowerCase() || 'n/a'}</span>
}

function DecisionBadge({ decision }) {
  if (!decision) return <span className="badge badge-gray">n/a</span>
  const map = {
    APPROVED: 'badge-green',
    REJECTED: 'badge-red',
    'PASS TO CUSTOM': 'badge-amber',
  }
  return <span className={`badge ${map[decision] || 'badge-gray'}`}>{decision}</span>
}

function ModeBadge({ mode }) {
  const css = mode === 'flowable' ? 'badge-blue' : mode === 'custom' ? 'badge-purple' : 'badge-gray'
  return <span className={`badge ${css}`}>{mode || 'n/a'}</span>
}

function ClassBadge({ value }) {
  const map = { technical: 'badge-red', integration: 'badge-amber', business: 'badge-green' }
  if (!value) return <span className="badge badge-gray">n/a</span>
  return <span className={`badge ${map[value] || 'badge-gray'}`}>{value}</span>
}

function LaneBadge({ lane }) {
  const map = {
    action: ['badge-red', 'act now'],
    review: ['badge-amber', 'review'],
    watch: ['badge-blue', 'watch'],
    resolved: ['badge-green', 'resolved'],
    ignored: ['badge-gray', 'ignored'],
  }
  const [css, label] = map[lane] || ['badge-gray', lane || 'unknown']
  return <span className={`badge ${css}`}>{label}</span>
}

function PriorityBadge({ item }) {
  const age = ageMinutes(item.created_at)
  if (item.lane === 'action' && age >= 15) return <span className="badge badge-red">P1</span>
  if (item.lane === 'action' || item.lane === 'review' || age >= 30) return <span className="badge badge-amber">P2</span>
  return <span className="badge badge-blue">P3</span>
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

function ageMinutes(value) {
  if (!value) return 0
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 60000))
}

function formatAge(value) {
  const minutes = ageMinutes(value)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const hoursLeft = hours % 24
  return hoursLeft ? `${days}d ${hoursLeft}h` : `${days}d`
}

function ageTone(value) {
  const minutes = ageMinutes(value)
  if (minutes >= 30) return 'risk'
  if (minutes >= 15) return 'warn'
  return ''
}

function decisionReason(result, fallbackStatus) {
  if (!result || typeof result !== 'object') return fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-'
  return result.decision_reason || result.summary?.decision_reason || result.post_stop_factor?.reason || (fallbackStatus === 'RUNNING' ? 'Waiting for async completion callback' : '-')
}

function queueLane(row) {
  if (row.ignored) return 'ignored'
  if (row.needs_operator_action) return 'action'
  if (['FAILED', 'ENGINE_ERROR', 'ENGINE_UNREACHABLE', 'ORPHANED', 'UNAVAILABLE'].includes(row.status)) return 'action'
  if (row.status === 'REVIEW' || row.result?.decision === 'PASS TO CUSTOM') return 'review'
  if (['RUNNING', 'SUBMITTED', 'SUSPENDED'].includes(row.status)) return 'watch'
  return 'resolved'
}

function nextActionLabel(row) {
  const lane = queueLane(row)
  if (lane === 'action') {
    if (row.status === 'ENGINE_UNREACHABLE') return 'check engine health and reconcile'
    if (row.status === 'FAILED') return 'decide retry vs ignore'
    return 'operator intervention needed'
  }
  if (lane === 'review') return 'review decision and move forward'
  if (lane === 'watch') return row.status === 'RUNNING' ? 'monitor until callback lands' : 'watch pipeline progress'
  if (lane === 'ignored') return 'kept out of active queue'
  return 'no immediate action'
}

function searchMatches(row, query) {
  if (!query) return true
  const haystack = [
    row.request_id,
    applicantName(row),
    applicantLocation(row),
    row.status,
    row.error_class,
    row.result?.decision,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function queueScore(row) {
  let score = 0
  const lane = queueLane(row)
  const age = ageMinutes(row.created_at)
  if (lane === 'action') score += 300
  if (lane === 'review') score += 220
  if (lane === 'watch') score += 120
  if (row.error_class === 'technical') score += 40
  if (row.status === 'ENGINE_UNREACHABLE') score += 60
  if (row.needs_operator_action) score += 50
  return score + Math.min(age, 180)
}

function formatTrackerTime(value) {
  return value ? String(value).slice(11, 19) : '-'
}

function metricValue(result, key) {
  if (!result || typeof result !== 'object') return '-'
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {}
  const value = summary[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

const SECTION_META = {
  action: ['Act now', 'Requests that likely need a person before the queue grows further'],
  review: ['Manual review', 'Business review and pass-to-custom work that should stay visible'],
  watch: ['Watch closely', 'Still moving, but worth monitoring so they do not silently age out'],
  resolved: ['Resolved recently', 'Completed work kept visible for spot checks and cleanup'],
  ignored: ['Ignored', 'Kept outside the active queue but still available for audit and restore'],
}

export default function RequestsQueuePrototypePage({ onNavigate }) {
  const userRole = useMemo(() => getUserRole(), [])
  const canOperate = ['admin', 'senior_analyst'].includes(userRole)
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [tracker, setTracker] = useState([])
  const [focus, setFocus] = useState('hot')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')

  const loadList = async () => {
    try {
      const data = await get('/api/v1/requests')
      setItems(data.items || [])
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  const loadDetail = async (requestId) => {
    if (!requestId) return
    try {
      const [request, requestTracker] = await Promise.all([
        get(`/api/v1/requests/${requestId}`),
        get(`/api/v1/requests/${requestId}/tracker`),
      ])
      setDetail(request)
      setTracker((requestTracker.items || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  const selectRequest = async (requestId) => {
    setSelectedId(requestId)
    await loadDetail(requestId)
  }

  const runAction = async (path, successMessage, options = {}) => {
    if (!detail?.request_id) return
    setBusyAction(path)
    try {
      const response = await post(path, { reason: options.reason || 'Queue inbox action' })
      await loadList()
      if (options.openNewRequest && response.request_id) {
        await selectRequest(response.request_id)
        setNotice(`${successMessage}: ${response.request_id}`)
      } else {
        await loadDetail(detail.request_id)
        setNotice(successMessage)
      }
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyAction('')
    }
  }

  useEffect(() => { loadList() }, [])

  useEffect(() => {
    if (!detail?.request_id || !['RUNNING', 'SUBMITTED'].includes(detail.status)) return undefined
    const timer = setInterval(() => {
      loadDetail(detail.request_id)
    }, 4000)
    return () => clearInterval(timer)
  }, [detail?.request_id, detail?.status])

  const decorated = useMemo(() => (
    [...items]
      .map((row) => ({
        ...row,
        lane: queueLane(row),
        queue_score: queueScore(row),
        next_action_label: nextActionLabel(row),
        applicant_label: applicantName(row),
        location_label: applicantLocation(row),
      }))
      .sort((a, b) => b.queue_score - a.queue_score || new Date(b.created_at || 0) - new Date(a.created_at || 0))
  ), [items])

  const focusCounts = useMemo(() => ({
    hot: decorated.filter((row) => ['action', 'review', 'watch'].includes(row.lane)).length,
    review: decorated.filter((row) => row.lane === 'review').length,
    watch: decorated.filter((row) => row.lane === 'watch').length,
    resolved: decorated.filter((row) => row.lane === 'resolved').length,
    ignored: decorated.filter((row) => row.lane === 'ignored').length,
  }), [decorated])

  const visible = useMemo(() => decorated.filter((row) => {
    if (!searchMatches(row, query)) return false
    if (focus === 'hot') return ['action', 'review', 'watch'].includes(row.lane)
    return row.lane === focus
  }), [decorated, focus, query])

  const sections = useMemo(() => {
    const order = focus === 'hot' ? ['action', 'review', 'watch'] : [focus]
    return order.map((lane) => ({
      lane,
      title: SECTION_META[lane][0],
      description: SECTION_META[lane][1],
      items: visible.filter((row) => row.lane === lane),
    }))
  }, [focus, visible])

  useEffect(() => {
    if (!visible.length) {
      setSelectedId('')
      setDetail(null)
      setTracker([])
      return
    }
    if (!visible.some((row) => row.request_id === selectedId)) {
      const nextId = visible[0].request_id
      selectRequest(nextId)
    }
  }, [visible, selectedId])

  const queueStats = useMemo(() => ({
    active: decorated.filter((row) => ['action', 'review', 'watch'].includes(row.lane)).length,
    action: decorated.filter((row) => row.lane === 'action').length,
    review: decorated.filter((row) => row.lane === 'review').length,
    aging: decorated.filter((row) => ['action', 'review', 'watch'].includes(row.lane) && ageMinutes(row.created_at) >= 15).length,
    engineRisk: decorated.filter((row) => ['ENGINE_ERROR', 'ENGINE_UNREACHABLE', 'ORPHANED'].includes(row.status)).length,
  }), [decorated])

  const summary = detail?.result?.summary || {}
  const trackerPreview = tracker.slice(-6)
  const ops = detail?.ops || {}

  return (
    <div className="queue-shell">
      {error && <div className="notice notice-error mb-16">{error}</div>}
      {notice && <div className="notice mb-16">{notice}</div>}

      <div className="control-summary mb-16">
        <div className="card">
          <div className="card-title">Tomorrow, if volume spikes</div>
          <div className="queue-kicker">This prototype treats requests as live work queues, not just a historical table.</div>
        </div>
        <div className="card queue-callout">
          <strong>Why this helps:</strong> operators see what needs action first, what only needs monitoring, and what is safe to leave alone. The full Requests page stays available for deep audit and raw payload work.
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Active queue</div>
          <div className="stat-value blue">{queueStats.active}</div>
          <div className="stat-sub">Action + review + watch</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Act now</div>
          <div className="stat-value red">{queueStats.action}</div>
          <div className="stat-sub">Needs intervention or engine recovery</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Manual review</div>
          <div className="stat-value amber">{queueStats.review}</div>
          <div className="stat-sub">Business review bucket</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Aging 15m+</div>
          <div className="stat-value purple">{queueStats.aging}</div>
          <div className="stat-sub">Potential SLA risk</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Engine risk</div>
          <div className="stat-value red">{queueStats.engineRisk}</div>
          <div className="stat-sub">Flowable and infra exceptions</div>
        </div>
      </div>

      <div className="queue-main">
        <div className="queue-pane">
          <div className="card">
            <div className="queue-toolbar">
              <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none' }}>
                {[
                  ['hot', 'Hot queue'],
                  ['review', 'Review'],
                  ['watch', 'Watch'],
                  ['resolved', 'Resolved'],
                  ['ignored', 'Ignored'],
                ].map(([value, label]) => (
                  <button key={value} className={`tab-btn${focus === value ? ' active' : ''}`} onClick={() => setFocus(value)}>
                    {label}
                    <span className="tab-count">{focusCounts[value]}</span>
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => loadList()}>Refresh</button>
            </div>

            <div className="queue-toolbar" style={{ marginBottom: 0 }}>
              <div className="queue-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by request, applicant, location or status"
                />
              </div>
              <div className="queue-note">Prototype view: optimized for triage first, full detail second.</div>
            </div>
          </div>

          <div className="queue-sections">
            {sections.map((section) => (
              <div className="queue-section" key={section.lane}>
                <div className="queue-section-head">
                  <div>
                    <div className="queue-section-title">{section.title}</div>
                    <div className="queue-section-meta">{section.description}</div>
                  </div>
                  <span className="badge badge-gray">{section.items.length}</span>
                </div>

                {section.items.length === 0 ? (
                  <div className="queue-empty">Nothing here right now.</div>
                ) : (
                  <div className="queue-section-body">
                    {section.items.map((row) => (
                      <button
                        key={row.request_id}
                        className={`queue-item${selectedId === row.request_id ? ' active' : ''}`}
                        onClick={() => selectRequest(row.request_id)}
                      >
                        <div className="queue-item-top">
                          <div>
                            <div className="queue-item-title">{row.applicant_label}</div>
                            <div className="queue-item-sub mono">{row.request_id}</div>
                          </div>
                          <div className={`queue-age ${ageTone(row.created_at)}`}>{formatAge(row.created_at)}</div>
                        </div>

                        <div className="queue-chip-row">
                          <PriorityBadge item={row} />
                          <LaneBadge lane={row.lane} />
                          <StatusBadge status={row.status} />
                          <ModeBadge mode={row.orchestration_mode} />
                          <DecisionBadge decision={row.result?.decision} />
                          <ClassBadge value={row.error_class} />
                        </div>

                        <div className="queue-item-reason">{row.next_action_label}</div>
                        <div className="queue-item-foot">
                          <span>{decisionReason(row.result, row.status)}</span>
                          <span>{row.location_label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="queue-inspector">
          {!detail ? (
            <div className="card">
              <div className="card-title">Request workspace</div>
              <p className="text-muted text-sm">Pick a request from the queue to inspect it here.</p>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="flex-between mb-16">
                  <div>
                    <div className="card-title" style={{ marginBottom: 6 }}>{detail.request_id}</div>
                    <div className="text-muted text-sm">{applicantName(detail)} - {applicantLocation(detail)}</div>
                  </div>
                  <div className="queue-chip-row">
                    <LaneBadge lane={queueLane(detail)} />
                    <StatusBadge status={detail.status} />
                  </div>
                </div>

                <div className="queue-inspector-grid mb-16">
                  <div className="queue-mini">
                    <div className="queue-mini-label">Next action</div>
                    <div className="queue-mini-value">{nextActionLabel(detail)}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Time in queue</div>
                    <div className="queue-mini-value">{formatAge(detail.created_at)}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Decision</div>
                    <div className="queue-mini-value">{detail.result?.decision || detail.status}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Engine instance</div>
                    <div className="queue-mini-value">{detail.result?.engine?.instance_id || '-'}</div>
                  </div>
                </div>

                <div className="detail-panel">
                  <div className="kv-row"><span className="kv-key">Decision reason</span><span className="kv-val">{decisionReason(detail.result, detail.status)}</span></div>
                  <div className="kv-row"><span className="kv-key">Error class</span><span className="kv-val"><ClassBadge value={detail.error_class} /></span></div>
                  <div className="kv-row"><span className="kv-key">Needs action</span><span className="kv-val">{detail.needs_operator_action ? 'Yes' : 'No'}</span></div>
                  <div className="kv-row"><span className="kv-key">Ignored</span><span className="kv-val">{detail.ignored ? 'Yes' : 'No'}</span></div>
                  <div className="kv-row"><span className="kv-key">Correlation</span><span className="kv-val">{detail.correlation_id || '-'}</span></div>
                </div>

                <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.('requests')}>Open full Requests page</button>
                  <button className="btn btn-primary btn-sm" disabled={!canOperate || !ops.can_retry_as_new || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/retry-as-new`, 'Retry as new created', { openNewRequest: true })}>Retry as new</button>
                  {!detail.ignored ? (
                    <button className="btn btn-warn btn-sm" disabled={!canOperate || !ops.can_ignore || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/ignore`, 'Request marked as ignored')}>Ignore</button>
                  ) : (
                    <button className="btn btn-success btn-sm" disabled={!canOperate || !ops.can_restore || !!busyAction} onClick={() => runAction(`/api/v1/requests/${detail.request_id}/restore`, 'Ignored request restored')}>Restore</button>
                  )}
                  <button className="btn btn-danger btn-sm" disabled={!canOperate || !ops.can_reconcile_flowable || !!busyAction} onClick={() => runAction(`/api/v1/flowable/requests/${detail.request_id}/reconcile`, 'Flowable reconcile requested')}>Reconcile</button>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Decision signals</div>
                <div className="queue-inspector-grid">
                  <div className="queue-mini">
                    <div className="queue-mini-label">Credit score</div>
                    <div className="queue-mini-value">{metricValue(detail.result, 'credit_score')}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Collections</div>
                    <div className="queue-mini-value">{metricValue(detail.result, 'collection_count')}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Accounts found</div>
                    <div className="queue-mini-value">{metricValue(detail.result, 'accounts_found')}</div>
                  </div>
                  <div className="queue-mini">
                    <div className="queue-mini-label">Cashflow stability</div>
                    <div className="queue-mini-value">{summary.cashflow_stability || '-'}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Latest tracker signals</div>
                {trackerPreview.length === 0 ? (
                  <p className="text-muted text-sm">No tracker events recorded yet.</p>
                ) : (
                  <div className="timeline">
                    {trackerPreview.map((event, index) => (
                      <div className="tl-item" key={event.id}>
                        <div className="tl-rail">
                          <div className="tl-dot" />
                          {index < trackerPreview.length - 1 && <div className="tl-line" />}
                        </div>
                        <div className="tl-body">
                          <div className="tl-title">{event.title}</div>
                          <div className="tl-meta">
                            <span className="mono">{formatTrackerTime(event.created_at)}</span>
                            <span>{event.service_id || event.stage}</span>
                            {event.status && <StatusBadge status={event.status} />}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
