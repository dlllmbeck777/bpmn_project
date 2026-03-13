import { useEffect, useMemo, useState } from 'react'

import Modal from '../components/Modal'
import { get } from '../lib/api'

const FINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'REVIEW'])

function timeLabel(value) {
  return value ? String(value).slice(11, 19) : '--:--:--'
}

function payloadPreview(payload) {
  try {
    const text = JSON.stringify(payload)
    return text.length > 120 ? `${text.slice(0, 120)}...` : text
  } catch {
    return String(payload)
  }
}

function shapeForItem(item) {
  if (item.stage === 'gateway' && item.direction === 'IN') return 'start'
  if (item.stage === 'request' && (FINAL_STATUSES.has(item.status) || String(item.title || '').toLowerCase().includes('finalized'))) return 'end'
  if (item.stage === 'routing' || String(item.stage || '').startsWith('stop_factor')) return 'gateway'
  return 'task'
}

function toneForItem(item) {
  const normalized = String(item.status || '').toUpperCase()
  if (normalized === 'COMPLETED' || normalized === 'PASS' || normalized === 'OK') return 'success'
  if (normalized === 'SKIPPED' || normalized === 'REVIEW' || normalized === 'RUNNING') return 'warn'
  if (normalized === 'FAILED' || normalized === 'REJECTED' || normalized === 'UNAVAILABLE') return 'danger'
  return item.direction === 'OUT' ? 'out' : item.direction === 'IN' ? 'in' : 'neutral'
}

function stageLabel(item) {
  if (item.service_id) return item.service_id
  return item.stage
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    const leftTime = new Date(left.created_at || 0).getTime()
    const rightTime = new Date(right.created_at || 0).getTime()
    if (leftTime !== rightTime) return leftTime - rightTime
    return (left.id || 0) - (right.id || 0)
  })
}

export default function ProcessTrackerPage() {
  const [items, setItems] = useState([])
  const [requestId, setRequestId] = useState('')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  const load = async (filter = requestId) => {
    try {
      const query = filter ? `?request_id=${encodeURIComponent(filter)}` : ''
      const data = await get(`/api/v1/process-tracker${query}`)
      setItems(data.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load('') }, [])

  const grouped = useMemo(() => {
    const groups = new Map()
    for (const item of items) {
      const key = item.request_id || 'unknown'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return Array.from(groups.entries())
      .map(([key, events]) => ({
        request_id: key,
        events: sortEvents(events),
      }))
      .sort((left, right) => {
        const leftLast = left.events[left.events.length - 1]?.created_at || ''
        const rightLast = right.events[right.events.length - 1]?.created_at || ''
        return new Date(rightLast).getTime() - new Date(leftLast).getTime()
      })
  }, [items])

  return (
    <>
      {error && <div className="notice mb-16">{error}</div>}
      <div className="card mb-16">
        <div className="tracker-toolbar">
          <div className="form-row tracker-filter">
            <label>Request ID Filter</label>
            <input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="REQ-2026-0001" />
          </div>
          <div className="form-actions tracker-actions">
            <button className="btn btn-ghost" onClick={() => { setRequestId(''); load('') }}>Reset</button>
            <button className="btn btn-primary" onClick={() => load()}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="notice mb-16">Tracker now renders as a process scheme: start/end events, routing and stop-factor gateways, and task boxes for adapters, connectors, parser and finalization.</div>

      <div className="tracker-legend mb-16">
        <span className="badge badge-blue">OUT</span>
        <span className="badge badge-green">IN</span>
        <span className="badge badge-orange">STATE</span>
      </div>

      {grouped.length === 0 ? (
        <div className="card"><p className="muted-copy">No tracker events yet.</p></div>
      ) : (
        <div className="tracker-request-grid">
          {grouped.map((group) => (
            <div className="card tracker-request-card" key={group.request_id}>
              <div className="flex-between mb-16">
                <div>
                  <div className="card-title" style={{ marginBottom: 4 }}><span className="dot dot-blue" /> {group.request_id}</div>
                  <div className="muted-copy">{group.events.length} event(s)</div>
                </div>
                <div className="mono">{timeLabel(group.events[0]?.created_at)} -> {timeLabel(group.events[group.events.length - 1]?.created_at)}</div>
              </div>

              <div className="tracker-flow-canvas">
                {group.events.map((item, index) => {
                  const shape = shapeForItem(item)
                  const tone = toneForItem(item)
                  return (
                    <div className="tracker-flow-segment" key={item.id}>
                      {index > 0 && <div className="tracker-flow-arrow" />}
                      <button className={`tracker-bpmn tracker-bpmn-${shape} tracker-bpmn-${tone}`} onClick={() => setSelected(item)}>
                        <span className="tracker-bpmn-inner">
                          <span className="tracker-bpmn-time mono">{timeLabel(item.created_at)}</span>
                          <span className="tracker-bpmn-title">{item.title}</span>
                          <span className="tracker-bpmn-meta mono">{stageLabel(item)}</span>
                          <span className="tracker-bpmn-status">{item.status || item.direction}</span>
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <Modal title={`${selected.request_id} · ${selected.title}`} onClose={() => setSelected(null)}>
          <div className="tracker-detail-meta mb-16">
            <span className={`badge ${selected.direction === 'OUT' ? 'badge-blue' : selected.direction === 'IN' ? 'badge-green' : 'badge-orange'}`}>{selected.direction}</span>
            <span className="badge badge-gray">{selected.status || '-'}</span>
            <span className="mono">{stageLabel(selected)}</span>
          </div>
          <div className="tracker-meta-line">Preview: {payloadPreview(selected.payload)}</div>
          <pre className="json-view mt-16">{JSON.stringify(selected, null, 2)}</pre>
        </Modal>
      )}
    </>
  )
}
