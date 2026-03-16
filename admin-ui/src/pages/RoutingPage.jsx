import { useEffect, useMemo, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import Modal from '../components/Modal'

const empty = {
  name: '',
  priority: 0,
  condition_field: '',
  condition_op: 'eq',
  condition_value: '',
  target_mode: 'flowable',
  enabled: true,
  meta: {},
}

const CUSTOM_DEFAULT_RULE = {
  name: 'Auto -> Custom default',
  priority: 0,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'custom',
  enabled: true,
  meta: {},
}

const FLOWABLE_DEFAULT_RULE = {
  name: 'Auto -> Flowable default',
  priority: 0,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'flowable',
  enabled: true,
  meta: {},
}

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

function withMeta(rule) {
  return { ...rule, meta: normalizeMeta(rule.meta) }
}

function isReservedRule(rule) {
  const name = String(rule?.name || '').trim().toLowerCase()
  return [
    CUSTOM_DEFAULT_RULE.name.toLowerCase(),
    FLOWABLE_DEFAULT_RULE.name.toLowerCase(),
    'auto -> flowable canary',
    'auto -> flowable canary 5%',
  ].includes(name) || name.startsWith('auto -> flowable canary ')
}

function targetLabel(targetMode) {
  return targetMode === 'custom' ? 'custom' : 'auto / flowable'
}

export default function RoutingPage({ canEdit }) {
  const [items, setItems] = useState([])
  const [mode, setMode] = useState('all_flowable')
  const [fallbackTarget, setFallbackTarget] = useState('flowable')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')

  const load = () =>
    get('/api/v1/routing-rules')
      .then((d) => setItems((d.items || []).map(withMeta)))
      .catch((e) => setError(e.message))

  useEffect(() => { load() }, [])

  const customDefaultRule = useMemo(() => items.find((rule) => rule.name === CUSTOM_DEFAULT_RULE.name), [items])
  const flowableDefaultRule = useMemo(() => items.find((rule) => rule.name === FLOWABLE_DEFAULT_RULE.name), [items])
  const userRules = useMemo(() => items.filter((rule) => !isReservedRule(rule)), [items])
  const reservedRules = useMemo(() => items.filter((rule) => isReservedRule(rule)), [items])
  const enabledUserRules = useMemo(() => userRules.filter((rule) => rule.enabled), [userRules])

  useEffect(() => {
    const hasExplicitFallback = (
      (customDefaultRule?.enabled && customDefaultRule.priority >= 100)
      || (flowableDefaultRule?.enabled && flowableDefaultRule.priority >= 100)
    )
    if (enabledUserRules.length > 0 || hasExplicitFallback) {
      setMode('rule_based')
    } else if (customDefaultRule?.enabled) {
      setMode('all_custom')
    } else {
      setMode('all_flowable')
    }
    if (customDefaultRule?.enabled && customDefaultRule.priority >= 100) {
      setFallbackTarget('custom')
    } else if (flowableDefaultRule?.enabled && flowableDefaultRule.priority >= 100) {
      setFallbackTarget('flowable')
    } else if (customDefaultRule?.enabled && enabledUserRules.length === 0) {
      setFallbackTarget('custom')
    } else {
      setFallbackTarget('flowable')
    }
  }, [customDefaultRule, enabledUserRules.length, flowableDefaultRule])

  const buildPayload = (rule) => ({
    ...rule,
    meta: {},
  })

  const upsertRule = async (existing, payload) => {
    const normalized = buildPayload(existing ? { ...existing, ...payload } : payload)
    if (existing) {
      await put(`/api/v1/routing-rules/${existing.id}`, normalized)
    } else {
      await post('/api/v1/routing-rules', normalized)
    }
  }

  const save = async () => {
    try {
      const payload = buildPayload(editing)
      if (editing._id) {
        await put(`/api/v1/routing-rules/${editing._id}`, payload)
      } else {
        await post('/api/v1/routing-rules', payload)
      }
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this routing rule?')) return
    try {
      await del(`/api/v1/routing-rules/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const setRuleEnabledState = async (rule, enabled) => {
    await put(`/api/v1/routing-rules/${rule.id}`, buildPayload({ ...rule, enabled }))
  }

  const applyMode = async () => {
    setBusyAction('mode')
    setError('')
    try {
      if (mode === 'all_custom') {
        await upsertRule(customDefaultRule, CUSTOM_DEFAULT_RULE)
        await upsertRule(flowableDefaultRule, { ...FLOWABLE_DEFAULT_RULE, enabled: false, priority: 0 })
        for (const rule of [...userRules, ...reservedRules.filter((rule) => ![CUSTOM_DEFAULT_RULE.name, FLOWABLE_DEFAULT_RULE.name].includes(rule.name))]) {
          if (rule.enabled) await setRuleEnabledState(rule, false)
        }
      } else if (mode === 'all_flowable') {
        await upsertRule(flowableDefaultRule, FLOWABLE_DEFAULT_RULE)
        await upsertRule(customDefaultRule, { ...CUSTOM_DEFAULT_RULE, enabled: false, priority: 0 })
        for (const rule of [...userRules, ...reservedRules.filter((rule) => ![CUSTOM_DEFAULT_RULE.name, FLOWABLE_DEFAULT_RULE.name].includes(rule.name))]) {
          if (rule.enabled) await setRuleEnabledState(rule, false)
        }
      } else {
        await upsertRule(customDefaultRule, { ...CUSTOM_DEFAULT_RULE, enabled: fallbackTarget === 'custom', priority: 100 })
        await upsertRule(flowableDefaultRule, { ...FLOWABLE_DEFAULT_RULE, enabled: fallbackTarget === 'flowable', priority: 100 })
        for (const rule of reservedRules.filter((rule) => ![CUSTOM_DEFAULT_RULE.name, FLOWABLE_DEFAULT_RULE.name].includes(rule.name))) {
          if (rule.enabled) await setRuleEnabledState(rule, false)
        }
      }
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyAction('')
    }
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="card mb-16">
        <div className="card-title">Routing policy</div>
        <div className="muted mb-12">Choose one clear policy. No duplicated presets, no canary controls here, and no hidden traffic split in the UI.</div>
        <div className="routing-mode-grid">
          <label className={`choice-card${mode === 'all_custom' ? ' active' : ''}`}>
            <input type="radio" name="routing-mode" checked={mode === 'all_custom'} onChange={() => setMode('all_custom')} />
            <div className="choice-card-title">Send all auto requests to custom</div>
            <div className="choice-card-meta">A single default rule sends every auto request to custom orchestration.</div>
          </label>
          <label className={`choice-card${mode === 'all_flowable' ? ' active' : ''}`}>
            <input type="radio" name="routing-mode" checked={mode === 'all_flowable'} onChange={() => setMode('all_flowable')} />
            <div className="choice-card-title">Send all auto requests to auto / flowable</div>
            <div className="choice-card-meta">A single default rule sends every auto request to Flowable orchestration.</div>
          </label>
          <label className={`choice-card${mode === 'rule_based' ? ' active' : ''}`}>
            <input type="radio" name="routing-mode" checked={mode === 'rule_based'} onChange={() => setMode('rule_based')} />
            <div className="choice-card-title">Use routing rules</div>
            <div className="choice-card-meta">Evaluate explicit rules first, then apply one fallback target for unmatched requests.</div>
          </label>
        </div>
        {mode === 'rule_based' && (
          <div className="form-inline mt-16">
            <div className="form-row">
              <label>Fallback target when no rule matches</label>
              <select value={fallbackTarget} onChange={(e) => setFallbackTarget(e.target.value)}>
                <option value="flowable">auto / flowable</option>
                <option value="custom">custom</option>
              </select>
            </div>
            <div className="form-row">
              <label>Active rule count</label>
              <div className="notice">{enabledUserRules.length} enabled user rule(s)</div>
            </div>
          </div>
        )}
        <div className="form-actions settings-actions-row">
          {canEdit && <button className="btn btn-primary" disabled={busyAction === 'mode'} onClick={applyMode}>Apply routing policy</button>}
        </div>
      </div>

      <div className="flex-between mb-16">
        <div className="muted">
          {mode === 'rule_based'
            ? 'Rule-based mode is active. Rules below are evaluated by priority, then the fallback target is used.'
            : 'Rule list is hidden from routing behavior until you switch back to rule-based mode.'}
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={mode !== 'rule_based'} onClick={() => setEditing({ ...empty, meta: {} })}>+ Add rule</button>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Priority</th><th>Condition</th><th>Target</th><th>Status</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {userRules.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td className="mono">{r.priority}</td>
                <td className="mono text-sm">{r.condition_field} {r.condition_op} "{r.condition_value}"</td>
                <td><span className={`badge ${r.target_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`}>{targetLabel(r.target_mode)}</span></td>
                <td><span className={`badge ${r.enabled ? 'badge-green' : 'badge-red'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                {canEdit && <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" disabled={mode !== 'rule_based'} onClick={() => setEditing({ ...withMeta(r), _id: r.id })}>Edit</button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(r.id)}>Delete</button>
                </td>}
              </tr>
            ))}
            {userRules.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="text-muted">No user-defined routing rules yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit rule' : 'Add rule'} onClose={() => setEditing(null)}>
          <div className="form-row"><label>Name</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-inline">
            <div className="form-row"><label>Priority</label><input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: +e.target.value })} /></div>
            <div className="form-row"><label>Target</label>
              <select value={editing.target_mode} onChange={(e) => setEditing({ ...editing, target_mode: e.target.value })}>
                <option value="flowable">auto / flowable</option><option value="custom">custom</option>
              </select>
            </div>
          </div>
          <div className="form-inline">
            <div className="form-row"><label>Condition field</label><input value={editing.condition_field} onChange={(e) => setEditing({ ...editing, condition_field: e.target.value })} placeholder="orchestration_mode" /></div>
            <div className="form-row"><label>Operator</label>
              <select value={editing.condition_op} onChange={(e) => setEditing({ ...editing, condition_op: e.target.value })}>
                <option value="eq">eq</option><option value="neq">neq</option><option value="contains">contains</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>Condition value</label><input value={editing.condition_value} onChange={(e) => setEditing({ ...editing, condition_value: e.target.value })} /></div>
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
