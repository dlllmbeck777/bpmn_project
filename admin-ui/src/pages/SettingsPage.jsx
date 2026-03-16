import { useEffect, useMemo, useState } from 'react'
import { getApiBase, getDefaultApiBase, setApiBase, getCurrentUsername, getUserRole, getRoleLabel, hasUiSession } from '../lib/api'
import { getStartPage, setStartPage } from '../lib/preferences'
import { THEME_OPTIONS } from '../lib/theme'

function normalizeBaseUrl(value) {
  return (value || '').trim().replace(/\/+$/, '')
}

export default function SettingsPage({ onSave, theme, onThemeChange, availablePages = [], currentPage, onNavigate }) {
  const [base, setBase] = useState(getApiBase())
  const [selectedTheme, setSelectedTheme] = useState(theme || 'light')
  const [selectedStartPage, setSelectedStartPage] = useState(getStartPage())
  const [saved, setSaved] = useState(false)
  const [connectionState, setConnectionState] = useState({ status: 'idle', message: 'Not checked yet' })

  useEffect(() => {
    setSelectedTheme(theme || 'light')
  }, [theme])

  const quickLinks = useMemo(
    () => availablePages.filter((page) => ['control', 'services', 'requests', 'flowable', 'audit', 'users'].includes(page.id)),
    [availablePages],
  )

  const startPageOptions = useMemo(
    () => availablePages.filter((page) => page.id !== 'settings'),
    [availablePages],
  )

  const handleSave = () => {
    setApiBase(base)
    onThemeChange?.(selectedTheme)
    setStartPage(selectedStartPage)
    setSaved(true)
    onSave?.()
    setTimeout(() => setSaved(false), 2000)
  }

  const handleResetApiBase = () => {
    setBase(getDefaultApiBase())
    setConnectionState({ status: 'idle', message: 'Recommended base restored. Save to apply it.' })
  }

  const handleTestConnection = async () => {
    const targetBase = normalizeBaseUrl(base || getApiBase() || getDefaultApiBase())
    setConnectionState({ status: 'loading', message: 'Checking API health...' })
    try {
      const response = await fetch(`${targetBase}/health`)
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const payload = await response.json()
      setConnectionState({
        status: 'ok',
        message: payload?.status === 'ok'
          ? `API is reachable. DB: ${payload.db || 'unknown'}`
          : 'API responded, but the health payload is unexpected.',
      })
    } catch (error) {
      setConnectionState({ status: 'error', message: error.message || 'Failed to reach the API.' })
    }
  }

  return (
    <div className="settings-grid">
      <div className="settings-stack">
        <div className="card">
          <div className="card-title">Workspace preferences</div>
          <div className="form-row">
            <label>API Base URL</label>
            <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:8000" />
          </div>
          <div className="form-inline">
            <div className="form-row">
              <label>Theme</label>
              <select value={selectedTheme} onChange={(e) => setSelectedTheme(e.target.value)}>
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Default landing page</label>
              <select value={selectedStartPage} onChange={(e) => setSelectedStartPage(e.target.value)}>
                {startPageOptions.map((page) => (
                  <option key={page.id} value={page.id}>{page.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-actions settings-actions-row">
            <button className="btn btn-ghost" onClick={handleResetApiBase}>Use recommended API URL</button>
            <button className="btn btn-ghost" onClick={handleTestConnection}>Test API connection</button>
            <button className="btn btn-primary" onClick={handleSave}>Save settings</button>
          </div>

          <div className={`notice mt-16${connectionState.status === 'error' ? ' notice-error' : connectionState.status === 'ok' ? '' : ' notice-warn'}`}>
            {connectionState.message}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Quick access</div>
          <p className="muted mb-12">Jump straight into the operational area you need most often.</p>
          <div className="shortcut-grid">
            {quickLinks.map((page) => (
              <button key={page.id} className="shortcut-card" onClick={() => onNavigate?.(page.id)}>
                <span className="shortcut-title">{page.label}</span>
                <span className="shortcut-meta">{page.id === 'control' ? 'Routing, stop factors, and pipeline in one place' : `Open ${page.label.toLowerCase()} workspace`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-stack">
        <div className="card">
          <div className="card-title">Session and environment</div>
          <div className="detail-panel">
            <div className="kv-row"><span className="kv-key">User</span><span className="kv-val">{getCurrentUsername() || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Role</span><span className="kv-val">{getRoleLabel(getUserRole())}</span></div>
            <div className="kv-row"><span className="kv-key">Session</span><span className="kv-val">{hasUiSession() ? 'Active' : 'Not authenticated'}</span></div>
            <div className="kv-row"><span className="kv-key">Current page</span><span className="kv-val">{availablePages.find((page) => page.id === currentPage)?.label || currentPage || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Saved start page</span><span className="kv-val">{startPageOptions.find((page) => page.id === selectedStartPage)?.label || selectedStartPage}</span></div>
            <div className="kv-row"><span className="kv-key">Theme</span><span className="kv-val">{selectedTheme}</span></div>
            <div className="kv-row"><span className="kv-key">Configured API</span><span className="kv-val">{normalizeBaseUrl(base || getApiBase()) || '-'}</span></div>
            <div className="kv-row"><span className="kv-key">Recommended API</span><span className="kv-val">{getDefaultApiBase()}</span></div>
            <div className="kv-row"><span className="kv-key">Browser origin</span><span className="kv-val">{window.location.origin}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">How this workspace is organized</div>
          <div className="settings-note-list">
            <div className="notice">Use <strong>Orchestration</strong> for routing policy, stop factors, and pipeline.</div>
            <div className="notice">Keep <strong>Services</strong> separate for connector URLs, retries, and enable/disable status.</div>
            <div className="notice">Use this page for personal workspace settings, API connectivity, and fast navigation.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
