import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const empty = { name: '', priority: 0, condition_field: '', condition_op: 'eq', condition_value: '', target_mode: 'flowable', enabled: true, meta: {} }

export default function RoutingPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/api/v1/routing-rules').then(d => setItems(d.items || [])).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async () => {
    try {
      if (editing._id) await put(`/api/v1/routing-rules/${editing._id}`, editing)
      else await post('/api/v1/routing-rules', editing)
      setEditing(null); load()
    } catch (e) { setError(e.message) }
  }

  const remove = async (id) => {
    if (!confirm('Delete this routing rule?')) return
    try { await del(`/api/v1/routing-rules/${id}`); load() } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      <div className="flex-between mb-16">
        <div />
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty })}>+ Add rule</button>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Priority</th><th>Condition</th><th>Target</th><th>Enabled</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td className="mono">{r.priority}</td>
                <td className="mono text-sm">{r.condition_field} {r.condition_op} "{r.condition_value}"</td>
                <td><span className={`badge ${r.target_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{r.target_mode}</span></td>
                <td><span className={`badge ${r.enabled ? 'badge-green' : 'badge-red'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...r, _id: r.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(r.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit rule' : 'Add rule'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Priority</label><input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: +e.target.value })} /></div>
            <div className="form-row"><label>Target mode</label>
              <select value={editing.target_mode} onChange={e => setEditing({ ...editing, target_mode: e.target.value })}>
                <option value="flowable">flowable</option><option value="custom">custom</option>
              </select>
            </div>
          </div>
          <div className="form-inline">
            <div className="form-row"><label>Condition field</label><input value={editing.condition_field} onChange={e => setEditing({ ...editing, condition_field: e.target.value })} placeholder="product_type" /></div>
            <div className="form-row"><label>Operator</label>
              <select value={editing.condition_op} onChange={e => setEditing({ ...editing, condition_op: e.target.value })}>
                <option value="eq">eq</option><option value="neq">neq</option><option value="contains">contains</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>Condition value</label><input value={editing.condition_value} onChange={e => setEditing({ ...editing, condition_value: e.target.value })} /></div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
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
