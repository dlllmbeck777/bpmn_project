import { useEffect, useState } from 'react'
import { getApiBase, setApiBase, getCurrentUsername, getUserRole, getRoleLabel, hasUiSession } from '../lib/api'
import { THEME_OPTIONS } from '../lib/theme'

export default function SettingsPage({ onSave, theme, onThemeChange }) {
  const [base, setBase] = useState(getApiBase())
  const [selectedTheme, setSelectedTheme] = useState(theme || 'light')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSelectedTheme(theme || 'light')
  }, [theme])

  const handleSave = () => {
    setApiBase(base)
    onThemeChange?.(selectedTheme)
    setSaved(true)
    onSave?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-title">API and appearance</div>
        <div className="form-row">
          <label>API Base URL</label>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:8000" />
        </div>
        <div className="form-row">
          <label>Theme</label>
          <select value={selectedTheme} onChange={(e) => setSelectedTheme(e.target.value)}>
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="detail-panel mt-16">
          <div className="kv-row"><span className="kv-key">User</span><span className="kv-val">{getCurrentUsername() || '-'}</span></div>
          <div className="kv-row"><span className="kv-key">Role</span><span className="kv-val">{getRoleLabel(getUserRole())}</span></div>
          <div className="kv-row"><span className="kv-key">Theme</span><span className="kv-val">{selectedTheme}</span></div>
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
