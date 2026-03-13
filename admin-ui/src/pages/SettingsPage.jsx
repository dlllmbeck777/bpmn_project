import { useState } from 'react'

import { ROLE_OPTIONS, clearAuth, get, getApiBase, getApiKey, getCurrentUsername, getRoleLabel, getUserRole, setApiBase, setApiKey, setUserRole } from '../lib/api'

export default function SettingsPage({ onSave }) {
  const [apiBase, setApiBaseDraft] = useState(getApiBase())
  const [apiKey, setApiKeyDraft] = useState(getApiKey())
  const [userRole, setUserRoleDraft] = useState(getUserRole())
  const [username] = useState(getCurrentUsername())
  const [message, setMessage] = useState('')

  const save = () => {
    const savedBase = setApiBase(apiBase)
    const savedKey = setApiKey(apiKey)
    const savedRole = setUserRole(userRole)
    onSave?.()
    setMessage(`Saved. API: ${savedBase}. Role: ${getRoleLabel(savedRole)}. Key ${savedKey ? 'configured' : 'cleared'}.`)
  }

  const resetSession = () => {
    clearAuth()
    setApiKeyDraft('')
    onSave?.()
    setMessage('Stored UI session cleared. You will need to sign in again.')
  }

  const checkHealth = async () => {
    try {
      const data = await get('/health')
      setMessage(`Health OK: ${data.status} (${data.db})`)
    } catch (error) {
      setMessage(`Health check failed: ${error.message}`)
    }
  }

  return (
    <div className="card settings-card">
      <div className="card-title"><span className="dot dot-blue" /> API Settings</div>
      {username && <div className="notice mb-16">Signed in as {username} ({getRoleLabel(userRole)}).</div>}
      <div className="form-row">
        <label>API Base URL</label>
        <input value={apiBase} onChange={(event) => setApiBaseDraft(event.target.value)} placeholder="http://localhost:8000" />
      </div>
      <div className="form-row">
        <label>Session/API Key</label>
        <input value={apiKey} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder="Optional override for protected endpoints" />
      </div>
      <div className="form-row">
        <label>User Role</label>
        <select value={userRole} onChange={(event) => setUserRoleDraft(event.target.value)}>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={resetSession}>Clear Session</button>
        <button className="btn btn-ghost" onClick={checkHealth}>Test Health</button>
        <button className="btn btn-primary" onClick={save}>Save Settings</button>
      </div>
      {message && <div className="notice mt-16">{message}</div>}
    </div>
  )
}
