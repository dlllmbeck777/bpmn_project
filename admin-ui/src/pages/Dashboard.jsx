import React, { useEffect, useState } from 'react'
import { get } from '../lib/api'
import { IconChevron } from '../components/Icons'

function StatusBadge({ status }) {
  const map = { COMPLETED: 'badge-green', REJECTED: 'badge-red', FAILED: 'badge-red', REVIEW: 'badge-amber', RUNNING: 'badge-blue', SUBMITTED: 'badge-blue' }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{(status || '').toLowerCase()}</span>
}

function ModeBadge({ mode }) {
  return <span className={`badge ${mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{mode}</span>
}

function applicantName(row) {
  return row.applicant_name || [
    row.applicant_profile?.firstName,
    row.applicant_profile?.lastName,
  ].filter(Boolean).join(' ') || 'Unknown applicant'
}

const STEPS = ['Client', 'Gateway', 'Pre check', 'Router', 'Orchestrator', 'Connectors', 'Parser', 'Post check', 'SNP']

export default function Dashboard() {
  const [services, setServices] = useState([])
  const [requests, setRequests] = useState([])
  const [rules, setRules] = useState([])
  const [stops, setStops] = useState([])
  const [warn, setWarn] = useState('')

  useEffect(() => {
    get('/api/v1/services').then(d => setServices(d.items || [])).catch(() => {})
    get('/api/v1/routing-rules').then(d => setRules(d.items || [])).catch(() => {})
    get('/api/v1/stop-factors').then(d => setStops(d.items || [])).catch(() => {})
    get('/api/v1/requests').then(d => setRequests(d.items || [])).catch(e => setWarn(e.message))
  }, [])

  const enabled = services.filter(s => s.enabled).length

  return (
    <>
      {warn && <div className="notice mb-16">{warn}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Active services</div>
          <div className="stat-value green">{enabled}</div>
          {enabled === services.length && services.length > 0 && <div className="stat-sub green">All healthy</div>}
        </div>
        <div className="stat-card">
          <div className="stat-label">Total requests</div>
          <div className="stat-value blue">{requests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Routing rules</div>
          <div className="stat-value amber">{rules.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Stop factors</div>
          <div className="stat-value purple">{stops.length}</div>
        </div>
      </div>

      <div className="card mb-20">
        <div className="card-title">Request pipeline</div>
        <div className="pipeline">
          {STEPS.map((step, i) => (
            <React.Fragment key={step}>
              {i > 0 && <span className="pipe-arrow"><IconChevron /></span>}
              <div className={`pipe-step${i < 3 ? ' done' : i < 5 ? ' active' : ''}`}>{step}</div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Services health</div>
          {services.map(s => (
            <div className="svc-list-item" key={s.id}>
              <span className={`svc-dot ${s.enabled ? 'up' : 'down'}`} />
              <span className="svc-name">{s.id}</span>
              <span className="svc-type">{s.type}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Recent requests</div>
          {requests.length === 0 ? (
            <p className="text-muted text-sm">No requests yet</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>ID</th><th>Applicant</th><th>Mode</th><th>Status</th></tr></thead>
              <tbody>
                {requests.slice(0, 6).map(r => (
                  <tr key={r.request_id}>
                    <td className="mono">{r.request_id}</td>
                    <td>{applicantName(r)}</td>
                    <td><ModeBadge mode={r.orchestration_mode} /></td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
