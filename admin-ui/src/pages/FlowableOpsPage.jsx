import { useEffect, useMemo, useState } from 'react'

import { get, post } from '../lib/api'

function badgeClass(status) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'COMPLETED') return 'badge-green'
  if (normalized === 'RUNNING') return 'badge-blue'
  if (normalized === 'SUSPENDED') return 'badge-orange'
  if (normalized === 'FAILED' || normalized === 'CANCELLED') return 'badge-red'
  return 'badge-gray'
}

function previewJson(value) {
  try {
    const text = JSON.stringify(value)
    return text.length > 120 ? `${text.slice(0, 120)}...` : text
  } catch {
    return String(value)
  }
}

function timeLabel(value) {
  return value ? String(value).slice(0, 19) : '-'
}

export default function FlowableOpsPage({ canManage = false }) {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [requestIdFilter, setRequestIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionReason, setActionReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState('')

  const load = async (preserveSelection = true) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '50')
      params.set('status', statusFilter)
      if (requestIdFilter.trim()) params.set('request_id', requestIdFilter.trim())
      const data = await get(`/api/v1/flowable/instances?${params.toString()}`)
      const rows = data.items || []
      setItems(rows)
      setError('')
      if (!preserveSelection) {
        setSelectedId('')
        setDetail(null)
      } else if (selectedId && !rows.some((item) => item.instance_id === selectedId)) {
        setSelectedId('')
        setDetail(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(false) }, [])

  const openDetail = async (instanceId) => {
    if (!instanceId) return
    setSelectedId(instanceId)
    setDetailLoading(true)
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
    const instanceId = detail.instance.instance_id
    const requestId = detail.instance.request_id
    const actionMap = {
      suspend: `/api/v1/flowable/instances/${instanceId}/suspend`,
      activate: `/api/v1/flowable/instances/${instanceId}/activate`,
      retry: `/api/v1/flowable/instances/${instanceId}/retry-failed-jobs`,
      reconcile: requestId ? `/api/v1/flowable/requests/${requestId}/reconcile` : '',
    }
    if (!actionMap[kind]) return

    setActionLoading(kind)
    try {
      const response = await post(actionMap[kind], { reason: actionReason })
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
  const failedJobs = detail?.jobs?.filter((job) => job.exceptionMessage) || []

  const canSuspend = canManage && detailSummary?.engine_status === 'RUNNING'
  const canActivate = canManage && detailSummary?.engine_status === 'SUSPENDED'
  const canRetry = canManage && failedJobs.length > 0
  const canReconcile = canManage && !!detailSummary?.request_id && !['COMPLETED', 'REVIEW', 'REJECTED'].includes(detailSummary?.request_status)

  const selectedJobs = useMemo(() => detail?.jobs || [], [detail])

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      {notice && <div className="notice mb-16">{notice}</div>}
      {!canManage && <div className="notice mb-16">This page is read-only for the selected role. Analysts can inspect instances, variables, jobs and tracker history.</div>}

      <div className="card mb-16">
        <div className="tracker-toolbar">
          <div className="form-row tracker-filter">
            <label>Request ID</label>
            <input value={requestIdFilter} onChange={(event) => setRequestIdFilter(event.target.value)} placeholder="REQ-2026-0001" />
          </div>
          <div className="form-row flowable-filter">
            <label>Status</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="running">Running</option>
              <option value="suspended">Suspended</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="form-actions tracker-actions">
            <button className="btn btn-ghost" onClick={() => { setRequestIdFilter(''); setStatusFilter('all'); setNotice(''); load(false) }}>Reset</button>
            <button className="btn btn-primary" onClick={() => { setNotice(''); load(false) }}>{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        {items.length === 0 ? (
          <p className="muted-copy">No Flowable instances found for the current filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Request</th><th>Instance</th><th>Engine</th><th>Request Status</th><th>Activity</th><th>Jobs</th><th>Start</th><th></th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.instance_id || item.request_id}>
                    <td className="mono">{item.request_id || '-'}</td>
                    <td className="mono table-small">{item.instance_id || '-'}</td>
                    <td><span className={`badge ${badgeClass(item.engine_status)}`}>{item.engine_status}</span></td>
                    <td><span className={`badge ${badgeClass(item.request_status)}`}>{item.request_status}</span></td>
                    <td>{item.current_activity || '-'}</td>
                    <td className="mono">{item.failed_jobs}/{item.job_count}</td>
                    <td className="mono table-small">{timeLabel(item.start_time)}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openDetail(item.instance_id)} disabled={!item.instance_id}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(detailLoading || detailSummary) && (
        <div className="tracker-grid">
          <div className="card">
            <div className="flex-between mb-16">
              <div className="card-title" style={{ margin: 0 }}><span className="dot dot-blue" /> Instance Overview</div>
              {selectedId && <button className="btn btn-ghost btn-sm" onClick={() => openDetail(selectedId)}>{detailLoading ? 'Loading...' : 'Refresh Detail'}</button>}
            </div>
            {!detailSummary ? (
              <p className="muted-copy">Select an instance to inspect Flowable runtime and process data.</p>
            ) : (
              <div className="flowable-meta-grid">
                <div className="flowable-meta-card"><span className="flowable-meta-label">Request</span><span className="mono">{detailSummary.request_id || '-'}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Instance</span><span className="mono">{detailSummary.instance_id}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Engine</span><span className={`badge ${badgeClass(detailSummary.engine_status)}`}>{detailSummary.engine_status}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Current Activity</span><span>{detailSummary.current_activity || '-'}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Process Key</span><span className="mono">{detailSummary.process_definition_key || '-'}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Correlation</span><span className="mono">{detailSummary.correlation_id || '-'}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Started</span><span className="mono">{timeLabel(detailSummary.start_time)}</span></div>
                <div className="flowable-meta-card"><span className="flowable-meta-label">Ended</span><span className="mono">{timeLabel(detailSummary.end_time)}</span></div>
              </div>
            )}
          </div>

          {detailSummary && (
            <div className="card">
              <div className="card-title"><span className="dot dot-orange" /> Controlled Actions</div>
              <div className="form-row">
                <label>Reason</label>
                <input value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Optional operational reason for audit log" />
              </div>
              <div className="flex-gap flowable-actions">
                <button className="btn btn-ghost" disabled={!canSuspend || actionLoading} onClick={() => runAction('suspend')}>{actionLoading === 'suspend' ? 'Suspending...' : 'Suspend'}</button>
                <button className="btn btn-ghost" disabled={!canActivate || actionLoading} onClick={() => runAction('activate')}>{actionLoading === 'activate' ? 'Activating...' : 'Activate'}</button>
                <button className="btn btn-ghost" disabled={!canRetry || actionLoading} onClick={() => runAction('retry')}>{actionLoading === 'retry' ? 'Retrying...' : 'Retry Failed Jobs'}</button>
                <button className="btn btn-primary" disabled={!canReconcile || actionLoading} onClick={() => runAction('reconcile')}>{actionLoading === 'reconcile' ? 'Reconciling...' : 'Reconcile Request'}</button>
              </div>
            </div>
          )}

          {detail?.request && (
            <div className="card">
              <div className="card-title"><span className="dot dot-purple" /> Linked Request</div>
              <pre className="json-view">{JSON.stringify(detail.request, null, 2)}</pre>
            </div>
          )}

          {detail && (
            <>
              <div className="card">
                <div className="card-title"><span className="dot dot-green" /> Process Variables</div>
                <pre className="json-view">{JSON.stringify(detail.variables || {}, null, 2)}</pre>
              </div>

              <div className="card">
                <div className="card-title"><span className="dot dot-red" /> Jobs</div>
                {selectedJobs.length === 0 ? (
                  <p className="muted-copy">No active jobs were returned by Flowable for this instance.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead><tr><th>ID</th><th>Retries</th><th>Exception</th><th>Create Time</th></tr></thead>
                      <tbody>
                        {selectedJobs.map((job) => (
                          <tr key={job.id}>
                            <td className="mono table-small">{job.id}</td>
                            <td className="mono">{job.retries ?? '-'}</td>
                            <td className="mono table-ellipsis" title={job.exceptionMessage || ''}>{job.exceptionMessage || '-'}</td>
                            <td className="mono table-small">{timeLabel(job.createTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-title"><span className="dot dot-blue" /> Request Tracker</div>
                {detail.tracker?.length ? (
                  <div className="tracker-list">
                    {detail.tracker.map((item) => (
                      <details key={item.id} className="tracker-item">
                        <summary className="tracker-summary">
                          <span className="mono">{timeLabel(item.created_at).slice(11, 19)}</span>
                          <span className={`badge ${item.direction === 'OUT' ? 'badge-blue' : item.direction === 'IN' ? 'badge-green' : 'badge-orange'}`}>{item.direction}</span>
                          <span>{item.title}</span>
                          <span className="tracker-meta">{item.service_id || item.stage}</span>
                        </summary>
                        <div className="tracker-item-body">
                          <div className="tracker-meta-line">Status: {item.status || '-'}</div>
                          <div className="tracker-meta-line">Preview: {previewJson(item.payload)}</div>
                          <pre className="json-view mt-16">{JSON.stringify(item.payload, null, 2)}</pre>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">No tracker events linked to this request yet.</p>
                )}
              </div>

              <div className="grid-2">
                <div className="card">
                  <div className="card-title"><span className="dot dot-blue" /> Runtime Raw</div>
                  <pre className="json-view">{JSON.stringify(detail.runtime_raw || {}, null, 2)}</pre>
                </div>
                <div className="card">
                  <div className="card-title"><span className="dot dot-orange" /> History Raw</div>
                  <pre className="json-view">{JSON.stringify(detail.history_raw || {}, null, 2)}</pre>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
