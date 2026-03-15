import { useState } from 'react'
import { getApiBase, setApiBase, getCurrentUsername, getUserRole, getRoleLabel, hasUiSession } from '../lib/api'

export default function SettingsPage({ onSave }) {
  const [base, setBase] = useState(getApiBase())
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setApiBase(base)
    setSaved(true)
    onSave?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-title">API configuration</div>
        <div className="form-row">
          <label>API Base URL</label>
          <input value={base} onChange={e => setBase(e.target.value)} placeholder="http://localhost:8000" />
        </div>

        <div className="detail-panel mt-16">
          <div className="kv-row"><span className="kv-key">User</span><span className="kv-val">{getCurrentUsername() || '—'}</span></div>
          <div className="kv-row"><span className="kv-key">Role</span><span className="kv-val">{getRoleLabel(getUserRole())}</span></div>
          <div className="kv-row"><span className="kv-key">Session</span><span className="kv-val">{hasUiSession() ? 'Active' : 'Not authenticated'}</span></div>
        </div>

        <div className="form-actions">
          {saved && <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>Saved</span>}
          <button className="btn btn-primary" onClick={handleSave}>Save settings</button>
        </div>
      </div>
    </div>
  )
}
