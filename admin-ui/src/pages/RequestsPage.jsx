import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { get } from '../lib/api'

export default function RequestsPage() {
  const [items, setItems] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/api/v1/requests').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  const openDetail = async (requestId) => {
    try {
      const data = await get(`/api/v1/requests/${requestId}`)
      setDetail(data)
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
          <pre className="json-view">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  )
}

