import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { del, get, post, put } from '../lib/api'

export default function StopFactorsPage({ canEdit = true }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState('')

  const load = () => get('/api/v1/stop-factors').then((data) => setItems(data.items || [])).catch((err) => setError(err.message))

  useEffect(() => { load() }, [])

  const openNew = () => {
    if (!canEdit) return
    setForm({ name: '', stage: 'pre', check_type: 'field_check', field_path: '', operator: 'gte', threshold: '', action_on_fail: 'REJECT', enabled: true, priority: 0 })
    setEditing('new')
  }

  const openEdit = (item) => {
    if (!canEdit) return
    setForm({ ...item, enabled: !!item.enabled })
    setEditing(item.id)
  }

  const save = async () => {
    if (!canEdit) return
    try {
      const data = { ...form, meta: form.meta || {} }
      if (editing === 'new') await post('/api/v1/stop-factors', data)
      else await put(`/api/v1/stop-factors/${editing}`, data)
      setEditing(null)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (id) => {
    if (!canEdit) return
    if (!confirm('Delete stop factor?')) return
    try {
      await del(`/api/v1/stop-factors/${id}`)
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
        <div className="card-title" style={{ margin: 0 }}>Stop Factors</div>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>Add Stop Factor</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Priority</th><th>Name</th><th>Stage</th><th>Condition</th><th>On Fail</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.priority}</td>
                <td>{item.name}</td>
                <td><span className={`badge ${item.stage === 'pre' ? 'badge-orange' : 'badge-blue'}`}>{item.stage.toUpperCase()}</span></td>
                <td className="mono table-small">{item.field_path} {item.operator} {item.threshold}</td>
                <td><span className={`badge ${item.action_on_fail === 'REJECT' ? 'badge-red' : 'badge-orange'}`}>{item.action_on_fail}</span></td>
                <td><span className={`badge ${item.enabled ? 'badge-green' : 'badge-red'}`}>{item.enabled ? 'ON' : 'OFF'}</span></td>
                {canEdit && (
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editing && (
        <Modal title={editing === 'new' ? 'Add Stop Factor' : 'Edit Stop Factor'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row">
              <label>Stage</label>
              <select value={form.stage || 'pre'} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
                <option value="pre">PRE</option>
                <option value="post">POST</option>
              </select>
            </div>
            <div className="form-row"><label>Priority</label><input type="number" value={form.priority ?? 0} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></div>
          </div>
          <div className="form-inline">
            <div className="form-row">
              <label>Check Type</label>
              <select value={form.check_type || 'field_check'} onChange={(event) => setForm({ ...form, check_type: event.target.value })}>
                <option value="field_check">field_check</option>
                <option value="blacklist">blacklist</option>
                <option value="range">range</option>
              </select>
            </div>
            <div className="form-row"><label>Field Path</label><input value={form.field_path || ''} onChange={(event) => setForm({ ...form, field_path: event.target.value })} placeholder="result.parsed_report.summary.credit_score" /></div>
          </div>
          <div className="form-inline">
            <div className="form-row">
              <label>Operator</label>
              <select value={form.operator || 'gte'} onChange={(event) => setForm({ ...form, operator: event.target.value })}>
                <option value="gte">gte</option>
                <option value="lte">lte</option>
                <option value="gt">gt</option>
                <option value="lt">lt</option>
                <option value="eq">eq</option>
                <option value="neq">neq</option>
                <option value="not_in">not_in</option>
              </select>
            </div>
            <div className="form-row"><label>Threshold</label><input value={form.threshold || ''} onChange={(event) => setForm({ ...form, threshold: event.target.value })} /></div>
          </div>
          <div className="form-row">
            <label>Action on Fail</label>
            <select value={form.action_on_fail || 'REJECT'} onChange={(event) => setForm({ ...form, action_on_fail: event.target.value })}>
              <option value="REJECT">REJECT</option>
              <option value="REVIEW">REVIEW</option>
              <option value="LOG">LOG</option>
            </select>
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
