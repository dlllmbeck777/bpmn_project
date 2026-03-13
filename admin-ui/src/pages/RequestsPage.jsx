import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { get } from '../lib/api'

function previewPayload(payload) {
  try {
    const text = JSON.stringify(payload)
    return text.length > 100 ? `${text.slice(0, 100)}...` : text
  } catch {
    return String(payload)
  }
}

export default function RequestsPage() {
  const [items, setItems] = useState([])
  const [detail, setDetail] = useState(null)
  const [tracker, setTracker] = useState([])
  const [error, setError] = useState('')

  const load = () => get('/api/v1/requests').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  const openDetail = async (requestId) => {
    try {
      const [detailData, trackerData] = await Promise.all([
        get(`/api/v1/requests/${requestId}`),
        get(`/api/v1/requests/${requestId}/tracker`),
      ])
      setDetail(detailData)
      setTracker(trackerData.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}

      <div className="flex-between mb-16">
        <div className="card-title" style={{ margin: 0 }}>Requests</div>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <p className="muted-copy">No requests found. Submit requests to the gateway on port 8000.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Request ID</th><th>Customer</th><th>Product</th><th>Mode</th><th>Status</th><th>Time</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.request_id}>
                  <td className="mono">{item.request_id}</td>
                  <td className="mono">{item.customer_id}</td>
                  <td>{item.product_type}</td>
                  <td><span className={`badge ${item.orchestration_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{item.orchestration_mode}</span></td>
                  <td><span className={`badge ${item.status === 'COMPLETED' ? 'badge-green' : item.status === 'REJECTED' ? 'badge-orange' : item.status === 'FAILED' ? 'badge-red' : 'badge-blue'}`}>{item.status}</span></td>
                  <td className="mono table-small">{item.created_at?.slice(11, 19)}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => openDetail(item.request_id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <Modal title={`Request ${detail.request_id}`} onClose={() => setDetail(null)}>
          <div className="tracker-grid">
            <div className="card">
              <div className="card-title"><span className="dot dot-blue" /> Request Detail</div>
              <pre className="json-view">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </div>
            <div className="card">
              <div className="card-title"><span className="dot dot-orange" /> Process Tracker</div>
              {tracker.length === 0 ? (
                <p className="muted-copy">No tracker events recorded for this request yet.</p>
              ) : (
                <div className="tracker-list">
                  {tracker.map((item) => (
                    <details key={item.id} className="tracker-item">
                      <summary className="tracker-summary">
                        <span className="mono">{item.created_at?.slice(11, 19)}</span>
                        <span className={`badge ${item.direction === 'OUT' ? 'badge-blue' : item.direction === 'IN' ? 'badge-green' : 'badge-orange'}`}>{item.direction}</span>
                        <span>{item.title}</span>
                        <span className="tracker-meta">{item.service_id || item.stage}</span>
                      </summary>
                      <div className="tracker-item-body">
                        <div className="tracker-meta-line">Status: {item.status || '-'}</div>
                        <div className="tracker-meta-line">Preview: {previewPayload(item.payload)}</div>
                        <pre className="json-view mt-16">{JSON.stringify(item.payload, null, 2)}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
