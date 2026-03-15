import { useEffect, useMemo, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const empty = {
  name: '',
  priority: 0,
  condition_field: '',
  condition_op: 'eq',
  condition_value: '',
  target_mode: 'flowable',
  enabled: true,
  meta: {},
}

const CUSTOM_PRESET = {
  name: 'Auto -> Custom default',
  priority: 0,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'custom',
  enabled: true,
  meta: {},
}

const CANARY_PRESET = {
  name: 'Auto -> Flowable canary 5%',
  priority: 4,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'flowable',
  enabled: true,
  meta: { sample_percent: 5, sticky_field: 'request_id' },
}

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

function withMeta(rule) {
  return { ...rule, meta: normalizeMeta(rule.meta) }
}

function getSamplePercent(rule) {
  const raw = normalizeMeta(rule.meta).sample_percent
  return raw === undefined || raw === null || raw === '' ? '' : String(raw)
}

export default function RoutingPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busyPreset, setBusyPreset] = useState('')

  const load = () =>
    get('/api/v1/routing-rules')
      .then((d) => setItems((d.items || []).map(withMeta)))
      .catch((e) => setError(e.message))

  useEffect(() => { load() }, [])

  const canaryRule = useMemo(
    () => items.find((rule) => (rule.name || '').toLowerCase() === CANARY_PRESET.name.toLowerCase()),
    [items],
  )

  const buildPayload = (rule) => {
    const meta = normalizeMeta(rule.meta)
    const samplePercent = meta.sample_percent
    if (samplePercent === '' || samplePercent === null || samplePercent === undefined) {
      delete meta.sample_percent
    } else {
      const normalized = Number(samplePercent)
      meta.sample_percent = Number.isFinite(normalized) ? Math.max(0, Math.min(100, normalized)) : samplePercent
    }
    if (!meta.sticky_field) delete meta.sticky_field
    return { ...rule, meta }
  }

  const save = async () => {
    try {
      const payload = buildPayload(editing)
      if (editing._id) await put(`/api/v1/routing-rules/${editing._id}`, payload)
      else await post('/api/v1/routing-rules', payload)
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this routing rule?')) return
    try {
      await del(`/api/v1/routing-rules/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const routeAllAutoToCustom = async () => {
    setBusyPreset('custom')
    setError('')
    try {
      const existingCustom = items.find((rule) => rule.name === CUSTOM_PRESET.name)
      const customPayload = buildPayload(existingCustom ? { ...existingCustom, ...CUSTOM_PRESET, enabled: true } : CUSTOM_PRESET)
      if (existingCustom) await put(`/api/v1/routing-rules/${existingCustom.id}`, customPayload)
      else await post('/api/v1/routing-rules', customPayload)

      if (canaryRule) {
        await put(`/api/v1/routing-rules/${canaryRule.id}`, buildPayload({ ...canaryRule, enabled: false }))
      }
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyPreset('')
    }
  }

  const enableCanary = async () => {
    setBusyPreset('canary')
    setError('')
    try {
      const existingCustom = items.find((rule) => rule.name === CUSTOM_PRESET.name)
      const customFallback = buildPayload(existingCustom
        ? { ...existingCustom, ...CUSTOM_PRESET, priority: 6, enabled: true }
        : { ...CUSTOM_PRESET, priority: 6 })
      if (existingCustom) await put(`/api/v1/routing-rules/${existingCustom.id}`, customFallback)
      else await post('/api/v1/routing-rules', customFallback)

      const existingCanary = items.find((rule) => rule.name === CANARY_PRESET.name)
      const canaryPayload = buildPayload(existingCanary
        ? { ...existingCanary, ...CANARY_PRESET, enabled: true }
        : CANARY_PRESET)
      if (existingCanary) await put(`/api/v1/routing-rules/${existingCanary.id}`, canaryPayload)
      else await post('/api/v1/routing-rules', canaryPayload)

      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyPreset('')
    }
  }

  const disableCanary = async () => {
    if (!canaryRule) return
    setBusyPreset('canary-off')
    setError('')
    try {
      await put(`/api/v1/routing-rules/${canaryRule.id}`, buildPayload({ ...canaryRule, enabled: false }))
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyPreset('')
    }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="card mb-16">
        <div className="card-title">Traffic presets</div>
        <div className="muted mb-12">These presets set up the two testing scenarios you described without editing raw JSON by hand.</div>
        <div className="form-actions">
          {canEdit && <button className="btn btn-primary btn-sm" disabled={busyPreset === 'custom'} onClick={routeAllAutoToCustom}>Route all auto traffic to custom</button>}
          {canEdit && <button className="btn btn-ghost btn-sm" disabled={busyPreset === 'canary'} onClick={enableCanary}>Enable 5% Flowable canary</button>}
          {canEdit && <button className="btn btn-ghost btn-sm" disabled={!canaryRule || busyPreset === 'canary-off'} onClick={disableCanary}>Disable canary rule</button>}
        </div>
      </div>

      <div className="flex-between mb-16">
        <div />
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty, meta: {} })}>+ Add rule</button>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Priority</th><th>Condition</th><th>Target</th><th>Traffic share</th><th>Enabled</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td className="mono">{r.priority}</td>
                <td className="mono text-sm">{r.condition_field} {r.condition_op} "{r.condition_value}"</td>
                <td><span className={`badge ${r.target_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{r.target_mode}</span></td>
                <td>
                  {getSamplePercent(r)
                    ? <span className="badge badge-amber">{getSamplePercent(r)}%</span>
                    : <span className="badge badge-gray">100%</span>}
                </td>
                <td><span className={`badge ${r.enabled ? 'badge-green' : 'badge-red'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...withMeta(r), _id: r.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(r.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit rule' : 'Add rule'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Priority</label><input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: +e.target.value })} /></div>
            <div className="form-row"><label>Target mode</label>
              <select value={editing.target_mode} onChange={(e) => setEditing({ ...editing, target_mode: e.target.value })}>
                <option value="flowable">flowable</option><option value="custom">custom</option>
              </select>
            </div>
          </div>
          <div className="form-inline">
            <div className="form-row"><label>Condition field</label><input value={editing.condition_field} onChange={(e) => setEditing({ ...editing, condition_field: e.target.value })} placeholder="orchestration_mode" /></div>
            <div className="form-row"><label>Operator</label>
              <select value={editing.condition_op} onChange={(e) => setEditing({ ...editing, condition_op: e.target.value })}>
                <option value="eq">eq</option><option value="neq">neq</option><option value="contains">contains</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>Condition value</label><input value={editing.condition_value} onChange={(e) => setEditing({ ...editing, condition_value: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Traffic share %</label><input type="number" min="0" max="100" value={getSamplePercent(editing)} onChange={(e) => setEditing({ ...editing, meta: { ...normalizeMeta(editing.meta), sample_percent: e.target.value } })} placeholder="100" /></div>
            <div className="form-row"><label>Sticky field</label><input value={normalizeMeta(editing.meta).sticky_field || ''} onChange={(e) => setEditing({ ...editing, meta: { ...normalizeMeta(editing.meta), sticky_field: e.target.value } })} placeholder="request_id" /></div>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
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
