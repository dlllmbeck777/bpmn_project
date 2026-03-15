import React, { useEffect, useMemo, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import { IconChevron } from '../components/Icons'
import Modal from '../components/Modal'

const empty = { pipeline_name: 'default', step_order: 1, service_id: '', enabled: true, meta: {} }
const CUSTOM_REPORT_CHAIN = ['isoftpull', 'creditsafe', 'plaid']

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

function shouldSkip(step, mode) {
  return !!normalizeMeta(step.meta)[`skip_in_${mode}`]
}

export default function PipelinePage({ canEdit }) {
  const [items, setItems] = useState([])
  const [services, setServices] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busyPreset, setBusyPreset] = useState(false)

  const load = () => {
    get('/api/v1/pipeline-steps?pipeline_name=default').then((d) => setItems((d.items || []).map((item) => ({ ...item, meta: normalizeMeta(item.meta) })))).catch((e) => setError(e.message))
    get('/api/v1/services?type=connector').then((d) => setServices(d.items || [])).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const activeCustomChain = useMemo(
    () => items.filter((step) => step.enabled && !shouldSkip(step, 'custom')),
    [items],
  )

  const save = async () => {
    try {
      const payload = { ...editing, meta: normalizeMeta(editing.meta) }
      if (editing._id) await put(`/api/v1/pipeline-steps/${editing._id}`, payload)
      else await post('/api/v1/pipeline-steps', payload)
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this pipeline step?')) return
    try {
      await del(`/api/v1/pipeline-steps/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const updateStepMeta = async (step, metaPatch, { reload = true } = {}) => {
    setError('')
    try {
      await put(`/api/v1/pipeline-steps/${step.id}`, {
        pipeline_name: step.pipeline_name,
        step_order: step.step_order,
        service_id: step.service_id,
        enabled: step.enabled,
        meta: { ...normalizeMeta(step.meta), ...metaPatch },
      })
      if (reload) load()
    } catch (e) {
      setError(e.message)
      throw e
    }
  }

  const applyCustomReportsPreset = async () => {
    setBusyPreset(true)
    setError('')
    try {
      for (const step of items) {
        await updateStepMeta(step, {
          skip_in_custom: !CUSTOM_REPORT_CHAIN.includes(step.service_id),
        }, { reload: false })
      }
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyPreset(false)
    }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="card mb-20">
        <div className="card-title">Custom mode execution chain</div>
        <div className="muted mb-12">The chain below shows what will run in custom mode after applying skip rules for each step.</div>
        <div className="pipeline">
          {activeCustomChain.map((step, i) => (
            <React.Fragment key={step.id}>
              {i > 0 && <span className="pipe-arrow"><IconChevron /></span>}
              <div className="pipe-step active">{step.step_order}. {step.service_id}</div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">Scenario preset</div>
        <div className="muted mb-12">This prepares custom mode to call only `isoftpull`, `creditsafe`, and `plaid`, while skipping the rest for custom traffic.</div>
        {canEdit && <button className="btn btn-ghost btn-sm" disabled={busyPreset} onClick={applyCustomReportsPreset}>Prepare custom reports chain</button>}
      </div>

      <div className="flex-between mb-16">
        <div />
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty, step_order: items.length + 1 })}>+ Add step</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Order</th><th>Service</th><th>Service name</th><th>Enabled</th><th>Custom mode</th><th>Flowable mode</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{s.step_order}</td>
                <td className="mono">{s.service_id}</td>
                <td>{s.service_name || s.service_id}</td>
                <td><span className={`badge ${s.enabled ? 'badge-green' : 'badge-red'}`}>{s.enabled ? 'enabled' : 'disabled'}</span></td>
                <td>
                  <span className={`badge ${shouldSkip(s, 'custom') ? 'badge-red' : 'badge-green'}`}>{shouldSkip(s, 'custom') ? 'skip' : 'run'}</span>
                </td>
                <td>
                  <span className={`badge ${shouldSkip(s, 'flowable') ? 'badge-red' : 'badge-green'}`}>{shouldSkip(s, 'flowable') ? 'skip' : 'run'}</span>
                </td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => updateStepMeta(s, { skip_in_custom: !shouldSkip(s, 'custom') })}>{shouldSkip(s, 'custom') ? 'Run in custom' : 'Skip in custom'}</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => updateStepMeta(s, { skip_in_flowable: !shouldSkip(s, 'flowable') })}>{shouldSkip(s, 'flowable') ? 'Run in flowable' : 'Skip in flowable'}</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...s, meta: normalizeMeta(s.meta), _id: s.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(s.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit step' : 'Add step'} onClose={() => setEditing(null)}>
          <div className="form-inline">
            <div className="form-row"><label>Step order</label><input type="number" value={editing.step_order} onChange={(e) => setEditing({ ...editing, step_order: +e.target.value })} /></div>
            <div className="form-row"><label>Service ID</label>
              <select value={editing.service_id} onChange={(e) => setEditing({ ...editing, service_id: e.target.value })}>
                <option value="">Select...</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.name})</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={shouldSkip(editing, 'custom')} onChange={(e) => setEditing({ ...editing, meta: { ...normalizeMeta(editing.meta), skip_in_custom: e.target.checked } })} style={{ width: 'auto' }} /> Skip in custom mode
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={shouldSkip(editing, 'flowable')} onChange={(e) => setEditing({ ...editing, meta: { ...normalizeMeta(editing.meta), skip_in_flowable: e.target.checked } })} style={{ width: 'auto' }} /> Skip in flowable mode
            </label>
          </div>
          <div className="form-actions"><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
        </Modal>
      )}
    </>
  )
}
