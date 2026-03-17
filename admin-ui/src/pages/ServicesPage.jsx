import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const typeColors = { orchestrator: 'badge-blue', connector: 'badge-purple', processor: 'badge-amber', engine: 'badge-teal', external: 'badge-teal' }
const DEMO_SERVICE_ID = 'credit-backend'
const DEMO_SERVICE_BASE_URL = 'http://mock-bureaus:8110'
const DEFAULT_LIVE_BASE_URL = 'http://18.119.38.114'

const empty = { id: '', name: '', type: 'connector', base_url: '', health_path: '/health', enabled: true, timeout_ms: 10000, retry_count: 2, endpoint_path: '/api/process', meta: {} }

export default function ServicesPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [modeAction, setModeAction] = useState('')

  const load = () => get('/api/v1/services').then((d) => setItems(d.items || [])).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const demoService = items.find((service) => service.id === DEMO_SERVICE_ID)
  const demoModeEnabled = Boolean(demoService && demoService.base_url === DEMO_SERVICE_BASE_URL)
  const liveUrlsStored = Boolean(demoService?.meta?.live_base_url)

  const save = async () => {
    try {
      if (items.find((s) => s.id === editing.id && !editing._isNew)) {
        await put(`/api/v1/services/${editing.id}`, editing)
      } else {
        await post('/api/v1/services', editing)
      }
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleService = async (service) => {
    try {
      await put(`/api/v1/services/${service.id}`, { ...service, enabled: !service.enabled })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm(`Delete service "${id}"?`)) return
    try {
      await del(`/api/v1/services/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const switchConnectorMode = async (targetMode) => {
    if (!canEdit) return
    setError('')
    setModeAction(targetMode)
    try {
      const service = items.find((entry) => entry.id === DEMO_SERVICE_ID)
      if (!service) throw new Error('Service credit-backend is missing')
      const nextMeta = { ...(service.meta || {}) }
      let nextBaseUrl = service.base_url
      if (targetMode === 'demo') {
        if (service.base_url && service.base_url !== DEMO_SERVICE_BASE_URL) {
          nextMeta.live_base_url = service.base_url
        }
        nextMeta.demo_mode = true
        nextMeta.demo_base_url = DEMO_SERVICE_BASE_URL
        nextBaseUrl = DEMO_SERVICE_BASE_URL
      } else {
        nextBaseUrl = nextMeta.live_base_url || DEFAULT_LIVE_BASE_URL || service.base_url
        nextMeta.demo_mode = false
      }
      await put(`/api/v1/services/${service.id}`, { ...service, base_url: nextBaseUrl, meta: nextMeta })
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setModeAction('')
    }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="card mb-16">
        <div className="card-title">Unified credit backend demo mode</div>
        <div className="flex-between" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="muted" style={{ maxWidth: 720 }}>
            Use the built-in unified mock applicant backend for leadership demos, QA, and Flowable walkthroughs without paid bureau calls.
            The switch below repoints only <span className="mono">credit-backend</span>, so later we can swap one URL back to the real external IP.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => switchConnectorMode('live')} disabled={modeAction !== ''}>{modeAction === 'live' ? 'Restoring...' : 'Restore live backend URL'}</button>}
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => switchConnectorMode('demo')} disabled={modeAction !== ''}>{modeAction === 'demo' ? 'Switching...' : 'Use unified mock backend'}</button>}
          </div>
        </div>
        <div className="detail-panel mt-16">
          <div className="kv-row"><span className="kv-key">Current mode</span><span className="kv-val">{demoModeEnabled ? 'Demo mock mode' : 'Live backend mode'}</span></div>
          <div className="kv-row"><span className="kv-key">Mock backend base URL</span><span className="kv-val mono">{DEMO_SERVICE_BASE_URL}</span></div>
          <div className="kv-row"><span className="kv-key">Current target</span><span className="kv-val mono">{demoService?.base_url || 'credit-backend not configured'}</span></div>
          <div className="kv-row"><span className="kv-key">Live URL stored</span><span className="kv-val">{liveUrlsStored ? 'Yes' : 'No, fallback default will be used on restore'}</span></div>
        </div>
      </div>

      <div className="flex-between mb-16">
        <div className="muted">You can change URLs, retries, timeouts, and quickly disable connectors or engines from here.</div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...empty, _isNew: true })}>+ Add service</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Service</th><th>Type</th><th>Base URL</th><th>Timeout</th><th>Retries</th><th>Status</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{s.id}</td>
                <td><span className={`badge ${typeColors[s.type] || 'badge-gray'}`}>{s.type}</span></td>
                <td className="mono text-sm" style={{ color: 'var(--text-3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.base_url}</td>
                <td className="mono">{(s.timeout_ms / 1000).toFixed(0)}s</td>
                <td className="mono">{s.retry_count}</td>
                <td><span className={`svc-dot ${s.enabled ? 'up' : 'down'}`} /> {s.enabled ? 'enabled' : 'disabled'}</td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => toggleService(s)}>{s.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditing({ ...s })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(s.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._isNew ? 'Add service' : `Edit ${editing.id}`} onClose={() => setEditing(null)}>
          <div className="form-inline">
            <div className="form-row"><label>ID</label><input value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} disabled={!editing._isNew} /></div>
            <div className="form-row"><label>Name</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          </div>
          <div className="form-inline">
            <div className="form-row"><label>Type</label>
              <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                <option value="connector">connector</option><option value="orchestrator">orchestrator</option>
                <option value="processor">processor</option><option value="engine">engine</option>
              </select>
            </div>
            <div className="form-row"><label>Endpoint path</label><input value={editing.endpoint_path} onChange={(e) => setEditing({ ...editing, endpoint_path: e.target.value })} /></div>
          </div>
          <div className="form-row"><label>Base URL</label><input value={editing.base_url} onChange={(e) => setEditing({ ...editing, base_url: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Timeout (ms)</label><input type="number" value={editing.timeout_ms} onChange={(e) => setEditing({ ...editing, timeout_ms: +e.target.value })} /></div>
            <div className="form-row"><label>Retry count</label><input type="number" value={editing.retry_count} onChange={(e) => setEditing({ ...editing, retry_count: +e.target.value })} /></div>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} style={{ width: 'auto' }} /> Enabled
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
