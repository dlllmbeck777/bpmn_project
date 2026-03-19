import React, { useEffect, useState, useMemo } from 'react'
import { get } from '../lib/api'

function StatusBadge({ status }) {
  const map = { COMPLETED: 'badge-green', REJECTED: 'badge-red', FAILED: 'badge-red', REVIEW: 'badge-amber', RUNNING: 'badge-blue', SUBMITTED: 'badge-blue', ENGINE_ERROR: 'badge-red', ORPHANED: 'badge-red' }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{(status || '').toLowerCase()}</span>
}

function applicantName(row) {
  return row.applicant_name || [row.applicant_profile?.firstName, row.applicant_profile?.lastName].filter(Boolean).join(' ') || 'Unknown'
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--border-1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', minWidth: 28, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function EngineStatusDot({ up }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: up ? 'var(--green)' : 'var(--red)',
      boxShadow: up ? '0 0 6px var(--green)' : 'none',
      animation: up ? 'dashPulse 2s infinite' : 'none',
      marginRight: 6,
    }} />
  )
}

export default function Dashboard() {
  const [services, setServices] = useState([])
  const [requests, setRequests] = useState([])
  const [flowHealth, setFlowHealth] = useState(null)
  const [warn, setWarn] = useState('')

  useEffect(() => {
    get('/api/v1/services').then(d => setServices(d.items || [])).catch(() => {})
    get('/api/v1/requests').then(d => setRequests(d.items || [])).catch(e => setWarn(e.message))
    get('/api/v1/flowable/health').then(setFlowHealth).catch(() => {})
  }, [])

  const enabledSvc = services.filter(s => s.enabled).length

  const reqStats = useMemo(() => {
    const total = requests.length
    const byStatus = {}
    requests.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1 })
    const completed = byStatus['COMPLETED'] || 0
    const failed = (byStatus['FAILED'] || 0) + (byStatus['ENGINE_ERROR'] || 0) + (byStatus['ORPHANED'] || 0)
    const review = byStatus['REVIEW'] || 0
    const running = byStatus['RUNNING'] || 0
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, failed, review, running, successRate, byStatus }
  }, [requests])

  const recentFailed = useMemo(() =>
    requests
      .filter(r => ['FAILED','ENGINE_ERROR','ORPHANED'].includes(r.status))
      .slice(0, 5),
    [requests]
  )

  const recentRequests = useMemo(() => requests.slice(0, 6), [requests])

  const engineUp = flowHealth?.status === 'UP'

  return (
    <>
      <style>{`
        @keyframes dashPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {warn && <div className="notice mb-16">{warn}</div>}

      {/* ── Top stat cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Total requests</div>
          <div className="stat-value blue">{reqStats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed</div>
          <div className="stat-value green">{reqStats.completed}</div>
          {reqStats.total > 0 && <div className="stat-sub green">{reqStats.successRate}% success</div>}
        </div>
        <div className="stat-card">
          <div className="stat-label">Failed / errors</div>
          <div className="stat-value" style={{ color: reqStats.failed > 0 ? 'var(--red)' : 'var(--green)' }}>{reqStats.failed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Needs review</div>
          <div className="stat-value amber">{reqStats.review}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Running now</div>
          <div className="stat-value blue">{reqStats.running}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active services</div>
          <div className="stat-value green">{enabledSvc}</div>
          {enabledSvc === services.length && services.length > 0 && <div className="stat-sub green">All up</div>}
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16, marginBottom: 20 }}>
        {/* ── Request breakdown ── */}
        <div className="card">
          <div className="card-title">Request status breakdown</div>
          {[
            { label: 'Completed',     val: reqStats.completed, color: 'var(--green)' },
            { label: 'Failed',        val: reqStats.failed,    color: 'var(--red)'   },
            { label: 'Review',        val: reqStats.review,    color: 'var(--amber)' },
            { label: 'Running',       val: reqStats.running,   color: 'var(--blue)'  },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
                <span style={{ fontSize: 11, color, fontFamily: 'monospace', fontWeight: 700 }}>
                  {reqStats.total > 0 ? `${Math.round((val / reqStats.total) * 100)}%` : '0%'}
                </span>
              </div>
              <MiniBar value={val} max={reqStats.total} color={color} />
            </div>
          ))}
        </div>

        {/* ── Flowable engine health ── */}
        <div className="card">
          <div className="card-title">
            <EngineStatusDot up={engineUp} />
            Flowable engine
          </div>
          {flowHealth ? (
            <>
              <div className="svc-list-item">
                <span className={`svc-dot ${engineUp ? 'up' : 'down'}`} />
                <span className="svc-name">Status</span>
                <span className="svc-type" style={{ color: engineUp ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{flowHealth.status}</span>
              </div>
              <div className="svc-list-item">
                <span className="svc-dot up" />
                <span className="svc-name">Database</span>
                <span className="svc-type">{flowHealth.database?.type || 'PostgreSQL'}</span>
              </div>
              <div className="svc-list-item">
                <span className={`svc-dot ${flowHealth.async_executor?.running ? 'up' : 'down'}`} />
                <span className="svc-name">Async executor</span>
                <span className="svc-type" style={{ color: flowHealth.async_executor?.running ? 'var(--green)' : 'var(--amber)' }}>
                  {flowHealth.async_executor?.running ? 'active' : 'inactive'}
                </span>
              </div>
              <div className="svc-list-item">
                <span className={`svc-dot ${(flowHealth.dead_jobs || 0) > 0 ? 'down' : 'up'}`} />
                <span className="svc-name">Dead letter jobs</span>
                <span className="svc-type" style={{ color: (flowHealth.dead_jobs || 0) > 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'monospace', fontWeight: 700 }}>
                  {flowHealth.dead_jobs || 0}
                </span>
              </div>
              {flowHealth.version && (
                <div className="svc-list-item">
                  <span className="svc-dot" style={{ background: 'var(--border-1)' }} />
                  <span className="svc-name">Version</span>
                  <span className="svc-type mono">{flowHealth.version}</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted text-sm">Connecting to Flowable…</p>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16, marginBottom: 20 }}>
        {/* ── Services health ── */}
        <div className="card">
          <div className="card-title">Services health</div>
          {services.length === 0 ? (
            <p className="text-muted text-sm">No services configured</p>
          ) : (
            services.map(s => (
              <div className="svc-list-item" key={s.id}>
                <span className={`svc-dot ${s.enabled ? 'up' : 'down'}`} />
                <span className="svc-name">{s.id}</span>
                <span className="svc-type">{s.type}</span>
                {!s.enabled && <span className="badge badge-gray" style={{ fontSize: 9 }}>disabled</span>}
              </div>
            ))
          )}
        </div>

        {/* ── Recent failures ── */}
        <div className="card">
          <div className="card-title">
            {recentFailed.length > 0
              ? <><span style={{ color: 'var(--red)', marginRight: 6 }}>⚠</span>Recent failures</>
              : 'Recent failures'}
          </div>
          {recentFailed.length === 0 ? (
            <p className="text-muted text-sm" style={{ color: 'var(--green)' }}>✓ No recent failures</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Request</th><th>Status</th><th>Applicant</th></tr></thead>
              <tbody>
                {recentFailed.map(r => (
                  <tr key={r.request_id}>
                    <td className="mono" style={{ fontSize: 11 }}>{r.request_id}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ fontSize: 11 }}>{applicantName(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Recent requests ── */}
      <div className="card">
        <div className="card-title">Recent requests</div>
        {requests.length === 0 ? (
          <p className="text-muted text-sm">No requests yet</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>ID</th><th>Applicant</th><th>Mode</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              {recentRequests.map(r => (
                <tr key={r.request_id}>
                  <td className="mono" style={{ fontWeight: 600, fontSize: 11 }}>{r.request_id}</td>
                  <td>{applicantName(r)}</td>
                  <td><span className={`badge ${r.orchestration_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{r.orchestration_mode}</span></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{(r.created_at || '').slice(11, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
