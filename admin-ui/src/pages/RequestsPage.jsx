import { useEffect, useState } from 'react'
import { get } from '../lib/api'

function StatusBadge({ status }) {
  const m = { COMPLETED: 'badge-green', REJECTED: 'badge-red', FAILED: 'badge-red', REVIEW: 'badge-amber', RUNNING: 'badge-blue', SUBMITTED: 'badge-blue' }
  return <span className={`badge ${m[status] || 'badge-gray'}`}>{(status || '').toLowerCase()}</span>
}

function ModeBadge({ mode }) {
  return <span className={`badge ${mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{mode}</span>
}

function dotColor(status) {
  if (['COMPLETED', 'PASS', 'OK'].includes(status)) return 'green'
  if (['REJECTED', 'FAILED', 'REJECT', 'UNAVAILABLE'].includes(status)) return 'red'
  if (['REVIEW', 'SKIPPED'].includes(status)) return 'amber'
  return ''
}

function toUtcIso(value) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

export default function RequestsPage() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [detail, setDetail] = useState(null)
  const [tracker, setTracker] = useState([])
  const [error, setError] = useState('')

  const load = (overrides = {}) => {
    const nextFilter = overrides.filter !== undefined ? overrides.filter : filter
    const nextFrom = overrides.createdFrom !== undefined ? overrides.createdFrom : createdFrom
    const nextTo = overrides.createdTo !== undefined ? overrides.createdTo : createdTo
    const params = new URLSearchParams()
    if (nextFilter) params.set('status', nextFilter)
    if (nextFrom) params.set('created_from', toUtcIso(nextFrom))
    if (nextTo) params.set('created_to', toUtcIso(nextTo))
    const query = params.toString()
    return get(`/api/v1/requests${query ? `?${query}` : ''}`).then(d => setItems(d.items || [])).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [filter])

  const openDetail = async (rid) => {
    try {
      const [d, t] = await Promise.all([get(`/api/v1/requests/${rid}`), get(`/api/v1/requests/${rid}/tracker`)])
      setDetail(d)
      setTracker((t.items || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="flex-between mb-16">
        <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {['', 'COMPLETED', 'RUNNING', 'REVIEW', 'REJECTED', 'FAILED'].map(f => (
            <button key={f} className={`tab-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f || 'All'}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
      </div>

      <div className="card mb-16">
        <div className="card-title">Date and time filters</div>
        <div className="form-inline">
          <div className="form-row">
            <label>From</label>
            <input type="datetime-local" value={createdFrom} onChange={e => setCreatedFrom(e.target.value)} />
          </div>
          <div className="form-row">
            <label>To</label>
            <input type="datetime-local" value={createdTo} onChange={e => setCreatedTo(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={() => load()}>Apply</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setCreatedFrom(''); setCreatedTo(''); load({ createdFrom: '', createdTo: '' }) }}>Clear</button>
        </div>
      </div>

      <div className="card mb-20">
        <table className="tbl">
          <thead><tr><th>Request ID</th><th>Customer</th><th>Product</th><th>Mode</th><th>Status</th><th>Time</th><th></th></tr></thead>
          <tbody>
            {items.map(r => (
              <tr key={r.request_id} data-clickable onClick={() => openDetail(r.request_id)} style={{ cursor: 'pointer' }}>
                <td className="mono" style={{ fontWeight: 600 }}>{r.request_id}</td>
                <td className="mono">{r.customer_id}</td>
                <td>{r.product_type}</td>
                <td><ModeBadge mode={r.orchestration_mode} /></td>
                <td><StatusBadge status={r.status} /></td>
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
        <div className="card">
          <div className="flex-between mb-16">
            <div className="card-title" style={{ margin: 0 }}>{detail.request_id} - Timeline</div>
            <div className="flex-center gap-8">
              <StatusBadge status={detail.status} />
              <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>

          <div className="detail-panel mb-16">
            <div className="kv-row"><span className="kv-key">Customer</span><span className="kv-val">{detail.customer_id}</span></div>
            <div className="kv-row"><span className="kv-key">Product</span><span className="kv-val">{detail.product_type}</span></div>
            <div className="kv-row"><span className="kv-key">Mode</span><span className="kv-val">{detail.orchestration_mode}</span></div>
            <div className="kv-row"><span className="kv-key">IIN</span><span className="kv-val">{detail.iin_masked || '***'}</span></div>
            <div className="kv-row"><span className="kv-key">Correlation</span><span className="kv-val">{detail.correlation_id}</span></div>
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
