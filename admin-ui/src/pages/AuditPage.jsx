import { useEffect, useState } from 'react'
import { get } from '../lib/api'

export default function AuditPage() {
  const [items, setItems] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/api/v1/audit-log').then(d => setItems(d.items || [])).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const entityColors = { service: 'badge-blue', routing_rule: 'badge-purple', stop_factor: 'badge-amber', pipeline_step: 'badge-teal', admin_user: 'badge-red', flowable_instance: 'badge-green', flowable_request: 'badge-green' }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      <div className="flex-between mb-16">
        <div />
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Time</th><th>Entity</th><th>Entity ID</th><th>Action</th><th>Changes</th></tr></thead>
          <tbody>
            {items.map(a => (
              <tr key={a.id}>
                <td className="mono text-sm" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{(a.performed_at || '').slice(0, 19).replace('T', ' ')}</td>
                <td><span className={`badge ${entityColors[a.entity_type] || 'badge-gray'}`}>{a.entity_type}</span></td>
                <td className="mono">{a.entity_id}</td>
                <td style={{ fontWeight: 500 }}>{a.action}</td>
                <td>
                  {a.changes && Object.keys(a.changes).length > 0 ? (
                    <button className="btn btn-ghost btn-xs" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                      {expanded === a.id ? 'Hide' : 'Show'} ({Object.keys(a.changes).length} fields)
                    </button>
                  ) : <span className="text-muted text-sm">—</span>}
                  {expanded === a.id && (
                    <pre className="json-view mt-12" style={{ maxHeight: 150 }}>{JSON.stringify(a.changes, null, 2)}</pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
