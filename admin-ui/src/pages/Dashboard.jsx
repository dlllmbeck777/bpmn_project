import React, { useCallback, useEffect, useState } from 'react'

import { get } from '../lib/api'

// Minimal inline sparkline — no extra dependency
function Sparkline({ values = [], color = 'var(--accent)', height = 30 }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const w = 120
  const h = height
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - (v / max) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-z]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sg-${color.replace(/[^a-z]/gi, '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" opacity=".7" />
    </svg>
  )
}

function StatCard({ label, value, colorClass, icon, footer, footerClass, sparkValues, sparkColor, loading }) {
  if (loading) {
    return (
      <div className="stat-card">
        <div className={`stat-icon ${icon}`}><div className="skeleton" style={{ width: 20, height: 20, borderRadius: 4 }} /></div>
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-value" />
      </div>
    )
  }
  return (
    <div className="stat-card">
      <div className={`stat-icon ${icon}`}>{null}</div>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${colorClass}`}>{value}</div>
      {footer && <div className={`stat-footer ${footerClass || ''}`}>{footer}</div>}
      {sparkValues && <Sparkline values={sparkValues} color={sparkColor} />}
    </div>
  )
}

function statusBadgeClass(status) {
  if (status === 'COMPLETED') return 'badge-green'
  if (status === 'FAILED')    return 'badge-red'
  if (status === 'REJECTED')  return 'badge-red'
  if (status === 'REVIEW')    return 'badge-orange'
  return 'badge-blue'
}

const PIPELINE_STEPS = ['Client', 'Gateway', 'Pre Check', 'Router', 'Orchestrator', 'Connectors', 'Parser', 'Post Check', 'SNP']

function formatRefreshed(date) {
  if (!date) return ''
  const secs = Math.floor((Date.now() - date) / 1000)
  if (secs < 5)  return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

export default function Dashboard() {
  const [services, setServices] = useState([])
  const [requests, setRequests] = useState([])
  const [rules,    setRules]    = useState([])
  const [stops,    setStops]    = useState([])
  const [warning,  setWarning]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [tick, setTick] = useState(0)          // drives the "X ago" label update

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [svcData, rulesData, stopsData] = await Promise.all([
        get('/api/v1/services').catch(() => ({ items: [] })),
        get('/api/v1/routing-rules').catch(() => ({ items: [] })),
        get('/api/v1/stop-factors').catch(() => ({ items: [] })),
      ])
      setServices(svcData.items  || [])
      setRules(rulesData.items   || [])
      setStops(stopsData.items   || [])
      await get('/api/v1/requests')
        .then((d) => { setRequests(d.items || []); setWarning('') })
        .catch((e) => setWarning(e.message))
    } finally {
      setLoading(false)
      setLastRefreshed(Date.now())
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Update "X ago" label every 10s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  const healthy    = services.filter((s) => s.enabled).length
  const disabled   = services.length - healthy
  const completed  = requests.filter((r) => r.status === 'COMPLETED').length
  const rejected   = requests.filter((r) => r.status === 'REJECTED').length
  const review     = requests.filter((r) => r.status === 'REVIEW').length
  const running    = requests.filter((r) => r.status === 'RUNNING').length

  // Fake trend data from actual counts; in production these would come from a metrics endpoint
  const reqSparkValues = requests.length
    ? Array.from({ length: 8 }, (_, i) => Math.max(1, requests.length - (7 - i) * 3 + Math.round(Math.random() * 4)))
    : []

  return (
    <>
      {warning && <div className="notice mb-16">Requests are protected: {warning}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {lastRefreshed && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Updated {formatRefreshed(lastRefreshed)}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Services Registered" colorClass="blue" icon="stat-icon-blue"
          value={loading ? '—' : services.length}
          footer={disabled > 0 ? `${disabled} disabled` : 'All enabled'}
          footerClass={disabled > 0 ? 'down' : 'up'}
          loading={loading}
        />
        <StatCard
          label="Enabled Services" colorClass="green" icon="stat-icon-green"
          value={loading ? '—' : `${healthy}/${services.length}`}
          footer={healthy === services.length && services.length > 0 ? 'All healthy' : `${disabled} inactive`}
          footerClass={healthy === services.length ? 'up' : 'down'}
          loading={loading}
        />
        <StatCard
          label="Routing Rules" colorClass="orange" icon="stat-icon-orange"
          value={loading ? '—' : rules.length}
          loading={loading}
        />
        <StatCard
          label="Stop Factors" colorClass="" icon="stat-icon-purple"
          value={loading ? '—' : stops.length}
          loading={loading}
        />
      </div>

      <div className="card mb-16">
        <div className="card-title"><span className="dot dot-blue" /> Request Pipeline</div>
        <div className="pipeline">
          {PIPELINE_STEPS.map((step, index) => (
            <React.Fragment key={step}>
              {index > 0 && <span className="pipe-arrow">→</span>}
              <div className={`pipe-step ${index === 3 || index === 4 ? 'active' : ''}`}>{step}</div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title"><span className="dot dot-green" /> Services Health</div>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-row" style={{ marginBottom: 6 }} />
            ))
          ) : (
            <table className="tbl">
              <thead><tr><th>Service</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                {services.slice(0, 8).map((service) => (
                  <tr key={service.id}>
                    <td className="mono">{service.id}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{service.type}</td>
                    <td>
                      <span className={`badge ${service.enabled ? 'badge-green' : 'badge-red'}`}>
                        {service.enabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                    </td>
                  </tr>
                ))}
                {services.length === 0 && (
                  <tr><td colSpan={3} className="muted-copy">No services registered.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title"><span className="dot dot-orange" /> Recent Requests</div>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-row" style={{ marginBottom: 6 }} />
            ))
          ) : requests.length === 0 ? (
            <p className="muted-copy">No request data loaded yet.</p>
          ) : (
            <>
              <table className="tbl">
                <thead><tr><th>ID</th><th>Mode</th><th>Status</th></tr></thead>
                <tbody>
                  {requests.slice(0, 6).map((request) => (
                    <tr key={request.request_id}>
                      <td className="mono">{request.request_id}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{request.orchestration_mode}</td>
                      <td>
                        <span className={`badge ${statusBadgeClass(request.status)}`}>
                          {request.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {requests.length > 0 && (
                <div className="status-breakdown">
                  <div className="status-breakdown-item">
                    <div className="status-breakdown-label">Completed</div>
                    <div className="status-breakdown-val" style={{ color: 'var(--accent-green)' }}>{completed}</div>
                  </div>
                  <div className="status-breakdown-item">
                    <div className="status-breakdown-label">Review</div>
                    <div className="status-breakdown-val" style={{ color: 'var(--accent-orange)' }}>{review}</div>
                  </div>
                  <div className="status-breakdown-item">
                    <div className="status-breakdown-label">Rejected</div>
                    <div className="status-breakdown-val" style={{ color: 'var(--accent-red)' }}>{rejected}</div>
                  </div>
                  <div className="status-breakdown-item">
                    <div className="status-breakdown-label">Running</div>
                    <div className="status-breakdown-val" style={{ color: 'var(--accent)' }}>{running}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
