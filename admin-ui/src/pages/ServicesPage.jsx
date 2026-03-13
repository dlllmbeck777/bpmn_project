import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { del, get, post, put } from '../lib/api'

export default function ServicesPage({ canEdit = true }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState('')

  const load = () => get('/api/v1/services').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  const openNew = () => {
    if (!canEdit) return
    setForm({ id: '', name: '', type: 'connector', base_url: '', health_path: '/health', endpoint_path: '/api/process', enabled: true, timeout_ms: 10000, retry_count: 2 })
    setEditing('new')
  }

  const openEdit = (service) => {
    if (!canEdit) return
    setForm({ ...service, enabled: !!service.enabled })
    setEditing(service.id)
  }

  const save = async () => {
    if (!canEdit) return
    try {
      const data = { ...form, meta: form.meta || {} }
      if (editing === 'new') await post('/api/v1/services', data)
      else await put(`/api/v1/services/${editing}`, data)
      setEditing(null)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (id) => {
    if (!canEdit) return
    if (!confirm(`Delete service ${id}?`)) return
    try {
      await del(`/api/v1/services/${id}`)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      {!canEdit && <div className="notice mb-16">Senior analysts have read-only access to the service registry. Only admins can change service definitions.</div>}

      <div className="flex-between mb-16">
        <div className="card-title" style={{ margin: 0 }}>Service Registry</div>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>Add Service</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Base URL</th><th>Endpoint</th><th>Timeout</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>
            {items.map((service) => (
              <tr key={service.id}>
                <td className="mono">{service.id}</td>
                <td>{service.name}</td>
                <td><span className="badge badge-gray">{service.type}</span></td>
                <td className="mono table-small">{service.base_url}</td>
                <td className="mono table-small">{service.endpoint_path}</td>
                <td className="mono">{service.timeout_ms}ms</td>
                <td><span className={`badge ${service.enabled ? 'badge-green' : 'badge-red'}`}>{service.enabled ? 'ON' : 'OFF'}</span></td>
                {canEdit && (
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(service)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(service.id)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editing && (
        <Modal title={editing === 'new' ? 'Add Service' : `Edit ${editing}`} onClose={() => setEditing(null)}>
          <div className="form-inline">
            <div className="form-row"><label>ID</label><input value={form.id || ''} onChange={(event) => setForm({ ...form, id: event.target.value })} disabled={editing !== 'new'} /></div>
            <div className="form-row"><label>Name</label><input value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          </div>
          <div className="form-inline">
            <div className="form-row">
              <label>Type</label>
              <select value={form.type || 'connector'} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                <option value="connector">connector</option>
                <option value="orchestrator">orchestrator</option>
                <option value="gateway">gateway</option>
                <option value="engine">engine</option>
                <option value="processor">processor</option>
                <option value="external">external</option>
              </select>
            </div>
            <div className="form-row"><label>Health Path</label><input value={form.health_path || ''} onChange={(event) => setForm({ ...form, health_path: event.target.value })} /></div>
          </div>
          <div className="form-row"><label>Base URL</label><input value={form.base_url || ''} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="http://host:port" /></div>
          <div className="form-row"><label>Endpoint Path</label><input value={form.endpoint_path || ''} onChange={(event) => setForm({ ...form, endpoint_path: event.target.value })} placeholder="/api/pull" /></div>
          <div className="form-inline">
            <div className="form-row"><label>Timeout (ms)</label><input type="number" value={form.timeout_ms || 10000} onChange={(event) => setForm({ ...form, timeout_ms: Number(event.target.value) })} /></div>
            <div className="form-row"><label>Retries</label><input type="number" value={form.retry_count || 2} onChange={(event) => setForm({ ...form, retry_count: Number(event.target.value) })} /></div>
          </div>
          <div className="form-row">
            <label className="checkbox-row">
              <input type="checkbox" checked={!!form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              Enabled
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </>
  )
}
