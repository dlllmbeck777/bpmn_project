import { useEffect, useState, useMemo } from 'react'
import { get, post } from '../lib/api'
import { IconBack, IconLayers } from '../components/Icons'

function B({ s }) {
  const m = { COMPLETED: 'badge-green', RUNNING: 'badge-blue', SUSPENDED: 'badge-amber', FAILED: 'badge-red', CANCELLED: 'badge-red', ORPHANED: 'badge-red', OK: 'badge-green', PASS: 'badge-green', REJECT: 'badge-red', REJECTED: 'badge-red', SUBMITTED: 'badge-teal', REVIEW: 'badge-amber', PENDING: 'badge-amber', UNAVAILABLE: 'badge-red', STARTED: 'badge-blue', DISPATCHED: 'badge-blue', SKIPPED: 'badge-gray', MISSING_INSTANCE: 'badge-gray', FLOWABLE: 'badge-blue', CUSTOM: 'badge-purple', TERMINATED: 'badge-red' }
  return <span className={`badge ${m[s] || 'badge-gray'}`}>{(s || '—').toLowerCase()}</span>
}

function KV({ label, children }) {
  return <div className="kv-row"><span className="kv-key">{label}</span><span className="kv-val">{children}</span></div>
}

function time(v) { return v ? String(v).slice(11, 19) : '—' }
function timeFull(v) { return v ? String(v).slice(0, 19) : '—' }

export default function FlowableAdminPage({ canManage }) {
  const [tab, setTab] = useState('health')
  const [items, setItems] = useState([])
  const [detail, setDetail] = useState(null)
  const [selId, setSelId] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ridFilter, setRidFilter] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [instTab, setInstTab] = useState('overview')

  // Load instances list
  const loadInstances = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50', status: statusFilter })
      if (ridFilter.trim()) params.set('request_id', ridFilter.trim())
      const d = await get(`/api/v1/flowable/instances?${params}`)
      setItems(d.items || [])
      setError('')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const openDetail = async (instanceId) => {
    if (!instanceId) return
    setSelId(instanceId)
    setInstTab('overview')
    try {
      const d = await get(`/api/v1/flowable/instances/${instanceId}`)
      setDetail(d)
      setError('')
    } catch (e) { setError(e.message) }
  }

  const runAction = async (path) => {
    try {
      const r = await post(path, { reason })
      setNotice(`Action completed: ${r.status || 'ok'}`)
      setError('')
      if (tab === 'instances') { await loadInstances(); if (selId) await openDetail(selId) }
    } catch (e) { setError(e.message) }
  }

  useEffect(() => { if (tab === 'instances') loadInstances() }, [tab, statusFilter])

  const ds = detail?.instance || null
  const failedJobs = (detail?.jobs || []).filter(j => j.exceptionMessage)
  const allJobs = detail?.jobs || []
  const vars = detail?.variables || {}
  const trackerItems = detail?.tracker || []

  const tabs = [
    { id: 'health', label: 'Health' },
    { id: 'instances', label: 'Instances', count: items.length },
    { id: 'detail', label: 'Instance detail', hidden: true },
  ]

  const renderTabs = () => (
    <div className="tab-bar">
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.id} className={`tab-btn${tab === t.id ? ' active' : ''}${t.alert ? ' alert' : ''}`} onClick={() => { setTab(t.id); setDetail(null); setSelId('') }}>
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )

  // ─── Health Tab ───
  const renderHealth = () => (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card"><div className="stat-label">Active instances</div><div className="stat-value blue">—</div></div>
        <div className="stat-card"><div className="stat-label">Suspended</div><div className="stat-value amber">—</div></div>
        <div className="stat-card"><div className="stat-label">Dead letter jobs</div><div className="stat-value red">—</div></div>
        <div className="stat-card"><div className="stat-label">User tasks</div><div className="stat-value purple">—</div></div>
        <div className="stat-card"><div className="stat-label">Deployments</div><div className="stat-value green">—</div></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Engine health</div>
          <KV label="Status"><span className="flex-center gap-6"><span className="svc-dot up" />UP</span></KV>
          <KV label="Database">PostgreSQL — connected</KV>
          <KV label="Async executor">ACTIVE</KV>
          <KV label="Flowable version">6.8.0</KV>
          <p className="text-muted text-sm mt-12">Health data loads from GET /actuator/health. Connect Flowable proxy endpoints to see live data.</p>
        </div>
        <div className="card">
          <div className="card-title">Process definitions</div>
          <KV label="creditServiceChain">latest version</KV>
          <p className="text-muted text-sm mt-12">Definition stats load from GET /repository/process-definitions.</p>
        </div>
      </div>
    </>
  )

  // ─── Instances Tab ───
  const renderInstances = () => (
    <>
      <div className="toolbar">
        <input value={ridFilter} onChange={e => setRidFilter(e.target.value)} placeholder="Filter by request ID..." style={{ flex: 1, maxWidth: 240 }} onKeyDown={e => e.key === 'Enter' && loadInstances()} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 130 }}>
          <option value="all">All states</option>
          <option value="running">Running</option>
          <option value="orphaned">Orphaned</option>
          <option value="suspended">Suspended</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRidFilter(''); setStatusFilter('all'); loadInstances() }}>Reset</button>
          <button className="btn btn-primary btn-sm" onClick={loadInstances} style={{ marginLeft: 4 }}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
      </div>

      <div className="card">
        <p className="text-muted text-sm" style={{ padding: '0 16px 12px' }}>
          Open an instance to see runtime controls. `Terminate runtime` is available inside the instance detail view.
        </p>
        {items.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: 16 }}>No Flowable instances found</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Request</th><th>Instance</th><th>Engine</th><th>Request status</th><th>Activity</th><th>Jobs</th><th>Start</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.instance_id || i.request_id} style={{ cursor: i.instance_id ? 'pointer' : 'default' }} onClick={() => i.instance_id && openDetail(i.instance_id)}>
                  <td className="mono">{i.request_id || '—'}</td>
                  <td className="mono text-sm">{i.instance_id || '—'}</td>
                  <td><B s={i.engine_status} /></td>
                  <td><B s={i.request_status} /></td>
                  <td className="text-sm">{i.current_activity || '—'}</td>
                  <td className="mono" style={i.failed_jobs > 0 ? { color: 'var(--red)', fontWeight: 600 } : {}}>{i.failed_jobs}/{i.job_count}</td>
                  <td className="mono text-sm" style={{ color: 'var(--text-3)' }}>{timeFull(i.start_time)}</td>
                  <td>
                    {i.instance_id ? (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(i.instance_id)
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-3)' }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )

  // ─── Instance Detail ───
  const renderDetail = () => {
    if (!ds) return <p className="text-muted">Loading...</p>

    const canSusp = canManage && ds.engine_status === 'RUNNING'
    const canAct = canManage && ds.engine_status === 'SUSPENDED'
    const canRetry = canManage && failedJobs.length > 0
    const canTerminate = canManage && ['RUNNING', 'SUSPENDED', 'ORPHANED'].includes(ds.engine_status)
    const canReconcile = canManage && ds.request_id && !['COMPLETED', 'REVIEW', 'REJECTED'].includes(ds.request_status)

    const varEntries = Object.entries(vars)

    return (
      <>
        <div className="flex-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => { setTab('instances'); setDetail(null); setSelId('') }}>
            <IconBack /> Instances
          </button>
          <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{ds.instance_id}</span>
          <B s={ds.engine_status} />
          <span className="mono text-sm" style={{ color: 'var(--text-3)' }}>{ds.request_id}</span>
        </div>

        {/* Action bar */}
        <div className="toolbar">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for audit..." style={{ flex: 1 }} />
          <button className="btn btn-warn btn-sm" disabled={!canSusp} onClick={() => runAction(`/api/v1/flowable/instances/${ds.instance_id}/suspend`)}>Suspend</button>
          <button className="btn btn-success btn-sm" disabled={!canAct} onClick={() => runAction(`/api/v1/flowable/instances/${ds.instance_id}/activate`)}>Activate</button>
          <button className="btn btn-danger btn-sm" disabled={!canTerminate} onClick={() => runAction(`/api/v1/flowable/instances/${ds.instance_id}/terminate`)}>Terminate runtime</button>
          <span className="toolbar-sep" />
          <button className="btn btn-danger btn-sm" disabled={!canRetry} onClick={() => runAction(`/api/v1/flowable/instances/${ds.instance_id}/retry-failed-jobs`)}>Retry failed jobs</button>
          <button className="btn btn-primary btn-sm" disabled={!canReconcile} onClick={() => runAction(`/api/v1/flowable/requests/${ds.request_id}/reconcile`)}>Reconcile</button>
        </div>

        {ds.engine_status === 'ORPHANED' && (
          <div className="notice notice-warn mb-16">
            This runtime instance is still alive in Flowable, but the linked platform request is already finalized. It is safe to terminate the runtime instance after a quick check.
          </div>
        )}

        {/* Inner tabs */}
        <div className="tab-bar">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'variables', label: 'Variables', count: varEntries.length },
            { id: 'jobs', label: 'Jobs', count: allJobs.length },
            { id: 'tracker', label: 'Tracker', count: trackerItems.length },
          ].map(t => (
            <button key={t.id} className={`tab-btn${instTab === t.id ? ' active' : ''}`} onClick={() => setInstTab(t.id)}>
              {t.label}
              {t.count != null && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {instTab === 'overview' && (
          <div className="grid-2">
            <div className="card">
              <div className="card-title">Instance</div>
              <KV label="Instance ID">{ds.instance_id}</KV>
              <KV label="Request ID">{ds.request_id || '—'}</KV>
              <KV label="Engine"><B s={ds.engine_status} /></KV>
              <KV label="Request status"><B s={ds.request_status} /></KV>
              <KV label="Current activity">{ds.current_activity || '—'}</KV>
              <KV label="Process key">{ds.process_definition_key || '—'}</KV>
              <KV label="Correlation">{ds.correlation_id || '—'}</KV>
              <KV label="Started">{timeFull(ds.start_time)}</KV>
              <KV label="Ended">{timeFull(ds.end_time)}</KV>
            </div>
            <div className="card">
              <div className="card-title">Quick view — variables</div>
              {varEntries.slice(0, 10).map(([k, v]) => (
                <KV key={k} label={k}>{typeof v === 'object' ? JSON.stringify(v).slice(0, 40) + '...' : String(v)}</KV>
              ))}
              {varEntries.length > 10 && <p className="text-muted text-sm mt-12">+{varEntries.length - 10} more — see Variables tab</p>}
            </div>
          </div>
        )}

        {instTab === 'variables' && (
          <div className="card">
            {varEntries.length === 0 ? <p className="text-muted text-sm">No variables</p> : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {varEntries.map(([k, v]) => (
                  <div key={k} className="kv-row" style={{ padding: '4px 8px', borderRadius: 4 }}>
                    <span className="kv-key">{k}</span>
                    <span className="kv-val" title={typeof v === 'object' ? JSON.stringify(v) : String(v)}>
                      {typeof v === 'object' ? JSON.stringify(v).slice(0, 30) + '...' : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {instTab === 'jobs' && (
          <div className="card">
            {allJobs.length === 0 ? <p className="text-muted text-sm">No jobs for this instance</p> : (
              <table className="tbl">
                <thead><tr><th>Job ID</th><th>Retries</th><th>Exception</th><th>Created</th></tr></thead>
                <tbody>
                  {allJobs.map(j => (
                    <tr key={j.id}>
                      <td className="mono text-sm">{j.id}</td>
                      <td className="mono">{j.retries ?? '—'}</td>
                      <td>{j.exceptionMessage ? <span className="mono text-sm" style={{ color: 'var(--red)', maxWidth: 260, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.exceptionMessage}>{j.exceptionMessage}</span> : '—'}</td>
                      <td className="mono text-sm" style={{ color: 'var(--text-3)' }}>{timeFull(j.createTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {instTab === 'tracker' && (
          <div className="card">
            {trackerItems.length === 0 ? <p className="text-muted text-sm">No tracker events</p> : (
              trackerItems.map(ev => (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, width: 56 }}>{time(ev.created_at)}</span>
                  <span className={`badge ${ev.direction === 'OUT' ? 'badge-blue' : ev.direction === 'IN' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 10, flexShrink: 0 }}>{ev.direction}</span>
                  <span style={{ flex: 1 }}>{ev.title}</span>
                  {ev.status && <B s={ev.status} />}
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{ev.service_id || ev.stage}</span>
                </div>
              ))
            )}
          </div>
        )}
      </>
    )
  }

  // When detail is opened, override to detail view
  useEffect(() => {
    if (detail && selId) setTab('detail')
  }, [detail, selId])

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      {notice && <div className="notice mb-16">{notice}</div>}
      {!canManage && <div className="notice notice-warn mb-16">Read-only mode. Senior analyst or admin role required for actions.</div>}

      {renderTabs()}

      {tab === 'health' && renderHealth()}
      {tab === 'instances' && renderInstances()}
      {tab === 'detail' && renderDetail()}
    </>
  )
}
