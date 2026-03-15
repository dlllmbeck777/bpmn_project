import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const empty = { name: '', stage: 'pre', check_type: 'field_check', field_path: '', operator: 'gte', threshold: '', action_on_fail: 'REJECT', enabled: true, priority: 0, meta: {} }

export default function StopFactorsPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    const q = filter ? `?stage=${filter}` : ''
    get(`/api/v1/stop-factors${q}`).then(d => setItems(d.items || [])).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [filter])

  const save = async () => {
    try {
      if (editing._id) await put(`/api/v1/stop-factors/${editing._id}`, editing)
      else await post('/api/v1/stop-factors', editing)
      setEditing(null); load()
    } catch (e) { setError(e.message) }
  }

  const remove = async (id) => {
    if (!confirm('Delete this stop factor?')) return
    try { await del(`/api/v1/stop-factors/${id}`); load() } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      <div className="flex-between mb-16">
        <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {['', 'pre', 'post'].map(f => (
            <button key={f} className={`tab-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f || 'All'}
            </button>
          ))}
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty })}>+ Add factor</button>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Stage</th><th>Field path</th><th>Op</th><th>Threshold</th><th>Action</th><th>Enabled</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td><span className={`badge ${s.stage === 'pre' ? 'badge-blue' : 'badge-amber'}`}>{s.stage}</span></td>
                <td className="mono text-sm" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.field_path}</td>
                <td className="mono">{s.operator}</td>
                <td className="mono">{s.threshold}</td>
                <td><span className={`badge ${s.action_on_fail === 'REJECT' ? 'badge-red' : 'badge-amber'}`}>{s.action_on_fail}</span></td>
                <td><span className={`badge ${s.enabled ? 'badge-green' : 'badge-red'}`}>{s.enabled ? 'yes' : 'no'}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...s, _id: s.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(s.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit stop factor' : 'Add stop factor'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Stage</label><select value={editing.stage} onChange={e => setEditing({ ...editing, stage: e.target.value })}><option value="pre">pre</option><option value="post">post</option></select></div>
            <div className="form-row"><label>Priority</label><input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: +e.target.value })} /></div>
          </div>
          <div className="form-row"><label>Field path</label><input value={editing.field_path || ''} onChange={e => setEditing({ ...editing, field_path: e.target.value })} placeholder="result.parsed_report.summary.credit_score" /></div>
          <div className="form-inline">
            <div className="form-row"><label>Operator</label><select value={editing.operator} onChange={e => setEditing({ ...editing, operator: e.target.value })}><option value="gte">gte</option><option value="lte">lte</option><option value="gt">gt</option><option value="lt">lt</option><option value="eq">eq</option><option value="neq">neq</option><option value="not_in">not_in</option><option value="contains">contains</option></select></div>
            <div className="form-row"><label>Threshold</label><input value={editing.threshold || ''} onChange={e => setEditing({ ...editing, threshold: e.target.value })} /></div>
          </div>
          <div className="form-row"><label>Action on fail</label><select value={editing.action_on_fail} onChange={e => setEditing({ ...editing, action_on_fail: e.target.value })}><option value="REJECT">REJECT</option><option value="REVIEW">REVIEW</option></select></div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
            </label>
          </div>
          <div className="form-actions"><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
        </Modal>
      )}
    </>
  )
}
