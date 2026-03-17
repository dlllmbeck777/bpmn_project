import { useEffect, useMemo, useState } from 'react'
import { get } from '../lib/api'
import { IconSearch } from '../components/Icons'

function statusColor(s) {
  if (['OK', 'PASS', 'COMPLETED'].includes(s)) return 'var(--green)'
  if (['REJECTED', 'FAILED', 'REJECT', 'UNAVAILABLE'].includes(s)) return 'var(--red)'
  if (['REVIEW', 'SKIPPED'].includes(s)) return 'var(--amber)'
  return 'var(--blue)'
}

function badgeCls(s) {
  if (['OK', 'PASS', 'COMPLETED'].includes(s)) return 'badge-green'
  if (['REJECTED', 'FAILED', 'REJECT', 'UNAVAILABLE'].includes(s)) return 'badge-red'
  if (['REVIEW', 'SKIPPED'].includes(s)) return 'badge-amber'
  return 'badge-blue'
}

function sortEvents(events) {
  return [...events].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || (a.id || 0) - (b.id || 0))
}

function laneOf(ev) {
  if (['gateway', 'routing'].includes(ev.stage)) return 'Gateway & routing'
  if (ev.stage === 'stop_factor_pre') return 'Pre checks'
  if (ev.stage === 'connector') return 'Connectors'
  if (ev.stage === 'parser') return 'Parser'
  if (ev.stage === 'decision') return 'Decision'
  if (ev.stage === 'stop_factor_post') return 'Post checks'
  if (ev.stage === 'request') return 'Finalization'
  return ev.stage
}

function finalOutcomeEvent(group) {
  const events = group?.events || []
  return [...events].reverse().find((ev) => ev.stage === 'request' && ['COMPLETED', 'REVIEW', 'REJECTED', 'FAILED', 'ENGINE_ERROR', 'ENGINE_UNREACHABLE'].includes(ev.status))
}

export default function ProcessTrackerPage() {
  const [items, setItems] = useState([])
  const [requestId, setRequestId] = useState('')
  const [filter, setFilter] = useState('')
  const [selGroup, setSelGroup] = useState(null)
  const [selEvent, setSelEvent] = useState(null)
  const [error, setError] = useState('')

  const load = (rid = requestId) => {
    const q = rid ? `?request_id=${encodeURIComponent(rid)}` : ''
    get(`/api/v1/process-tracker${q}`).then(d => setItems(d.items || [])).catch(e => setError(e.message))
  }
  useEffect(() => { load('') }, [])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const key = item.request_id || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return Array.from(map.entries()).map(([k, evts]) => {
      const sorted = sortEvents(evts)
      const last = sorted[sorted.length - 1]
      const status = last?.status || 'UNKNOWN'
      return { request_id: k, events: sorted, status, time: (sorted[0]?.created_at || '').slice(11, 19) }
    }).sort((a, b) => b.events[b.events.length - 1]?.created_at?.localeCompare(a.events[a.events.length - 1]?.created_at || '') || 0)
  }, [items])

  const filteredGroups = filter ? grouped.filter(g => g.status === filter) : grouped
  const group = selGroup || filteredGroups[0]

  useEffect(() => {
    if (!group) {
      setSelEvent(null)
      return
    }
    const next = finalOutcomeEvent(group) || group.events[group.events.length - 1] || null
    if (!selEvent || !group.events.some((ev) => ev.id === selEvent.id)) {
      setSelEvent(next)
    }
  }, [group?.request_id, items])

  useEffect(() => {
    if (!group?.request_id || group.status !== 'RUNNING') return undefined
    const timer = setInterval(() => {
      load(group.request_id)
    }, 3000)
    return () => clearInterval(timer)
  }, [group?.request_id, group?.status])

  const renderWaterfall = () => {
    if (!group) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Select a request</div>

    const evts = group.events
    const outcome = finalOutcomeEvent(group)
    const outcomePayload = outcome?.payload && typeof outcome.payload === 'object' ? outcome.payload : {}
    const outcomeSummary = outcomePayload.summary && typeof outcomePayload.summary === 'object' ? outcomePayload.summary : {}
    // Assign offsets based on index (we don't have real ms, so approximate)
    const withOffsets = evts.map((ev, i) => ({ ...ev, _offset: i * 100, _dur: ev.stage === 'connector' ? 300 : ev.stage === 'parser' ? 80 : ev.stage?.startsWith('stop_factor') ? 40 : 10 }))
    const totalMs = withOffsets.reduce((max, e) => Math.max(max, e._offset + e._dur), 1)

    // Group by lane
    const laneOrder = ['Gateway & routing', 'Pre checks', 'Connectors', 'Parser', 'Decision', 'Post checks', 'Finalization']
    const lanes = new Map()
    for (const ev of withOffsets) {
      const lane = laneOf(ev)
      if (!lanes.has(lane)) lanes.set(lane, [])
      lanes.get(lane).push(ev)
    }

    const connectors = withOffsets.filter(e => e.stage === 'connector' && e.status !== 'SKIPPED')
    const avgConn = connectors.length ? Math.round(connectors.reduce((s, e) => s + e._dur, 0) / connectors.length) : 0
    const skipped = withOffsets.filter(e => e.status === 'SKIPPED').length

    return (
      <>
        <div className="summary-bar">
          <div className="sum-card"><div className="sum-label">Current status</div><div className="sum-val">{group.status}</div></div>
          <div className="sum-card"><div className="sum-label">Decision</div><div className="sum-val" style={{ fontSize: 13 }}>{outcomePayload.decision_reason || (group.status === 'RUNNING' ? 'Waiting for async completion callback' : '—')}</div></div>
          <div className="sum-card"><div className="sum-label">Credit score</div><div className="sum-val">{outcomeSummary.credit_score ?? '—'}</div></div>
          <div className="sum-card"><div className="sum-label">Collections</div><div className="sum-val">{outcomeSummary.collection_count ?? '—'}</div></div>
          <div className="sum-card"><div className="sum-label">Creditsafe alerts</div><div className="sum-val">{outcomeSummary.creditsafe_compliance_alert_count ?? '—'}</div></div>
        </div>

        <div className="summary-bar">
          <div className="sum-card"><div className="sum-label">Total latency</div><div className="sum-val">{totalMs}ms</div></div>
          <div className="sum-card"><div className="sum-label">Events</div><div className="sum-val">{evts.length}</div></div>
          <div className="sum-card"><div className="sum-label">Avg connector</div><div className="sum-val">{avgConn}ms</div></div>
          <div className="sum-card"><div className="sum-label">Skipped</div><div className="sum-val">{skipped}</div></div>
        </div>

        <div className="wf-header"><span>Service</span><span>Timeline</span><span style={{ textAlign: 'right' }}>Duration</span></div>

        {laneOrder.filter(l => lanes.has(l)).map(laneName => (
          <div key={laneName}>
            <div className="swimlane-label">{laneName}</div>
            {lanes.get(laneName).map((ev, i) => {
              const leftPct = (ev._offset / totalMs * 100).toFixed(1)
              const widthPct = Math.max(ev._dur / totalMs * 100, 0.8).toFixed(1)
              const isSelected = selEvent?.id === ev.id
              return (
                <div key={ev.id} className={`wf-row${isSelected ? ' selected' : ''}`} onClick={() => setSelEvent(isSelected ? null : ev)}>
                  <div className="wf-svc">
                    <span className="wf-svc-dot" style={{ background: statusColor(ev.status) }} />
                    <span>{ev.service_id || ev.stage}</span>
                  </div>
                  <div className="wf-bar-wrap">
                    <div className="wf-bar" style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: statusColor(ev.status) }} />
                  </div>
                  <div className="wf-dur">{ev._dur}ms</div>
                </div>
              )
            })}
          </div>
        ))}

        <div className="wf-scale" style={{ marginLeft: 130, marginRight: 60 }}>
          <span>0ms</span><span>{Math.round(totalMs / 2)}ms</span><span>{totalMs}ms</span>
        </div>

        {selEvent && (
          <div className="detail-panel">
            <div className="flex-center gap-8 mb-12">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{selEvent.title}</span>
              <span className={`badge ${badgeCls(selEvent.status)}`}>{selEvent.status}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
              <div className="text-sm"><span className="text-muted">Stage: </span>{selEvent.stage}</div>
              <div className="text-sm"><span className="text-muted">Direction: </span>{selEvent.direction}</div>
              <div className="text-sm"><span className="text-muted">Service: </span>{selEvent.service_id || '—'}</div>
              <div className="text-sm"><span className="text-muted">Time: </span>{(selEvent.created_at || '').slice(11, 19)}</div>
            </div>
            {selEvent.payload && Object.keys(selEvent.payload).length > 0 && (
              <pre className="json-view" style={{ maxHeight: 120 }}>{JSON.stringify(selEvent.payload, null, 2)}</pre>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-surface)', borderRadius: 'var(--radius)', padding: '5px 10px', border: '1px solid var(--border)', flex: 1, maxWidth: 280 }}>
          <IconSearch />
          <input value={requestId} onChange={e => setRequestId(e.target.value)} placeholder="Filter by request ID..." style={{ border: 'none', padding: 0, background: 'none', flex: 1, fontSize: 13, boxShadow: 'none' }} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        {['', 'COMPLETED', 'REVIEW', 'REJECTED', 'RUNNING'].map(f => (
          <button key={f} className={`btn btn-xs${filter === f ? ' btn-primary' : ''}`} onClick={() => setFilter(f)}>{f || 'All'}</button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRequestId(''); load('') }}>Reset</button>
          <button className="btn btn-primary btn-sm" onClick={() => load()} style={{ marginLeft: 4 }}>Refresh</button>
        </div>
      </div>

      <div className="master-detail">
        <div className="master-list">
          {filteredGroups.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No tracker events</div>
          ) : filteredGroups.map(g => (
            <div key={g.request_id} className={`master-item${group?.request_id === g.request_id ? ' active' : ''}`} onClick={() => { setSelGroup(g); setSelEvent(null) }}>
              <div className="flex-between" style={{ marginBottom: 4 }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{g.request_id}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{g.time}</span>
              </div>
              <div className="flex-center gap-6">
                <span className={`badge ${badgeCls(g.status)}`}>{(g.status || '').toLowerCase()}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{g.events.length} events</span>
              </div>
            </div>
          ))}
        </div>
        <div className="detail-pane">{renderWaterfall()}</div>
      </div>
    </>
  )
}
