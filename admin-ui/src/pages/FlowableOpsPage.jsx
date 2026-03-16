import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { get, post } from '../lib/api'

function badgeClass(status) {
  const s = String(status || '').toUpperCase()
  if (s === 'COMPLETED')            return 'badge-green'
  if (s === 'RUNNING')              return 'badge-blue'
  if (s === 'SUSPENDED')            return 'badge-orange'
  if (s === 'FAILED' || s === 'CANCELLED') return 'badge-red'
  return 'badge-gray'
}

function previewJson(value) {
  try {
    const text = JSON.stringify(value)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(value)
  }
}

function timeLabel(value) {
  return value ? String(value).slice(0, 19) : '—'
}

// Collapsible JSON section
function JsonSection({ title, colorDot, data }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <div
        className="flex-between"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="card-title" style={{ margin: 0 }}>
          <span className={`dot ${colorDot}`} /> {title}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open ? '▲ collapse' : '▼ expand'}</span>
      </div>
      {open && <pre className="json-view" style={{ marginTop: 12 }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

// Tab bar
function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-btn ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge != null && <span className="tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export default function FlowableOpsPage({ canManage = false }) {
  const [items,           setItems]           = useState([])
  const [selectedId,      setSelectedId]      = useState('')
  const [detail,          setDetail]          = useState(null)
  const [requestIdFilter, setRequestIdFilter] = useState('')
  const [statusFilter,    setStatusFilter]    = useState('all')
  const [actionReason,    setActionReason]    = useState('')
  const [error,           setError]           = useState('')
  const [notice,          setNotice]          = useState('')
  const [loading,         setLoading]         = useState(false)
  const [detailLoading,   setDetailLoading]   = useState(false)
  const [actionLoading,   setActionLoading]   = useState('')
  const [autoRefresh,     setAutoRefresh]     = useState(false)
  const [activeTab,       setActiveTab]       = useState('overview')
  const autoRefreshRef = useRef(null)

  const load = useCallback(async (preserveSelection = true) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50', status: statusFilter })
      if (requestIdFilter.trim()) params.set('request_id', requestIdFilter.trim())
      const data = await get(`/api/v1/flowable/instances?${params}`)
      const rows = data.items || []
      setItems(rows)
      setError('')
      if (!preserveSelection) {
        setSelectedId('')
        setDetail(null)
      } else if (selectedId && !rows.some((r) => r.instance_id === selectedId)) {
        setSelectedId('')
        setDetail(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, requestIdFilter, selectedId])

  useEffect(() => { load(false) }, [])   // initial load

  // Auto-refresh interval (30s)
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => refreshAll(), 30_000)
    } else {
      clearInterval(autoRefreshRef.current)
    }
    return () => clearInterval(autoRefreshRef.current)
  }, [autoRefresh, selectedId])

  const openDetail = async (instanceId) => {
    if (!instanceId) return
    setSelectedId(instanceId)
    setDetailLoading(true)
    setActiveTab('overview')
    try {
      const data = await get(`/api/v1/flowable/instances/${instanceId}`)
      setDetail(data)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshAll = async () => {
    await load(true)
    if (selectedId) await openDetail(selectedId)
  }

  const runAction = async (kind) => {
    if (!detail?.instance) return
    const { instance_id: instanceId, request_id: requestId } = detail.instance
    const urlMap = {
      suspend:    `/api/v1/flowable/instances/${instanceId}/suspend`,
      activate:   `/api/v1/flowable/instances/${instanceId}/activate`,
      retry:      `/api/v1/flowable/instances/${instanceId}/retry-failed-jobs`,
      reconcile:  requestId ? `/api/v1/flowable/requests/${requestId}/reconcile` : '',
    }
    if (!urlMap[kind]) return
    setActionLoading(kind)
    try {
      const response = await post(urlMap[kind], { reason: actionReason })
      setNotice(`${kind} completed: ${response.status || 'ok'}`)
      setError('')
      await load(true)
      await openDetail(instanceId)
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading('')
    }
  }

  const detailSummary = detail?.instance || null
  const failedJobs    = useMemo(() => detail?.jobs?.filter((j) => j.exceptionMessage) || [], [detail])
  const allJobs       = useMemo(() => detail?.jobs || [], [detail])

  const canSuspend    = canManage && detailSummary?.engine_status === 'RUNNING'
  const canActivate   = canManage && detailSummary?.engine_status === 'SUSPENDED'
  const canRetry      = canManage && failedJobs.length > 0
  const canReconcile  = canManage && !!detailSummary?.request_id
    && !['COMPLETED', 'REVIEW', 'REJECTED'].includes(detailSummary?.request_status)

  const detailTabs = [
    { id: 'overview',   label: 'Overview' },
    { id: 'variables',  label: 'Variables' },
    { id: 'jobs',       label: 'Jobs', badge: failedJobs.length > 0 ? failedJobs.length : null },
    { id: 'tracker',    label: 'Tracker', badge: detail?.tracker?.length || null },
    { id: 'raw',        label: 'Raw JSON' },
  ]

  // Apply filter on Enter key
  const handleFilterKeyDown = (e) => {
    if (e.key === 'Enter') { setNotice(''); load(false) }
  }

  return (
    <>
      {error  && <div className="notice mb-16" style={{ borderColor: 'rgba(248,81,73,.25)', background: 'rgba(248,81,73,.06)' }}>{error}</div>}
      {notice && <div className="notice mb-16">{notice}</div>}
      {!canManage && (
        <div className="notice mb-16">
          Read-only view — analysts can inspect instances, variables, jobs and tracker history.
        </div>
      )}

      {/* Filter toolbar */}
      <div className="card mb-16">
        <div className="tracker-toolbar">
          <div className="form-row tracker-filter">
            <label>Request ID</label>
            <input
              value={requestIdFilter}
              onChange={(e) => setRequestIdFilter(e.target.value)}
              onKeyDown={handleFilterKeyDown}
              placeholder="REQ-2026-0001 — press Enter to search"
            />
          </div>
          <div className="form-row flowable-filter">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="running">Running</option>
              <option value="suspended">Suspended</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="form-actions tracker-actions">
            <div className="refresh-toggle">
              <div
                className={`toggle-pill ${autoRefresh ? 'on' : ''}`}
                onClick={() => setAutoRefresh((v) => !v)}
                title="Auto-refresh every 30s"
              />
              <span>Auto</span>
            </div>
            <button className="btn btn-ghost" onClick={() => { setRequestIdFilter(''); setStatusFilter('all'); setNotice(''); load(false) }}>Reset</button>
            <button className="btn btn-primary" onClick={() => { setNotice(''); load(false) }} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Instances list */}
      <div className="card mb-16">
        <div className="result-meta">
          {autoRefresh && <span className="live-dot" />}
          {loading ? 'Loading…' : `${items.length} instance${items.length !== 1 ? 's' : ''} found`}
          {autoRefresh && <span style={{ marginLeft: 4 }}>· auto-refresh on</span>}
        </div>

        {items.length === 0 && !loading ? (
          <p className="muted-copy">No Flowable instances found for the current filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Request</th><th>Instance</th><th>Engine</th><th>Request Status</th><th>Activity</th><th>Jobs (fail/total)</th><th>Start</th><th /></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.instance_id || item.request_id}>
                    <td className="mono">{item.request_id || '—'}</td>
                    <td className="mono table-small">{item.instance_id || '—'}</td>
                    <td><span className={`badge ${badgeClass(item.engine_status)}`}>{item.engine_status}</span></td>
                    <td><span className={`badge ${badgeClass(item.request_status)}`}>{item.request_status}</span></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{item.current_activity || '—'}</td>
                    <td className="mono">
                      {item.failed_jobs > 0
                        ? <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>{item.failed_jobs}</span>
                        : item.failed_jobs}
                      /{item.job_count}
                    </td>
                    <td className="mono table-small">{timeLabel(item.start_time)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => openDetail(item.instance_id)}
                        disabled={!item.instance_id}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {(detailLoading || detailSummary) && (
        <div className="tracker-grid">
          {/* Header with tabs */}
          <div className="card">
            <div className="flex-between mb-16">
              <div className="card-title" style={{ margin: 0 }}>
                <span className="dot dot-blue" /> Instance Detail
                {detailSummary && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {detailSummary.instance_id}
                  </span>
                )}
              </div>
              {selectedId && (
                <button className="btn btn-ghost btn-sm" onClick={() => openDetail(selectedId)}>
                  {detailLoading ? 'Loading…' : 'Refresh'}
                </button>
              )}
            </div>

            {!detailSummary ? (
              <p className="muted-copy">Select an instance above to inspect Flowable runtime and process data.</p>
            ) : (
              <>
                <Tabs tabs={detailTabs} active={activeTab} onChange={setActiveTab} />

                {/* ── Overview tab ── */}
                {activeTab === 'overview' && (
                  <div className="flowable-meta-grid">
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Request</span><span className="mono">{detailSummary.request_id || '—'}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Instance</span><span className="mono">{detailSummary.instance_id}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Engine</span><span className={`badge ${badgeClass(detailSummary.engine_status)}`}>{detailSummary.engine_status}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Request Status</span><span className={`badge ${badgeClass(detailSummary.request_status)}`}>{detailSummary.request_status || '—'}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Current Activity</span><span>{detailSummary.current_activity || '—'}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Process Key</span><span className="mono">{detailSummary.process_definition_key || '—'}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Correlation</span><span className="mono">{detailSummary.correlation_id || '—'}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Started</span><span className="mono">{timeLabel(detailSummary.start_time)}</span></div>
                    <div className="flowable-meta-card"><span className="flowable-meta-label">Ended</span><span className="mono">{timeLabel(detailSummary.end_time)}</span></div>
                  </div>
                )}

                {/* ── Variables tab ── */}
                {activeTab === 'variables' && (
                  <pre className="json-view">{JSON.stringify(detail?.variables || {}, null, 2)}</pre>
                )}

                {/* ── Jobs tab ── */}
                {activeTab === 'jobs' && (
                  allJobs.length === 0 ? (
                    <p className="muted-copy">No active jobs for this instance.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="tbl">
                        <thead><tr><th>ID</th><th>Retries</th><th>Exception</th><th>Create Time</th></tr></thead>
                        <tbody>
                          {allJobs.map((job) => (
                            <tr key={job.id}>
                              <td className="mono table-small">{job.id}</td>
                              <td className="mono">{job.retries ?? '—'}</td>
                              <td
                                className="mono table-ellipsis"
                                title={job.exceptionMessage || ''}
                                style={job.exceptionMessage ? { color: 'var(--accent-red)' } : {}}
                              >
                                {job.exceptionMessage || '—'}
                              </td>
                              <td className="mono table-small">{timeLabel(job.createTime)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {/* ── Tracker tab ── */}
                {activeTab === 'tracker' && (
                  detail?.tracker?.length ? (
                    <div className="tracker-list">
                      {detail.tracker.map((item) => (
                        <details key={item.id} className="tracker-item">
                          <summary className="tracker-summary">
                            <span className="mono">{timeLabel(item.created_at).slice(11, 19)}</span>
                            <span className={`badge ${item.direction === 'OUT' ? 'badge-blue' : item.direction === 'IN' ? 'badge-green' : 'badge-orange'}`}>
                              {item.direction}
                            </span>
                            <span>{item.title}</span>
                            <span className="tracker-meta">{item.service_id || item.stage}</span>
                          </summary>
                          <div className="tracker-item-body">
                            <div className="tracker-meta-line">Status: {item.status || '—'}</div>
                            <div className="tracker-meta-line">Preview: {previewJson(item.payload)}</div>
                            <pre className="json-view mt-16">{JSON.stringify(item.payload, null, 2)}</pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-copy">No tracker events linked to this request yet.</p>
                  )
                )}

                {/* ── Raw JSON tab ── */}
                {activeTab === 'raw' && detail && (
                  <div className="grid-2">
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Runtime</div>
                      <pre className="json-view">{JSON.stringify(detail.runtime_raw || {}, null, 2)}</pre>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>History</div>
                      <pre className="json-view">{JSON.stringify(detail.history_raw || {}, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Actions card */}
          {detailSummary && (
            <div className="card">
              <div className="card-title"><span className="dot dot-orange" /> Controlled Actions</div>
              {!canManage ? (
                <p className="muted-copy" style={{ fontSize: 12 }}>Requires senior_analyst or admin role to perform actions.</p>
              ) : (
                <>
                  <div className="form-row">
                    <label>Reason (optional)</label>
                    <input
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder="Operational reason for audit log"
                    />
                  </div>
                  <div className="flex-gap flowable-actions">
                    <button className="btn btn-ghost"   disabled={!canSuspend   || !!actionLoading} onClick={() => runAction('suspend')}>
                      {actionLoading === 'suspend'   ? 'Suspending…'   : 'Suspend'}
                    </button>
                    <button className="btn btn-ghost"   disabled={!canActivate  || !!actionLoading} onClick={() => runAction('activate')}>
                      {actionLoading === 'activate'  ? 'Activating…'   : 'Activate'}
                    </button>
                    <button className="btn btn-ghost"   disabled={!canRetry     || !!actionLoading} onClick={() => runAction('retry')}>
                      {actionLoading === 'retry'     ? 'Retrying…'     : `Retry Failed${failedJobs.length > 0 ? ` (${failedJobs.length})` : ''}`}
                    </button>
                    <button className="btn btn-primary" disabled={!canReconcile || !!actionLoading} onClick={() => runAction('reconcile')}>
                      {actionLoading === 'reconcile' ? 'Reconciling…'  : 'Reconcile Request'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Linked request — collapsible */}
          {detail?.request && (
            <JsonSection title="Linked Request" colorDot="dot-purple" data={detail.request} />
          )}
        </div>
      )}
    </>
  )
}
