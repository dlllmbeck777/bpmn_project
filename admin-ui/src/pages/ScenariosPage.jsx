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

const CANARY_RULE = {
  name: 'Auto -> Flowable canary 5%',
  priority: 4,
  condition_field: 'orchestration_mode',
  condition_op: 'eq',
  condition_value: 'auto',
  target_mode: 'flowable',
  enabled: true,
  meta: { sample_percent: 5, sticky_field: 'request_id' },
}

const CUSTOM_REPORT_CHAIN = ['isoftpull', 'creditsafe', 'plaid']

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

export default function ScenariosPage({ canEdit }) {
  const [routingRules, setRoutingRules] = useState([])
  const [pipelineSteps, setPipelineSteps] = useState([])
  const [stopFactors, setStopFactors] = useState([])
  const [services, setServices] = useState([])
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
    const canaryRule = routingRules.find((rule) => rule.name === CANARY_RULE.name)
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
    }
  }, [routingRules, pipelineSteps, services, stopFactors])

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

      const canaryRule = routingRules.find((rule) => rule.name === CANARY_RULE.name)
      if (canaryRule) {
        await put(`/api/v1/routing-rules/${canaryRule.id}`, { ...canaryRule, enabled: false, meta: normalizeMeta(canaryRule.meta) })
      }
      setInfo('Scenario applied: all auto traffic now routes to custom.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const applyCanary = async () => {
    setBusy('canary')
    setError('')
    setInfo('')
    try {
      const customRule = routingRules.find((rule) => rule.name === CUSTOM_RULE.name)
      await upsertRule(customRule, { ...CUSTOM_RULE, priority: 6 })
      await upsertRule(routingRules.find((rule) => rule.name === CANARY_RULE.name), CANARY_RULE)
      setInfo('Scenario applied: 5% of auto traffic goes to Flowable, remaining auto traffic stays on custom.')
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
          <div className="stat-label">5% Flowable canary</div>
          <div className="stat-value purple">{scenarioState.canaryRule?.enabled ? 'ON' : 'OFF'}</div>
          <div className="stat-sub">{scenarioState.canaryRule?.enabled ? '5% active' : 'Disabled'}</div>
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
          <button className="btn btn-ghost" disabled={busy === 'canary'} onClick={applyCanary}>Enable 5% Flowable canary</button>
          <button className="btn btn-warn" disabled={busy === 'stop-factors'} onClick={disableAllStopFactors}>Disable all stop factors</button>
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
