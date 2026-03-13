import { useEffect, useState } from 'react'

import Modal from '../components/Modal'
import { ROLE_OPTIONS, del, get, post, put } from '../lib/api'

const emptyForm = {
  username: '',
  display_name: '',
  role: 'analyst',
  password: '',
  enabled: true,
}

export default function UsersPage({ canEdit = false }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    try {
      const data = await get('/api/v1/admin-users')
      setItems(data.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  const openNew = () => {
    if (!canEdit) return
    setForm(emptyForm)
    setEditing('new')
  }

  const openEdit = (item) => {
    if (!canEdit) return
    setForm({
      username: item.username,
      display_name: item.display_name || '',
      role: item.role || 'analyst',
      password: '',
      enabled: !!item.enabled,
    })
    setEditing(item.username)
  }

  const save = async () => {
    if (!canEdit) return
    try {
      if (editing === 'new') {
        await post('/api/v1/admin-users', form)
        setMessage(`User ${form.username} created.`)
      } else {
        await put(`/api/v1/admin-users/${editing}`, {
          display_name: form.display_name,
          role: form.role,
          enabled: form.enabled,
          password: form.password || null,
        })
        setMessage(`User ${editing} updated.`)
      }
      setEditing(null)
      setForm(emptyForm)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const revokeSession = async (username) => {
    if (!canEdit) return
    try {
      await post(`/api/v1/admin-users/${username}/revoke-session`, {})
      setMessage(`Session revoked for ${username}.`)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const removeUser = async (username) => {
    if (!canEdit) return
    if (!confirm(`Delete user ${username}?`)) return
    try {
      await del(`/api/v1/admin-users/${username}`)
      setMessage(`User ${username} deleted.`)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const toggleEnabled = async (item) => {
    if (!canEdit) return
    try {
      await put(`/api/v1/admin-users/${item.username}`, {
        display_name: item.display_name || '',
        role: item.role,
        enabled: !item.enabled,
        password: null,
      })
      setMessage(`User ${item.username} ${item.enabled ? 'disabled' : 'enabled'}.`)
      setError('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      {message && <div className="notice mb-16">{message}</div>}
      {!canEdit && <div className="notice mb-16">This page is restricted to administrators.</div>}

      <div className="flex-between mb-16">
        <div className="card-title" style={{ margin: 0 }}>Users & Access</div>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>Add User</button>}
      </div>

      <div className="card">
        {items.length === 0 ? (
          <p className="muted-copy">No managed users found yet. Seeded env users will appear after startup migration and can then be updated here.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Username</th><th>Display</th><th>Role</th><th>Source</th><th>Status</th><th>Session</th><th>Last Login</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.username}>
                    <td className="mono">{item.username}</td>
                    <td>{item.display_name || '-'}</td>
                    <td><span className={`badge ${item.role === 'admin' ? 'badge-red' : item.role === 'senior_analyst' ? 'badge-orange' : 'badge-blue'}`}>{item.role}</span></td>
                    <td>{item.source || 'db'}</td>
                    <td><span className={`badge ${item.enabled ? 'badge-green' : 'badge-gray'}`}>{item.enabled ? 'Enabled' : 'Disabled'}</span></td>
                    <td><span className={`badge ${item.session_active ? 'badge-blue' : 'badge-gray'}`}>{item.session_active ? 'Active' : 'None'}</span></td>
                    <td className="mono table-small">{item.last_login_at?.slice(0, 19) || '-'}</td>
                    {canEdit && (
                      <td>
                        <div className="flex-gap">
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(item)}>{item.enabled ? 'Disable' : 'Enable'}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => revokeSession(item.username)}>Revoke</button>
                          <button className="btn btn-danger btn-sm" onClick={() => removeUser(item.username)}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && editing && (
        <Modal title={editing === 'new' ? 'Add User' : `Edit ${editing}`} onClose={() => setEditing(null)}>
          {editing === 'new' && (
            <div className="form-row">
              <label>Username</label>
              <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            </div>
          )}
          <div className="form-row">
            <label>Display Name</label>
            <input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
          </div>
          <div className="form-row">
            <label>Role</label>
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>{editing === 'new' ? 'Password' : 'New Password (optional)'}</label>
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
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
