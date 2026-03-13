import { useState } from 'react'

import { getApiBase, login } from '../lib/api'

export default function LoginPage({ onLogin }) {
  const [apiBase, setApiBase] = useState(getApiBase())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login({ username, password, baseUrl: apiBase })
      onLogin?.()
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="logo login-logo">
          <div className="logo-icon">CP</div>
          <div>
            <div className="logo-text">Credit Platform</div>
            <div className="logo-sub">Admin Console Login</div>
          </div>
        </div>

        <div className="page-header login-header">
          <h1>Sign In</h1>
          <p>Use a role account instead of pasting raw API keys into the UI.</p>
        </div>

        <form onSubmit={submit}>
          <div className="form-row">
            <label>API Base URL</label>
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="http://localhost:8000" />
          </div>
          <div className="form-row">
            <label>Username</label>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          {error && <div className="notice mb-16">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
