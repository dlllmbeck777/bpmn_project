import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const roleColors = { admin: 'badge-red', senior_analyst: 'badge-amber', analyst: 'badge-blue' }
const empty = { username: '', display_name: '', role: 'analyst', password: '', enabled: true }

export default function UsersPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/api/v1/admin-users').then(d => setItems(d.items || [])).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async () => {
    try {
      if (editing._isNew) await post('/api/v1/admin-users', editing)
      else await put(`/api/v1/admin-users/${editing.username}`, { display_name: editing.display_name, role: editing.role, password: editing.password || undefined, enabled: editing.enabled })
      setEditing(null); load()
    } catch (e) { setError(e.message) }
  }

  const revoke = async (username) => {
    try { await post(`/api/v1/admin-users/${username}/revoke-session`); load() } catch (e) { setError(e.message) }
  }

  const remove = async (username) => {
    if (!confirm(`Delete user "${username}"?`)) return
    try { await del(`/api/v1/admin-users/${username}`); load() } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      <div className="flex-between mb-16">
        <div />
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty, _isNew: true })}>+ Create user</button>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Session</th><th>Source</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map(u => (
              <tr key={u.username}>
                <td className="mono" style={{ fontWeight: 600 }}>{u.username}</td>
                <td>{u.display_name || '—'}</td>
                <td><span className={`badge ${roleColors[u.role] || 'badge-gray'}`}>{u.role}</span></td>
                <td>
                  <span className="flex-center gap-6">
                    <span className={`svc-dot ${u.session_active ? 'up' : ''}`} style={u.session_active ? {} : { background: '#d1d5db' }} />
                    <span className="text-sm">{u.session_active ? 'active' : 'none'}</span>
                  </span>
                </td>
                <td><span className={`badge ${u.source === 'seed' ? 'badge-teal' : 'badge-gray'}`}>{u.source}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...u })}>Edit</button>
                  {u.session_active && <button className="btn btn-warn btn-xs" onClick={() => revoke(u.username)}>Revoke</button>}
                  <button className="btn btn-danger btn-xs" onClick={() => remove(u.username)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._isNew ? 'Create user' : `Edit ${editing.username}`} onClose={() => setEditing(null)}>
          {editing._isNew && <div className="form-row"><label>Username</label><input value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} /></div>}
          <div className="form-inline">
            <div className="form-row"><label>Display name</label><input value={editing.display_name} onChange={e => setEditing({ ...editing, display_name: e.target.value })} /></div>
            <div className="form-row"><label>Role</label>
              <select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}>
                <option value="analyst">analyst</option><option value="senior_analyst">senior_analyst</option><option value="admin">admin</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>Password {!editing._isNew && '(leave empty to keep current)'}</label><input type="password" value={editing.password || ''} onChange={e => setEditing({ ...editing, password: e.target.value })} /></div>
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
