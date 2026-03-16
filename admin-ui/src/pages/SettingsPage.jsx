import { useEffect, useRef, useState } from 'react'

import {
  ROLE_OPTIONS, clearAuth, get,
  getApiBase, getApiKey, getCurrentUsername, getRoleLabel, getUserRole,
  setApiBase, setApiKey, setUserRole,
} from '../lib/api'

function isValidUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function SettingsPage({ onSave }) {
  const [apiBase,   setApiBaseDraft]  = useState(getApiBase)
  const [apiKey,    setApiKeyDraft]   = useState(getApiKey)
  const [userRole,  setUserRoleDraft] = useState(getUserRole)
  const [username]                    = useState(getCurrentUsername)
  const [showKey,   setShowKey]       = useState(false)
  const [healthResult, setHealthResult] = useState(null)   // { ok, message, time }
  const apiBaseInputRef = useRef(null)

  // Track dirty state so Save button is only active when something changed
  const savedBase = getApiBase()
  const savedKey  = getApiKey()
  const savedRole = getUserRole()
  const isDirty = apiBase !== savedBase || apiKey !== savedKey || userRole !== savedRole

  const urlError = apiBase && !isValidUrl(apiBase) ? 'Must be a valid http:// or https:// URL' : ''

  const save = () => {
    if (urlError) return
    const resolvedBase = setApiBase(apiBase)
    const resolvedKey  = setApiKey(apiKey)
    const resolvedRole = setUserRole(userRole)
    onSave?.()
    setHealthResult({
      ok: true,
      message: `Saved — API: ${resolvedBase} · Role: ${getRoleLabel(resolvedRole)} · Key ${resolvedKey ? 'configured' : 'cleared'}`,
      time: new Date().toLocaleTimeString(),
    })
  }

  const resetSession = () => {
    clearAuth()
    setApiKeyDraft('')
    onSave?.()
    setHealthResult({ ok: false, message: 'Session cleared. Sign in again to continue.', time: new Date().toLocaleTimeString() })
  }

  const checkHealth = async () => {
    setHealthResult(null)
    try {
      const data = await get('/health')
      setHealthResult({
        ok: true,
        message: `Health OK — status: ${data.status}, db: ${data.db}`,
        time: new Date().toLocaleTimeString(),
      })
    } catch (error) {
      setHealthResult({ ok: false, message: `Health check failed: ${error.message}`, time: new Date().toLocaleTimeString() })
    }
  }

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !urlError) save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [apiBase, apiKey, userRole, isDirty, urlError])

  return (
    <div className="settings-card">

      {/* Session info */}
      {username && (
        <div className="settings-section">
          <div className="settings-section-title">Current session</div>
          <div className="kv-grid">
            <div className="kv-pair">
              <span className="kv-label">Signed in as</span>
              <span className="kv-val">{username}</span>
            </div>
            <div className="kv-pair">
              <span className="kv-label">Role</span>
              <span className="kv-val">{getRoleLabel(userRole)}</span>
            </div>
            <div className="kv-pair">
              <span className="kv-label">API Base</span>
              <span className="kv-val" style={{ wordBreak: 'break-all' }}>{savedBase}</span>
            </div>
            <div className="kv-pair">
              <span className="kv-label">Session key</span>
              <span className="kv-val">{savedKey ? 'configured' : '— not set'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Connection */}
      <div className="settings-section">
        <div className="settings-section-title">Connection</div>
        <div className="form-row">
          <label>API Base URL</label>
          <input
            ref={apiBaseInputRef}
            value={apiBase}
            onChange={(e) => setApiBaseDraft(e.target.value)}
            placeholder="http://localhost:8000"
          />
          {urlError && <div className="validation-error">{urlError}</div>}
        </div>
        <div className="form-row">
          <label>Session / API Key</label>
          <div className="input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="Optional override for protected endpoints"
              style={{ paddingRight: 56 }}
            />
            <button className="input-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>User Role</label>
          <select value={userRole} onChange={(e) => setUserRoleDraft(e.target.value)}>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="form-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={resetSession}>Clear Session</button>
          <button className="btn btn-ghost" onClick={checkHealth}>Test Health</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isDirty && !urlError && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unsaved changes · Ctrl+S</span>
          )}
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!isDirty || !!urlError}
          >
            Save Settings
          </button>
        </div>
      </div>

      {/* Health / save result */}
      {healthResult && (
        <div className={`health-result ${healthResult.ok ? 'ok' : 'error'} mt-16`}>
          <span>{healthResult.ok ? '✓' : '✗'}</span>
          <span style={{ flex: 1 }}>{healthResult.message}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{healthResult.time}</span>
        </div>
      )}
    </div>
  )
}
