import React, { useEffect, useState, useMemo } from 'react'
import { get } from '../lib/api'

function applicantName(row) {
  return row.applicant_name || [row.applicant_profile?.firstName, row.applicant_profile?.lastName].filter(Boolean).join(' ') || 'Unknown'
}

/* ── Mini gauge arc ── */
function Gauge({ value, max, color, label, sub }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const r = 28, cx = 36, cy = 36
  const arc = 2 * Math.PI * r
  const stroke = arc * 0.75  // 270° arc
  const dash = stroke * pct
  const offset = arc * 0.125 // start at -135deg (bottom-left)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={72} height={56} viewBox="0 0 72 56">
        {/* track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-1)" strokeWidth={6}
          strokeDasharray={`${stroke} ${arc - stroke}`}
          strokeDashoffset={-offset} strokeLinecap="round" transform="rotate(-135 36 36)" />
        {/* fill */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${arc - dash}`}
          strokeDashoffset={-offset} strokeLinecap="round" transform="rotate(-135 36 36)"
          style={{ transition: 'stroke-dasharray 0.6s' }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
          fill="var(--text-1)" fontSize={13} fontWeight={700} fontFamily="monospace">{value}</text>
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textAlign: 'center' }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

/* ── Horizontal bar ── */
function HBar({ label, value, pct, color, mono }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{label}</span>
        <span style={{ fontSize: 11, color, fontFamily: mono ? 'monospace' : undefined, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: 'var(--border-1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(pct)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

/* ── Sparkline (last 24 hours buckets using created_at) ── */
function Sparkline({ requests, color }) {
  const buckets = useMemo(() => {
    const now = Date.now()
    const arr = Array(24).fill(0)
    requests.forEach(r => {
      if (!r.created_at) return
      const age = now - new Date(r.created_at).getTime()
      const h = Math.floor(age / 3600000)
      if (h >= 0 && h < 24) arr[23 - h]++
    })
    return arr
  }, [requests])

  const maxVal = Math.max(...buckets, 1)
  const W = 120, H = 32

  const pts = buckets.map((v, i) => {
    const x = (i / 23) * W
    const y = H - (v / maxVal) * (H - 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {buckets.map((v, i) => {
        if (v === 0) return null
        const x = (i / 23) * W, y = H - (v / maxVal) * (H - 2)
        return <circle key={i} cx={x} cy={y} r={2} fill={color} />
      })}
    </svg>
  )
}

/* ── Decision donut (CSS-only) ── */
function StatusDonut({ approved, rejected, review, total }) {
  if (total === 0) return <div style={{ fontSize: 11, color: 'var(--text-3)' }}>No data</div>
  const segments = [
    { label: 'Approved', val: approved, color: 'var(--green)'  },
    { label: 'Rejected', val: rejected, color: 'var(--red)'    },
    { label: 'Review',   val: review,   color: 'var(--amber)'  },
    { label: 'Other',    val: total - approved - rejected - review, color: 'var(--border-1)' },
  ].filter(s => s.val > 0)

  let offset = 0
  const r = 24, cx = 28, cy = 28, circ = 2 * Math.PI * r

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={56} height={56}>
        {segments.map((seg, i) => {
          const pct = seg.val / total
          const dash = circ * pct
          const curr = offset
          offset += pct
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={8}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={circ * (0.25 - curr)}
            />
          )
        })}
        <circle cx={cx} cy={cy} r={17} fill="var(--bg-1)" />
        <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle"
          fill="var(--text-1)" fontSize={10} fontWeight={700} fontFamily="monospace">
          {total}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            {seg.label}: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-1)' }}>{seg.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [services,   setServices]   = useState([])
  const [requests,   setRequests]   = useState([])
  const [flowHealth, setFlowHealth] = useState(null)
  const [warn,       setWarn]       = useState('')

  useEffect(() => {
    get('/api/v1/services').then(d => setServices(d.items || [])).catch(() => {})
    get('/api/v1/requests').then(d => setRequests(d.items || [])).catch(e => setWarn(e.message))
    get('/api/v1/flowable/health').then(setFlowHealth).catch(() => {})
  }, [])

  const stats = useMemo(() => {
    const total = requests.length
    const byS = {}
    requests.forEach(r => { byS[r.status] = (byS[r.status] || 0) + 1 })
    const completed  = byS['COMPLETED'] || 0
    const approved   = byS['COMPLETED'] || 0  // platform-level completion
    const rejected   = byS['REJECTED'] || 0
    const failed     = (byS['FAILED'] || 0) + (byS['ENGINE_ERROR'] || 0) + (byS['ORPHANED'] || 0)
    const review     = byS['REVIEW'] || 0
    const running    = byS['RUNNING'] || 0
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0
    const needsAction = requests.filter(r => r.needs_operator_action).length
    return { total, completed, approved, rejected, failed, review, running, successRate, needsAction, byS }
  }, [requests])

  const enabledSvc  = services.filter(s => s.enabled).length
  const engineUp    = flowHealth?.status === 'UP'
  const recentFailed = useMemo(() => requests.filter(r => ['FAILED','ENGINE_ERROR','ORPHANED'].includes(r.status)).slice(0, 6), [requests])

  return (
    <>
      <style>{`
        @keyframes db-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        .db-grid-5 { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; margin-bottom:16px; }
        .db-stat { background:var(--bg-1); border:1px solid var(--border-1); border-radius:8px; padding:10px 12px; position:relative; overflow:hidden; }
        .db-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; }
        .db-stat.green::before { background:var(--green); }
        .db-stat.blue::before  { background:var(--blue);  }
        .db-stat.red::before   { background:var(--red);   }
        .db-stat.amber::before { background:var(--amber); }
        .db-stat.purple::before{ background:var(--purple,#a78bfa); }
        .db-stat-lbl { font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.7px; margin-bottom:4px; }
        .db-stat-val { font-size:22px; font-weight:800; font-family:monospace; line-height:1; }
        .db-stat-sub { font-size:9px; color:var(--text-3); margin-top:2px; }
        .db-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
        .db-grid-3 { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; margin-bottom:12px; }
        .db-engine-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; animation:db-pulse 2s infinite; }
      `}</style>

      {warn && <div className="notice mb-12">{warn}</div>}

      {/* ── KPI row ── */}
      <div className="db-grid-5">
        <div className="db-stat blue">
          <div className="db-stat-lbl">Total requests</div>
          <div className="db-stat-val" style={{ color: 'var(--blue)' }}>{stats.total}</div>
          <Sparkline requests={requests} color="var(--blue)" />
        </div>
        <div className="db-stat green">
          <div className="db-stat-lbl">Completed</div>
          <div className="db-stat-val" style={{ color: 'var(--green)' }}>{stats.completed}</div>
          <div className="db-stat-sub">{stats.successRate}% success rate</div>
        </div>
        <div className={`db-stat ${stats.failed > 0 ? 'red' : 'green'}`}>
          <div className="db-stat-lbl">Errors</div>
          <div className="db-stat-val" style={{ color: stats.failed > 0 ? 'var(--red)' : 'var(--green)' }}>{stats.failed}</div>
          <div className="db-stat-sub">{stats.total > 0 ? `${Math.round(stats.failed/stats.total*100)}% error rate` : 'no data'}</div>
        </div>
        <div className="db-stat amber">
          <div className="db-stat-lbl">Needs review</div>
          <div className="db-stat-val" style={{ color: 'var(--amber)' }}>{stats.review}</div>
          {stats.needsAction > 0 && <div className="db-stat-sub" style={{ color: 'var(--amber)' }}>⚠ {stats.needsAction} needs action</div>}
        </div>
        <div className="db-stat blue">
          <div className="db-stat-lbl">Running now</div>
          <div className="db-stat-val" style={{ color: 'var(--blue)' }}>{stats.running}</div>
          <div className="db-stat-sub">{engineUp ? '● engine up' : '○ engine down'}</div>
        </div>
        <div className={`db-stat ${enabledSvc === services.length && services.length > 0 ? 'green' : 'amber'}`}>
          <div className="db-stat-lbl">Services up</div>
          <div className="db-stat-val" style={{ color: enabledSvc === services.length && services.length > 0 ? 'var(--green)' : 'var(--amber)' }}>
            {enabledSvc}/{services.length}
          </div>
          <div className="db-stat-sub">{services.length - enabledSvc > 0 ? `${services.length - enabledSvc} offline` : 'all healthy'}</div>
        </div>
      </div>

      {/* ── Row 2: status breakdown + gauges + engine ── */}
      <div className="db-grid-3">
        {/* Status distribution */}
        <div className="card">
          <div className="card-title">Request distribution</div>
          <StatusDonut
            approved={stats.completed}
            rejected={stats.rejected}
            review={stats.review}
            total={stats.total}
          />
        </div>

        {/* Throughput gauges */}
        <div className="card">
          <div className="card-title">Throughput metrics</div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around', flexWrap: 'wrap' }}>
            <Gauge value={stats.completed} max={stats.total} color="var(--green)" label="Completed" sub={`${stats.successRate}%`} />
            <Gauge value={stats.failed} max={stats.total} color="var(--red)" label="Failed"
              sub={stats.total > 0 ? `${Math.round(stats.failed/stats.total*100)}%` : '0%'} />
            <Gauge value={stats.review} max={stats.total} color="var(--amber)" label="Review"
              sub={stats.total > 0 ? `${Math.round(stats.review/stats.total*100)}%` : '0%'} />
          </div>
        </div>

        {/* Engine health */}
        <div className="card">
          <div className="card-title">
            <span className="db-engine-dot" style={{ background: engineUp ? 'var(--green)' : 'var(--red)' }} />
            Flowable engine
          </div>
          {flowHealth ? (
            <>
              {[
                { k: 'Status',         v: flowHealth.status,                                   c: engineUp ? 'var(--green)' : 'var(--red)' },
                { k: 'Async executor', v: flowHealth.async_executor?.running ? 'ACTIVE' : 'INACTIVE', c: flowHealth.async_executor?.running ? 'var(--green)' : 'var(--amber)' },
                { k: 'Dead letter',    v: String(flowHealth.dead_jobs || 0),                   c: (flowHealth.dead_jobs||0) > 0 ? 'var(--red)' : 'var(--green)' },
                { k: 'Version',        v: flowHealth.version || flowHealth.release || '—' },
                { k: 'Database',       v: flowHealth.database?.type || 'PostgreSQL' },
              ].map(({ k, v, c }) => (
                <div key={k} className="kv-row" style={{ padding: '4px 0' }}>
                  <span className="kv-key">{k}</span>
                  <span className="kv-val" style={c ? { color: c, fontWeight: 700 } : {}}>{v}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="text-muted text-sm">Connecting…</p>
          )}
        </div>
      </div>

      {/* ── Row 3: Status bars + services + recent failures ── */}
      <div className="db-grid-2">
        {/* Status breakdown bars */}
        <div className="card">
          <div className="card-title">Status breakdown</div>
          {[
            { label: 'Completed',    val: stats.completed, color: 'var(--green)'  },
            { label: 'Failed/Error', val: stats.failed,    color: 'var(--red)'    },
            { label: 'Review',       val: stats.review,    color: 'var(--amber)'  },
            { label: 'Running',      val: stats.running,   color: 'var(--blue)'   },
            { label: 'Rejected',     val: stats.rejected || 0, color: 'var(--red)' },
          ].map(({ label, val, color }) => (
            <HBar key={label} label={label} value={val}
              pct={stats.total > 0 ? (val / stats.total) * 100 : 0}
              color={color} mono />
          ))}
        </div>

        {/* Services health grid */}
        <div className="card">
          <div className="card-title">Services health</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {services.length === 0 ? (
              <p className="text-muted text-sm">No services configured</p>
            ) : services.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border-1)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.enabled ? 'var(--green)' : 'var(--red)', flexShrink: 0, boxShadow: s.enabled ? '0 0 4px var(--green)' : 'none' }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-1)', flex: 1 }}>{s.id}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.type}</span>
                {!s.enabled && <span className="badge badge-red" style={{ fontSize: 8 }}>offline</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 4: Recent failures + recent requests ── */}
      <div className="db-grid-2">
        <div className="card">
          <div className="card-title">
            {recentFailed.length > 0 ? <span style={{ color: 'var(--red)', marginRight: 6 }}>⚠</span> : null}
            Recent failures
          </div>
          {recentFailed.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--green)' }}>✓ No recent failures</p>
          ) : (
            <table className="tbl" style={{ fontSize: 11 }}>
              <thead><tr><th>Request ID</th><th>Status</th><th>Applicant</th><th>Time</th></tr></thead>
              <tbody>
                {recentFailed.map(r => (
                  <tr key={r.request_id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{r.request_id}</td>
                    <td><span className="badge badge-red" style={{ fontSize: 9 }}>{r.status.toLowerCase()}</span></td>
                    <td>{applicantName(r)}</td>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{(r.created_at||'').slice(11,19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">Recent requests</div>
          <table className="tbl" style={{ fontSize: 11 }}>
            <thead><tr><th>ID</th><th>Applicant</th><th>Mode</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              {requests.slice(0, 7).map(r => (
                <tr key={r.request_id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{r.request_id}</td>
                  <td>{applicantName(r)}</td>
                  <td><span className={`badge ${r.orchestration_mode === 'flowable' ? 'badge-blue' : 'badge-purple'}`} style={{ fontSize: 9 }}>{r.orchestration_mode}</span></td>
                  <td>
                    <span className={`badge ${['COMPLETED'].includes(r.status)?'badge-green':['FAILED','ENGINE_ERROR'].includes(r.status)?'badge-red':['REVIEW'].includes(r.status)?'badge-amber':'badge-blue'}`} style={{ fontSize: 9 }}>
                      {r.status?.toLowerCase()}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-3)' }}>{(r.created_at||'').slice(11,19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
