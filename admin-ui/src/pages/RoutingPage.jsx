import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { del, get, post, put } from '../lib/api'

export default function RoutingPage({ canEdit = true }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState('')

  const load = () => get('/api/v1/routing-rules').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  const openNew = () => {
    if (!canEdit) return
    setForm({ name: '', priority: 0, condition_field: 'product_type', condition_op: 'eq', condition_value: '', target_mode: 'flowable', enabled: true })
    setEditing('new')
  }

  const openEdit = (rule) => {
    if (!canEdit) return
    setForm({ ...rule, enabled: !!rule.enabled })
    setEditing(rule.id)
  }

  const save = async () => {
    if (!canEdit) return
    try {
      const data = { ...form, meta: form.meta || {} }
      if (editing === 'new') await post('/api/v1/routing-rules', data)
      else await put(`/api/v1/routing-rules/${editing}`, data)
      setEditing(null)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (id) => {
    if (!canEdit) return
    if (!confirm('Delete rule?')) return
    try {
      await del(`/api/v1/routing-rules/${id}`)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      {!canEdit && <div className="notice mb-16">This page is read-only for the selected role.</div>}

      <div className="flex-between mb-16">
        <div className="card-title" style={{ margin: 0 }}>Routing Rules</div>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>Add Rule</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Priority</th><th>Name</th><th>Condition</th><th>Target</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>
            {items.map((rule) => (
              <tr key={rule.id}>
                <td className="mono">{rule.priority}</td>
                <td>{rule.name}</td>
                <td className="mono table-small">{rule.condition_field} {rule.condition_op} "{rule.condition_value}"</td>
                <td><span className={`badge ${rule.target_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{rule.target_mode}</span></td>
                <td><span className={`badge ${rule.enabled ? 'badge-green' : 'badge-red'}`}>{rule.enabled ? 'ON' : 'OFF'}</span></td>
                {canEdit && (
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(rule)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(rule.id)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editing && (
        <Modal title={editing === 'new' ? 'Add Routing Rule' : 'Edit Routing Rule'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Priority</label><input type="number" value={form.priority ?? 0} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></div>
            <div className="form-row">
              <label>Target Mode</label>
              <select value={form.target_mode || 'flowable'} onChange={(event) => setForm({ ...form, target_mode: event.target.value })}>
                <option value="flowable">flowable</option>
                <option value="custom">custom</option>
              </select>
            </div>
          </div>
          <div className="form-inline">
            <div className="form-row"><label>Field</label><input value={form.condition_field || ''} onChange={(event) => setForm({ ...form, condition_field: event.target.value })} /></div>
            <div className="form-row">
              <label>Operator</label>
              <select value={form.condition_op || 'eq'} onChange={(event) => setForm({ ...form, condition_op: event.target.value })}>
                <option value="eq">equals</option>
                <option value="neq">not equals</option>
                <option value="contains">contains</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>Value</label><input value={form.condition_value || ''} onChange={(event) => setForm({ ...form, condition_value: event.target.value })} /></div>
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
