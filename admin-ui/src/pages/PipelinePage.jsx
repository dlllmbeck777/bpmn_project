import React, { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { del, get, post, put } from '../lib/api'

export default function PipelinePage({ canEdit = true }) {
  const [steps, setSteps] = useState([])
  const [services, setServices] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState('')

  const load = () => {
    get('/api/v1/pipeline-steps').then((data) => setSteps(data.items || [])).catch((err) => setError(err.message))
    get('/api/v1/services').then((data) => setServices(data.items || [])).catch((err) => setError(err.message))
  }

  useEffect(() => { load() }, [])

  const connectors = services.filter((service) => service.type === 'connector')

  const openNew = () => {
    if (!canEdit) return
    setForm({ pipeline_name: 'default', step_order: (steps.length + 1) * 10, service_id: connectors[0]?.id || '', enabled: true })
    setEditing('new')
  }

  const openEdit = (step) => {
    if (!canEdit) return
    setForm({ ...step, enabled: !!step.enabled })
    setEditing(step.id)
  }

  const save = async () => {
    if (!canEdit) return
    try {
      const data = { ...form, meta: form.meta || {} }
      if (editing === 'new') await post('/api/v1/pipeline-steps', data)
      else await put(`/api/v1/pipeline-steps/${editing}`, data)
      setEditing(null)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (id) => {
    if (!canEdit) return
    if (!confirm('Delete pipeline step?')) return
    try {
      await del(`/api/v1/pipeline-steps/${id}`)
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
        <div className="card-title" style={{ margin: 0 }}>Pipeline Steps</div>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>Add Step</button>}
      </div>

      <div className="card mb-16">
        <div className="card-title"><span className="dot dot-purple" /> Active Pipeline</div>
        <div className="pipeline">
          {steps.filter((step) => step.enabled).sort((left, right) => left.step_order - right.step_order).map((step, index) => (
            <React.Fragment key={step.id}>
              {index > 0 && <span className="pipe-arrow">→</span>}
              <div className="pipe-step active">{step.service_name || step.service_id}</div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Order</th><th>Service</th><th>URL</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>
            {steps.sort((left, right) => left.step_order - right.step_order).map((step) => (
              <tr key={step.id}>
                <td className="mono">{step.step_order}</td>
                <td>{step.service_name || step.service_id}</td>
                <td className="mono table-small">{step.base_url || '-'}</td>
                <td><span className={`badge ${step.enabled ? 'badge-green' : 'badge-red'}`}>{step.enabled ? 'ON' : 'OFF'}</span></td>
                {canEdit && (
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(step)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(step.id)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editing && (
        <Modal title={editing === 'new' ? 'Add Pipeline Step' : 'Edit Pipeline Step'} onClose={() => setEditing(null)}>
          <div className="form-inline">
            <div className="form-row"><label>Step Order</label><input type="number" value={form.step_order ?? 0} onChange={(event) => setForm({ ...form, step_order: Number(event.target.value) })} /></div>
            <div className="form-row">
              <label>Service</label>
              <select value={form.service_id || ''} onChange={(event) => setForm({ ...form, service_id: event.target.value })}>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.id})</option>)}
              </select>
            </div>
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
