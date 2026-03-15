import { useEffect, useMemo, useState } from 'react'
import { get, post, put } from '../lib/api'

const CUSTOM_RULE = {
  name: 'Auto -> Custom default',
  priority: 0,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'custom',
  enabled: true,
  meta: {},
}

const CANARY_RULE_NAME = 'Auto -> Flowable canary'
const LEGACY_CANARY_RULE_NAME = 'Auto -> Flowable canary 5%'

const CANARY_RULE = {
  name: CANARY_RULE_NAME,
  priority: 4,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'flowable',
  enabled: true,
  meta: { sample_percent: 5, sticky_field: 'request_id', daily_quota_enabled: false },
}

const CUSTOM_REPORT_CHAIN = ['isoftpull', 'creditsafe', 'plaid']

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

function isCanaryRule(rule) {
  const name = String(rule?.name || '').trim().toLowerCase()
  return name === CANARY_RULE_NAME.toLowerCase() || name === LEGACY_CANARY_RULE_NAME.toLowerCase() || name.startsWith(`${CANARY_RULE_NAME.toLowerCase()} `)
}

function findCanaryRule(rules) {
  return (rules || []).find((rule) => isCanaryRule(rule))
}

function toPercentInput(rule) {
  const raw = normalizeMeta(rule?.meta).sample_percent
  return raw === undefined || raw === null || raw === '' ? '5' : String(raw)
}

function toStickyInput(rule) {
  return String(normalizeMeta(rule?.meta).sticky_field || 'request_id')
}

function toDailyQuotaEnabled(rule) {
  return !!normalizeMeta(rule?.meta).daily_quota_enabled
}

function toDailyQuotaMax(rule) {
  const raw = normalizeMeta(rule?.meta).daily_quota_max
  return raw === undefined || raw === null || raw === '' ? '' : String(raw)
}

function formatCanarySummary(rule) {
  if (!rule) return 'Rule missing'
  const meta = normalizeMeta(rule.meta)
  const percent = meta.sample_percent ?? 100
  const stickyField = meta.sticky_field || 'request_id'
  if (!rule.enabled) return `Disabled (${percent}% by ${stickyField})`
  if (meta.daily_quota_enabled && meta.daily_quota_max) {
    return `${percent}% by ${stickyField}, max ${meta.daily_quota_max}/day`
  }
  return `${percent}% by ${stickyField}`
}

export default function ScenariosPage({ canEdit }) {
  const [routingRules, setRoutingRules] = useState([])
  const [pipelineSteps, setPipelineSteps] = useState([])
  const [stopFactors, setStopFactors] = useState([])
  const [services, setServices] = useState([])
  const [canaryForm, setCanaryForm] = useState({
    enabled: true,
    samplePercent: '5',
    stickyField: 'request_id',
    dailyQuotaEnabled: false,
    dailyQuotaMax: '',
  })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    try {
      const [rulesResp, pipelineResp, stopResp, servicesResp] = await Promise.all([
        get('/api/v1/routing-rules'),
        get('/api/v1/pipeline-steps?pipeline_name=default'),
        get('/api/v1/stop-factors'),
        get('/api/v1/services'),
      ])
      setRoutingRules(rulesResp.items || [])
      setPipelineSteps((pipelineResp.items || []).map((step) => ({ ...step, meta: normalizeMeta(step.meta) })))
      setStopFactors(stopResp.items || [])
      setServices(servicesResp.items || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [])

  const scenarioState = useMemo(() => {
    const customRule = routingRules.find((rule) => rule.name === CUSTOM_RULE.name)
    const canaryRule = findCanaryRule(routingRules)
    const stopEnabledCount = stopFactors.filter((item) => item.enabled).length
    const customRunServices = pipelineSteps
      .filter((step) => step.enabled && !normalizeMeta(step.meta).skip_in_custom)
      .map((step) => step.service_id)
    const disabledServices = services.filter((service) => !service.enabled).map((service) => service.id)
    return {
      customRule,
      canaryRule,
      stopEnabledCount,
      customRunServices,
      disabledServices,
      canarySummary: formatCanarySummary(canaryRule),
    }
  }, [routingRules, pipelineSteps, services, stopFactors])

  useEffect(() => {
    const canaryRule = findCanaryRule(routingRules)
    setCanaryForm({
      enabled: canaryRule ? !!canaryRule.enabled : true,
      samplePercent: toPercentInput(canaryRule),
      stickyField: toStickyInput(canaryRule),
      dailyQuotaEnabled: toDailyQuotaEnabled(canaryRule),
      dailyQuotaMax: toDailyQuotaMax(canaryRule),
    })
  }, [routingRules])

  const upsertRule = async (existing, payload) => {
    if (existing) {
      await put(`/api/v1/routing-rules/${existing.id}`, { ...existing, ...payload, meta: { ...normalizeMeta(existing.meta), ...normalizeMeta(payload.meta) } })
    } else {
      await post('/api/v1/routing-rules', payload)
    }
  }

  const applyAllAutoToCustom = async () => {
    setBusy('custom')
    setError('')
    setInfo('')
    try {
      await upsertRule(routingRules.find((rule) => rule.name === CUSTOM_RULE.name), CUSTOM_RULE)

      const canaryRule = findCanaryRule(routingRules)
      if (canaryRule) {
        await put(`/api/v1/routing-rules/${canaryRule.id}`, { ...canaryRule, name: CANARY_RULE_NAME, enabled: false, meta: normalizeMeta(canaryRule.meta) })
      }
      setInfo('Scenario applied: all auto traffic now routes to custom.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const applyCanarySettings = async () => {
    setBusy('canary')
    setError('')
    setInfo('')
    try {
      const samplePercent = Number(canaryForm.samplePercent)
      if (canaryForm.enabled && (!Number.isFinite(samplePercent) || samplePercent <= 0 || samplePercent > 100)) {
        throw new Error('Canary percent must be between 1 and 100.')
      }

      const dailyQuotaMax = Number(canaryForm.dailyQuotaMax)
      if (canaryForm.dailyQuotaEnabled && (!Number.isFinite(dailyQuotaMax) || dailyQuotaMax < 1)) {
        throw new Error('Max requests per day must be at least 1 when daily quota mode is enabled.')
      }

      const canaryMeta = {
        sample_percent: Number.isFinite(samplePercent) ? Math.max(1, Math.min(100, Math.round(samplePercent))) : 5,
        sticky_field: (canaryForm.stickyField || '').trim() || 'request_id',
        daily_quota_enabled: !!canaryForm.dailyQuotaEnabled,
      }
      if (canaryForm.dailyQuotaEnabled) {
        canaryMeta.daily_quota_max = Math.max(1, Math.round(dailyQuotaMax))
      }

      if (canaryForm.enabled) {
        const customRule = routingRules.find((rule) => rule.name === CUSTOM_RULE.name)
        await upsertRule(customRule, { ...CUSTOM_RULE, priority: 6 })
      }

      await upsertRule(findCanaryRule(routingRules), {
        ...CANARY_RULE,
        enabled: !!canaryForm.enabled,
        meta: canaryMeta,
      })
      setInfo(canaryForm.enabled
        ? 'Scenario applied: Flowable canary is configured and remaining auto traffic stays on custom.'
        : 'Scenario applied: Flowable canary is now disabled.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const disableAllStopFactors = async () => {
    setBusy('stop-factors')
    setError('')
    setInfo('')
    try {
      for (const factor of stopFactors.filter((item) => item.enabled)) {
        await put(`/api/v1/stop-factors/${factor.id}`, { ...factor, enabled: false })
      }
      setInfo('Scenario applied: all stop factors are disabled.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const prepareCustomReportsChain = async () => {
    setBusy('pipeline')
    setError('')
    setInfo('')
    try {
      for (const step of pipelineSteps) {
        await put(`/api/v1/pipeline-steps/${step.id}`, {
          pipeline_name: step.pipeline_name,
          step_order: step.step_order,
          service_id: step.service_id,
          enabled: step.enabled,
          meta: {
            ...normalizeMeta(step.meta),
            skip_in_custom: !CUSTOM_REPORT_CHAIN.includes(step.service_id),
          },
        })
      }
      setInfo('Scenario applied: custom mode now runs isoftpull, creditsafe, and plaid only.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  if (!canEdit) {
    return <div className="notice notice-warn">Scenario controls require at least `senior_analyst` access.</div>
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}
      {info && <div className="notice mb-16">{info}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Auto -> Custom rule</div>
          <div className="stat-value blue">{scenarioState.customRule?.enabled ? 'ON' : 'OFF'}</div>
          <div className="stat-sub">{scenarioState.customRule ? `Priority ${scenarioState.customRule.priority}` : 'Rule missing'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Flowable canary</div>
          <div className="stat-value purple">{scenarioState.canaryRule?.enabled ? 'ON' : 'OFF'}</div>
          <div className="stat-sub">{scenarioState.canarySummary}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Enabled stop factors</div>
          <div className="stat-value amber">{scenarioState.stopEnabledCount}</div>
          <div className="stat-sub">{scenarioState.stopEnabledCount === 0 ? 'All disabled' : 'Rules still active'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custom chain</div>
          <div className="stat-value green">{scenarioState.customRunServices.length}</div>
          <div className="stat-sub">{scenarioState.customRunServices.join(', ') || 'No active steps'}</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">One-click scenarios</div>
        <div className="muted mb-12">Use these buttons to apply the exact operational setups without switching between multiple tabs or using commands.</div>
        <div className="form-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy === 'custom'} onClick={applyAllAutoToCustom}>Route all auto traffic to custom</button>
          <button className="btn btn-ghost" disabled={busy === 'pipeline'} onClick={prepareCustomReportsChain}>Prepare custom reports chain</button>
          <button className="btn btn-warn" disabled={busy === 'stop-factors'} onClick={disableAllStopFactors}>Disable all stop factors</button>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">Flowable canary</div>
        <div className="muted mb-12">Configure the exact share of auto traffic that should go to Flowable. The rest of auto traffic stays on custom when the canary is enabled.</div>
        <div className="form-inline">
          <div className="form-row">
            <label>Percent</label>
            <input
              type="number"
              min="1"
              max="100"
              value={canaryForm.samplePercent}
              onChange={(e) => setCanaryForm((current) => ({ ...current, samplePercent: e.target.value }))}
              placeholder="5"
            />
          </div>
          <div className="form-row">
            <label>Sticky field</label>
            <input
              value={canaryForm.stickyField}
              onChange={(e) => setCanaryForm((current) => ({ ...current, stickyField: e.target.value }))}
              placeholder="request_id"
            />
          </div>
        </div>
        <div className="form-inline">
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={canaryForm.enabled}
                onChange={(e) => setCanaryForm((current) => ({ ...current, enabled: e.target.checked }))}
                style={{ width: 'auto' }}
              />
              Enabled
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={canaryForm.dailyQuotaEnabled}
                onChange={(e) => setCanaryForm((current) => ({ ...current, dailyQuotaEnabled: e.target.checked }))}
                style={{ width: 'auto' }}
              />
              Daily quota mode
            </label>
          </div>
        </div>
        <div className="form-inline">
          <div className="form-row">
            <label>Max requests per day</label>
            <input
              type="number"
              min="1"
              value={canaryForm.dailyQuotaMax}
              onChange={(e) => setCanaryForm((current) => ({ ...current, dailyQuotaMax: e.target.value }))}
              placeholder="6"
              disabled={!canaryForm.dailyQuotaEnabled}
            />
          </div>
          <div className="form-row">
            <label>Current effective summary</label>
            <div className="notice">
              {canaryForm.enabled
                ? `${canaryForm.samplePercent || '5'}% by ${canaryForm.stickyField || 'request_id'}${canaryForm.dailyQuotaEnabled && canaryForm.dailyQuotaMax ? `, max ${canaryForm.dailyQuotaMax}/day` : ''}`
                : 'Canary disabled'}
            </div>
          </div>
        </div>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-ghost" disabled={busy === 'canary'} onClick={applyCanarySettings}>Apply</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Custom mode services</div>
          <div className="timeline">
            {scenarioState.customRunServices.map((serviceId) => (
              <div className="svc-list-item" key={serviceId}>
                <span className="svc-dot up" />
                <div className="svc-name">{serviceId}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Disabled services</div>
          {scenarioState.disabledServices.length === 0 ? (
            <div className="text-muted text-sm">No services are disabled right now.</div>
          ) : (
            <div className="timeline">
              {scenarioState.disabledServices.map((serviceId) => (
                <div className="svc-list-item" key={serviceId}>
                  <span className="svc-dot down" />
                  <div className="svc-name">{serviceId}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
