import { useEffect, useState } from 'react'

import { get } from '../lib/api'

function formatChanges(value) {
  if (value == null) return '-'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export default function AuditPage() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  const load = () => get('/api/v1/audit-log').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}

      <div className="flex-between mb-16">
        <div className="card-title" style={{ margin: 0 }}>Audit Log</div>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <p className="muted-copy">No audit entries yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Time</th><th>Entity</th><th>ID</th><th>Action</th><th>Changes</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="mono table-small">{item.performed_at?.slice(0, 19)}</td>
                  <td>{item.entity_type}</td>
                  <td className="mono">{item.entity_id}</td>
                  <td><span className={`badge ${item.action === 'created' ? 'badge-green' : item.action === 'deleted' ? 'badge-red' : 'badge-blue'}`}>{item.action}</span></td>
                  <td className="mono table-ellipsis" title={formatChanges(item.changes)}>{formatChanges(item.changes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
