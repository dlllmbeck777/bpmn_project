import { useEffect, useMemo, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const empty = { name: '', stage: 'pre', check_type: 'field_check', field_path: '', operator: 'gte', threshold: '', action_on_fail: 'REJECT', enabled: true, priority: 0, meta: {} }

function stageLabel(stage) {
  if (stage === 'pre') return 'Pre-check'
  if (stage === 'post') return 'Post-check'
  if (stage === 'decision') return 'Decision rules'
  return stage || 'Unknown'
}

function stageBadge(stage) {
  if (stage === 'pre') return 'badge-blue'
  if (stage === 'decision') return 'badge-purple'
  return 'badge-amber'
}

export default function StopFactorsPage({
  canEdit,
  forcedStage = '',
  title = 'Stop-factor behavior',
  intro,
  showStageTabs = true,
  stageOptions = ['', 'pre', 'decision', 'post'],
  addLabel = '+ Add factor',
  fieldPathPlaceholder = 'result.parsed_report.summary.credit_score',
}) {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState(() => forcedStage || '')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const activeStage = forcedStage || filter

  const load = () => {
    const q = activeStage ? `?stage=${activeStage}` : ''
    get(`/api/v1/stop-factors${q}`).then((d) => setItems(d.items || [])).catch((e) => setError(e.message))
  }
  useEffect(() => { load() }, [activeStage])
  useEffect(() => {
    if (forcedStage) setFilter(forcedStage)
  }, [forcedStage])

  const allLoadedEnabled = useMemo(() => items.length > 0 && items.every((item) => item.enabled), [items])
  const enabledCount = useMemo(() => items.filter((item) => item.enabled).length, [items])

  const save = async () => {
    try {
      if (editing._id) await put(`/api/v1/stop-factors/${editing._id}`, editing)
      else await post('/api/v1/stop-factors', editing)
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this stop factor?')) return
    try {
      await del(`/api/v1/stop-factors/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const applyBulkState = async (enabled) => {
    if (!items.length) return
    const label = enabled ? 'enable' : 'disable'
    if (!confirm(`Do you want to ${label} all currently visible stop factors?`)) return
    setBulkBusy(true)
    setError('')
    try {
      for (const item of items) {
        await put(`/api/v1/stop-factors/${item.id}`, { ...item, enabled })
      }
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      <div className="card mb-16">
        <div className="card-title">{title}</div>
        <div className="grid-2">
          <div className="sum-card">
            <div className="sum-label">{forcedStage === 'decision' ? 'Active decision rules' : 'Active rules'}</div>
            <div className="sum-val">{enabledCount}</div>
          </div>
          <div className="notice">
            {intro || (
              enabledCount > 0
                ? `Active ${forcedStage === 'decision' ? 'Flowable decision rules' : 'stop-factor rules'} will be checked in the selected stage.`
                : forcedStage === 'decision'
                  ? 'No active Flowable decision rule is configured. Requests will complete unless baseline report availability forces review.'
                  : 'No active stop-factor rule is configured. By default, requests pass without stop-factor blocking.'
            )}
          </div>
        </div>
      </div>
      <div className="flex-between mb-16">
        {showStageTabs ? (
          <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {stageOptions.map((f) => (
              <button key={f} className={`tab-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                {f === '' ? 'All rules' : stageLabel(f)}
              </button>
            ))}
          </div>
        ) : (
          <div className="notice" style={{ marginBottom: 0 }}>
            Stage: <strong>{stageLabel(forcedStage)}</strong>
          </div>
        )}
        <div className="form-actions">
          {canEdit && <button className="btn btn-ghost btn-sm" disabled={bulkBusy || allLoadedEnabled} onClick={() => applyBulkState(true)}>Enable visible rules</button>}
          {canEdit && <button className="btn btn-ghost btn-sm" disabled={bulkBusy || !items.some((item) => item.enabled)} onClick={() => applyBulkState(false)}>Disable visible rules</button>}
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty, stage: forcedStage || activeStage || 'pre' })}>{addLabel}</button>}
        </div>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Stage</th><th>Field path</th><th>Op</th><th>Threshold</th><th>{forcedStage === 'decision' ? 'On fail' : 'Action'}</th><th>Enabled</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td><span className={`badge ${stageBadge(s.stage)}`}>{s.stage}</span></td>
                <td className="mono text-sm" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.field_path}</td>
                <td className="mono">{s.operator}</td>
                <td className="mono">{s.threshold}</td>
                <td><span className={`badge ${s.action_on_fail === 'REJECT' ? 'badge-red' : 'badge-amber'}`}>{s.action_on_fail}</span></td>
                <td><span className={`badge ${s.enabled ? 'badge-green' : 'badge-red'}`}>{s.enabled ? 'yes' : 'no'}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => put(`/api/v1/stop-factors/${s.id}`, { ...s, enabled: !s.enabled }).then(load).catch((e) => setError(e.message))}>{s.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...s, _id: s.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(s.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? `Edit ${forcedStage === 'decision' ? 'decision rule' : 'stop factor'}` : `Add ${forcedStage === 'decision' ? 'decision rule' : 'stop factor'}`} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-inline">
            {forcedStage ? (
              <div className="form-row">
                <label>Stage</label>
                <div className="notice" style={{ marginTop: 0 }}>{stageLabel(forcedStage)}</div>
              </div>
            ) : (
              <div className="form-row"><label>Stage</label><select value={editing.stage} onChange={(e) => setEditing({ ...editing, stage: e.target.value })}><option value="pre">pre</option><option value="decision">decision</option><option value="post">post</option></select></div>
            )}
            <div className="form-row"><label>Priority</label><input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: +e.target.value })} /></div>
          </div>
          <div className="form-row"><label>Field path</label><input value={editing.field_path || ''} onChange={(e) => setEditing({ ...editing, field_path: e.target.value })} placeholder={fieldPathPlaceholder} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Operator</label><select value={editing.operator} onChange={(e) => setEditing({ ...editing, operator: e.target.value })}><option value="gte">gte</option><option value="lte">lte</option><option value="gt">gt</option><option value="lt">lt</option><option value="eq">eq</option><option value="neq">neq</option><option value="not_in">not_in</option><option value="contains">contains</option></select></div>
            <div className="form-row"><label>Threshold</label><input value={editing.threshold || ''} onChange={(e) => setEditing({ ...editing, threshold: e.target.value })} /></div>
          </div>
          {forcedStage === 'decision' && (
            <div className="notice mb-16">
              Decision rules are evaluated as pass conditions. The configured action runs only when the check fails.
              Example: <span className="mono">credit_score gte 500</span> with <span className="mono">REJECT</span> means scores below 500 are rejected.
            </div>
          )}
          <div className="form-row"><label>Action on fail</label><select value={editing.action_on_fail} onChange={(e) => setEditing({ ...editing, action_on_fail: e.target.value })}><option value="REJECT">REJECT</option><option value="REVIEW">REVIEW</option></select></div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
            </label>
          </div>
          <div className="form-actions"><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
        </Modal>
      )}
    </>
  )
}
