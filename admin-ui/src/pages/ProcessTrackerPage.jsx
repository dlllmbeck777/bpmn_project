import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { get } from '../lib/api'

function payloadPreview(payload) {
  try {
    const text = JSON.stringify(payload)
    return text.length > 120 ? `${text.slice(0, 120)}...` : text
  } catch {
    return String(payload)
  }
}

export default function ProcessTrackerPage() {
  const [items, setItems] = useState([])
  const [requestId, setRequestId] = useState('')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  const load = async (filter = requestId) => {
    try {
      const query = filter ? `?request_id=${encodeURIComponent(filter)}` : ''
      const data = await get(`/api/v1/process-tracker${query}`)
      setItems(data.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load('') }, [])

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      <div className="card mb-16">
        <div className="tracker-toolbar">
          <div className="form-row tracker-filter">
            <label>Request ID Filter</label>
            <input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="REQ-2026-0001" />
          </div>
          <div className="form-actions tracker-actions">
            <button className="btn btn-ghost" onClick={() => { setRequestId(''); load('') }}>Reset</button>
            <button className="btn btn-primary" onClick={() => load()}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <p className="muted-copy">No tracker events yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Request</th><th>Stage</th><th>Service</th><th>Direction</th><th>Status</th><th>Title</th><th>Payload</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="mono table-small">{item.created_at?.slice(0, 19)}</td>
                    <td className="mono">{item.request_id}</td>
                    <td>{item.stage}</td>
                    <td className="mono">{item.service_id || '-'}</td>
                    <td><span className={`badge ${item.direction === 'OUT' ? 'badge-blue' : item.direction === 'IN' ? 'badge-green' : 'badge-orange'}`}>{item.direction}</span></td>
                    <td><span className="badge badge-gray">{item.status || '-'}</span></td>
                    <td>{item.title}</td>
                    <td>
                      <div className="tracker-payload-cell">
                        <span className="mono table-ellipsis" title={payloadPreview(item.payload)}>{payloadPreview(item.payload)}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(item)}>View</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Modal title={`${selected.request_id} · ${selected.title}`} onClose={() => setSelected(null)}>
          <pre className="json-view">{JSON.stringify(selected, null, 2)}</pre>
        </Modal>
      )}
    </>
  )
}
