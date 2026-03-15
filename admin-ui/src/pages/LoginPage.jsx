import { useState } from 'react'
import { getApiBase, login } from '../lib/api'
import { IconLayers } from '../components/Icons'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [baseUrl, setBaseUrl] = useState(getApiBase())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login({ username, password, baseUrl })
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo flex-center gap-8">
          <div className="logo-icon"><IconLayers /></div>
          <div>
            <div className="logo-text">Credit Platform</div>
            <div className="logo-sub">Admin Console</div>
          </div>
        </div>
        <h2>Sign in</h2>
        <p className="sub">Enter your credentials to access the admin panel</p>

        <div className="form-row">
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoFocus />
        </div>
        <div className="form-row">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
        </div>
        <div className="form-row">
          <label>API Base URL</label>
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:8000" />
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn btn-primary w-full" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}
