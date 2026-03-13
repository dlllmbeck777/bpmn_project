import React, { useEffect, useState } from 'react'

import { get } from '../lib/api'

export default function Dashboard() {
  const [services, setServices] = useState([])
  const [requests, setRequests] = useState([])
  const [rules, setRules] = useState([])
  const [stops, setStops] = useState([])
  const [warning, setWarning] = useState('')

  useEffect(() => {
    get('/api/v1/services').then((data) => setServices(data.items || [])).catch(() => {})
    get('/api/v1/routing-rules').then((data) => setRules(data.items || [])).catch(() => {})
    get('/api/v1/stop-factors').then((data) => setStops(data.items || [])).catch(() => {})
    get('/api/v1/requests')
      .then((data) => setRequests(data.items || []))
      .catch((error) => setWarning(error.message))
  }, [])

  const healthy = services.filter((service) => service.enabled).length
  const pipelineSteps = ['Client', 'Gateway', 'Pre Check', 'Router', 'Orchestrator', 'Connectors', 'Parser', 'Post Check', 'SNP']

  return (
    <>
      {warning && <div className="notice mb-16">Requests are protected: {warning}</div>}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Services Registered</div><div className="stat-value blue">{services.length}</div></div>
        <div className="stat-card"><div className="stat-label">Enabled Services</div><div className="stat-value green">{healthy}</div></div>
        <div className="stat-card"><div className="stat-label">Routing Rules</div><div className="stat-value orange">{rules.length}</div></div>
        <div className="stat-card"><div className="stat-label">Stop Factors</div><div className="stat-value">{stops.length}</div></div>
      </div>

      <div className="card mb-16">
        <div className="card-title"><span className="dot dot-blue" /> Request Pipeline</div>
        <div className="pipeline">
          {pipelineSteps.map((step, index) => (
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
          <table className="tbl">
            <thead><tr><th>Service</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {services.slice(0, 8).map((service) => (
                <tr key={service.id}>
                  <td className="mono">{service.id}</td>
                  <td>{service.type}</td>
                  <td><span className={`badge ${service.enabled ? 'badge-green' : 'badge-red'}`}>{service.enabled ? 'ENABLED' : 'DISABLED'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title"><span className="dot dot-orange" /> Recent Requests</div>
          {requests.length === 0 ? (
            <p className="muted-copy">No request data loaded yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>ID</th><th>Mode</th><th>Status</th></tr></thead>
              <tbody>
                {requests.slice(0, 6).map((request) => (
                  <tr key={request.request_id}>
                    <td className="mono">{request.request_id}</td>
                    <td>{request.orchestration_mode}</td>
                    <td><span className={`badge ${request.status === 'COMPLETED' ? 'badge-green' : request.status === 'FAILED' ? 'badge-red' : 'badge-blue'}`}>{request.status}</span></td>
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

