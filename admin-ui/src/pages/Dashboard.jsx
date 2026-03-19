import { useCallback, useEffect, useMemo, useState } from 'react'
import { get } from '../lib/api'

function applicantName(row) {
  return row.applicant_name || [row.applicant_profile?.firstName, row.applicant_profile?.lastName].filter(Boolean).join(' ') || 'Unknown'
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function toIso(date, end = false) {
  if (!date) return ''
  return new Date(date + (end ? 'T23:59:59' : 'T00:00:00')).toISOString()
}

/* ── Horizontal bar ── */
function HBar({ label, value, pct, color }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{label}</span>
        <span style={{ fontSize: 11, color, fontFamily: 'monospace', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 3, background: 'var(--border-1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(pct)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

/* ── Volume chart (hourly buckets) ── */
function VolumeChart({ requests }) {
  const buckets = useMemo(() => {
    const arr = Array(24).fill(0)
    const now = Date.now()
    requests.forEach(r => {
      if (!r.created_at) return
      const age = now - new Date(r.created_at).getTime()
      const h = Math.floor(age / 3_600_000)
      if (h >= 0 && h < 24) arr[23 - h]++
    })
    return arr
  }, [requests])

  const maxV = Math.max(...buckets, 1)
  const W = 480, H = 48
  const bw = W / 24 - 1

  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
      {buckets.map((v, i) => {
        const barH = v > 0 ? Math.max(3, (v / maxV) * H) : 0
        const x = i * (bw + 1)
        const col = v === 0 ? 'var(--border-1)' : 'var(--blue)'
        return (
          <g key={i}>
            <rect x={x} y={H - barH} width={bw} height={barH} fill={col} rx={1} opacity={0.85} />
            {v > 0 && (
              <text x={x + bw / 2} y={H - barH - 2} textAnchor="middle" fill="var(--text-3)" fontSize={7}>{v}</text>
            )}
          </g>
        )
      })}
      {[0, 6, 12, 18, 23].map(i => (
        <text key={i} x={i * (bw + 1) + bw / 2} y={H + 12} textAnchor="middle" fill="var(--text-3)" fontSize={7}>
          {String(new Date(Date.now() - (23 - i) * 3_600_000).getHours()).padStart(2, '0')}h
        </text>
      ))}
    </svg>
  )
}

/* ── Decision donut ── */
function StatusDonut({ approved, rejected, review, other }) {
  const total = approved + rejected + review + other
  if (total === 0) return <div style={{ fontSize: 11, color: 'var(--text-3)' }}>No data</div>
  const segs = [
    { label: 'Approved', val: approved, color: 'var(--green)' },
    { label: 'Rejected', val: rejected, color: 'var(--red)' },
    { label: 'Review',   val: review,   color: 'var(--amber)' },
    { label: 'Other',    val: other,    color: 'var(--border-1)' },
  ].filter(s => s.val > 0)

  let off = 0
  const r = 24, cx = 28, cy = 28, circ = 2 * Math.PI * r

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={56} height={56} style={{ flexShrink: 0 }}>
        {segs.map((s, i) => {
          const pct = s.val / total
          const dash = circ * pct
          const curr = off; off += pct
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={8}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ * (0.25 - curr)} />
        })}
        <circle cx={cx} cy={cy} r={17} fill="var(--bg-1)" />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          fill="var(--text-1)" fontSize={10} fontWeight={700} fontFamily="monospace">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {segs.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span>{s.label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-1)' }}>{s.val}</span>
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{Math.round(s.val / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Sparkline ── */
function Sparkline({ requests, color }) {
  const buckets = useMemo(() => {
    const arr = Array(24).fill(0)
    const now = Date.now()
    requests.forEach(r => {
      if (!r.created_at) return
      const h = Math.floor((now - new Date(r.created_at).getTime()) / 3_600_000)
      if (h >= 0 && h < 24) arr[23 - h]++
    })
    return arr
  }, [requests])
  const maxV = Math.max(...buckets, 1)
  const W = 100, H = 26
  const pts = buckets.map((v, i) => `${(i / 23) * W},${H - (v / maxV) * (H - 2)}`).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

const PRESETS = [
  { id: 'today',     label: 'Today'     },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d',        label: '7 days'    },
  { id: '30d',       label: '30 days'   },
  { id: 'all',       label: 'All time'  },
]

export default function Dashboard() {
  const [preset,     setPreset]     = useState('today')
  const [dateFrom,   setDateFrom]   = useState(todayStr)
  const [dateTo,     setDateTo]     = useState('')
  const [requests,   setRequests]   = useState([])
  const [flowHealth, setFlowHealth] = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [warn,       setWarn]       = useState('')

  const loadData = useCallback((f = dateFrom, t = dateTo) => {
    setLoading(true)
    const p = new URLSearchParams()
    if (f) p.set('created_from', toIso(f, false))
    if (t) p.set('created_to',   toIso(t, true))
    get(`/api/v1/requests${p.toString() ? `?${p}` : ''}`)
      .then(d => { setRequests(d.items || []); setWarn('') })
      .catch(e => setWarn(e.message))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo])

  useEffect(() => {
    loadData(todayStr(), '')
    get('/api/v1/flowable/health').then(setFlowHealth).catch(() => {})
  }, [])

  const applyPreset = (p) => {
    setPreset(p)
    const now = new Date()
    let f = '', t = ''
    if (p === 'today') {
      f = todayStr()
    } else if (p === 'yesterday') {
      const d = new Date(now); d.setDate(d.getDate() - 1)
      f = t = d.toISOString().slice(0, 10)
    } else if (p === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 7)
      f = d.toISOString().slice(0, 10)
    } else if (p === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 30)
      f = d.toISOString().slice(0, 10)
    }
    setDateFrom(f); setDateTo(t)
    loadData(f, t)
  }

  const stats = useMemo(() => {
    const total    = requests.length
    const byS      = {}
    requests.forEach(r => { byS[r.status] = (byS[r.status] || 0) + 1 })
    const completed = byS['COMPLETED'] || 0
    const approved  = requests.filter(r => {
      const d = r.result?.decision || r.result?.summary?.decision
      return d === 'APPROVED'
    }).length
    const rejected  = requests.filter(r => {
      const d = r.result?.decision || r.result?.summary?.decision
      return d === 'REJECTED'
    }).length
    const review    = byS['REVIEW'] || 0
    const running   = byS['RUNNING'] || 0
    const failed    = (byS['FAILED'] || 0) + (byS['ENGINE_ERROR'] || 0) + (byS['ORPHANED'] || 0)
    const needsAction = requests.filter(r => r.needs_operator_action).length
    const successRate  = total > 0 ? Math.round(completed / total * 100) : 0
    const approvalRate = (approved + rejected) > 0 ? Math.round(approved / (approved + rejected) * 100) : 0
    const other = total - completed - review - running - failed
    return { total, completed, approved, rejected, review, running, failed, needsAction, successRate, approvalRate, other: Math.max(0, other), byS }
  }, [requests])

  const engineUp     = flowHealth?.status === 'UP'
  const recentFailed = useMemo(() => requests.filter(r => ['FAILED','ENGINE_ERROR','ORPHANED'].includes(r.status)).slice(0, 8), [requests])

  return (
    <>
      <style>{`
        @keyframes db-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        .db-filter-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:14px; padding:8px 12px; background:var(--bg-1); border:1px solid var(--border-1); border-radius:8px; }
        .db-preset { padding:3px 10px; border-radius:4px; border:1px solid var(--border-1); background:transparent; color:var(--text-3); font-size:10px; font-weight:700; cursor:pointer; transition:all 0.1s; }
        .db-preset.active { background:var(--blue); color:#fff; border-color:var(--blue); }
        .db-preset:hover:not(.active) { color:var(--text-1); }
        .db-date-sep { font-size:11px; color:var(--text-3); }
        .db-date { padding:3px 7px; border-radius:4px; border:1px solid var(--border-1); background:var(--bg-2); color:var(--text-2); font-size:11px; outline:none; }
        .db-date:focus { border-color:var(--blue); }
        .db-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; margin-bottom:14px; }
        .db-stat { background:var(--bg-1); border:1px solid var(--border-1); border-radius:8px; padding:10px 12px; position:relative; overflow:hidden; }
        .db-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; }
        .db-stat.green::before { background:var(--green); }
        .db-stat.blue::before  { background:var(--blue);  }
        .db-stat.red::before   { background:var(--red);   }
        .db-stat.amber::before { background:var(--amber); }
        .db-stat-lbl { font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.7px; margin-bottom:4px; }
        .db-stat-val { font-size:22px; font-weight:800; font-family:monospace; line-height:1; }
        .db-stat-sub { font-size:9px; color:var(--text-3); margin-top:3px; }
        .db-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
        .db-row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px; }
        .db-row2-3 { display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px; }
        .db-engine-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; animation:db-pulse 2s infinite; }
        .db-fail-tbl { width:100%; border-collapse:collapse; font-size:11px; }
        .db-fail-tbl th { padding:4px 8px; text-align:left; font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid var(--border-1); }
        .db-fail-tbl td { padding:4px 8px; border-bottom:1px solid color-mix(in srgb,var(--border-1) 50%,transparent); }
        .db-fail-tbl tr:last-child td { border-bottom:none; }
        .db-vol-card { background:var(--bg-1); border:1px solid var(--border-1); border-radius:8px; padding:10px 12px; margin-bottom:12px; }
        .db-vol-title { font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:8px; }
      `}</style>

      {warn && <div className="notice mb-12">{warn}</div>}

      {/* ── Filter bar ── */}
      <div className="db-filter-bar">
        {PRESETS.map(p => (
          <button key={p.id} className={`db-preset${preset === p.id ? ' active' : ''}`} onClick={() => applyPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <span className="db-date-sep" style={{ marginLeft: 4 }}>From</span>
        <input type="date" className="db-date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset('') }} />
        <span className="db-date-sep">—</span>
        <input type="date" className="db-date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset('') }} />
        <button className="btn btn-primary btn-sm" onClick={() => loadData()}>Apply</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          {loading ? '⏳ Loading…' : `${stats.total} requests`}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => loadData()}>↻ Refresh</button>
      </div>

      {/* ── KPI row ── */}
      <div className="db-grid">
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
        <div className="db-stat green">
          <div className="db-stat-lbl">Approved</div>
          <div className="db-stat-val" style={{ color: 'var(--green)' }}>{stats.approved}</div>
          <div className="db-stat-sub">{stats.approvalRate}% approval rate</div>
        </div>
        <div className="db-stat red">
          <div className="db-stat-lbl">Rejected</div>
          <div className="db-stat-val" style={{ color: 'var(--red)' }}>{stats.rejected}</div>
          <div className="db-stat-sub">{stats.total > 0 ? `${Math.round(stats.rejected / stats.total * 100)}% of total` : '—'}</div>
        </div>
        <div className="db-stat amber">
          <div className="db-stat-lbl">Review</div>
          <div className="db-stat-val" style={{ color: 'var(--amber)' }}>{stats.review}</div>
          {stats.needsAction > 0 && <div className="db-stat-sub" style={{ color: 'var(--amber)' }}>⚠ {stats.needsAction} needs action</div>}
        </div>
        <div className={`db-stat ${stats.failed > 0 ? 'red' : 'green'}`}>
          <div className="db-stat-lbl">Errors</div>
          <div className="db-stat-val" style={{ color: stats.failed > 0 ? 'var(--red)' : 'var(--green)' }}>{stats.failed}</div>
          <div className="db-stat-sub">{stats.total > 0 ? `${Math.round(stats.failed / stats.total * 100)}% error rate` : 'no errors'}</div>
        </div>
        <div className="db-stat blue">
          <div className="db-stat-lbl">Running now</div>
          <div className="db-stat-val" style={{ color: 'var(--blue)' }}>{stats.running}</div>
          <div className="db-stat-sub">{engineUp ? '● engine up' : '○ engine down'}</div>
        </div>
      </div>

      {/* ── Volume chart ── */}
      {preset === 'today' || preset === '' ? (
        <div className="db-vol-card">
          <div className="db-vol-title">Hourly volume — last 24 hours</div>
          <VolumeChart requests={requests} />
        </div>
      ) : null}

      {/* ── Row 2: decision donut + status bars + engine ── */}
      <div className="db-row3">
        <div className="card">
          <div className="card-title">Decision distribution</div>
          <StatusDonut
            approved={stats.approved}
            rejected={stats.rejected}
            review={stats.review}
            other={stats.other}
          />
        </div>

        <div className="card">
          <div className="card-title">Status breakdown</div>
          {[
            { label: 'Completed',  val: stats.completed, color: 'var(--green)'  },
            { label: 'Approved',   val: stats.approved,  color: 'var(--green)'  },
            { label: 'Rejected',   val: stats.rejected,  color: 'var(--red)'    },
            { label: 'Review',     val: stats.review,    color: 'var(--amber)'  },
            { label: 'Failed',     val: stats.failed,    color: 'var(--red)'    },
            { label: 'Running',    val: stats.running,   color: 'var(--blue)'   },
          ].map(({ label, val, color }) => (
            <HBar key={label} label={label} value={val}
              pct={stats.total > 0 ? val / stats.total * 100 : 0}
              color={color} />
          ))}
        </div>

        <div className="card">
          <div className="card-title">
            <span className="db-engine-dot" style={{ background: engineUp ? 'var(--green)' : 'var(--red)' }} />
            Flowable engine
          </div>
          {flowHealth ? (
            <>
              {[
                { k: 'Status',      v: flowHealth.status,   c: engineUp ? 'var(--green)' : 'var(--red)' },
                { k: 'Async exec',  v: flowHealth.async_executor?.running ? 'ACTIVE' : 'INACTIVE', c: flowHealth.async_executor?.running ? 'var(--green)' : 'var(--amber)' },
                { k: 'Dead jobs',   v: String(flowHealth.dead_jobs || 0), c: (flowHealth.dead_jobs || 0) > 0 ? 'var(--red)' : 'var(--green)' },
                { k: 'Version',     v: flowHealth.version || flowHealth.release || '—' },
                { k: 'Database',    v: flowHealth.database?.type || 'PostgreSQL' },
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

      {/* ── Recent failures ── */}
      <div className="card">
        <div className="card-title">
          {recentFailed.length > 0 && <span style={{ color: 'var(--red)', marginRight: 6 }}>⚠</span>}
          Recent failures
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>{recentFailed.length} shown</span>
        </div>
        {recentFailed.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--green)' }}>✓ No failures in selected period</p>
        ) : (
          <table className="db-fail-tbl">
            <thead>
              <tr><th>Request ID</th><th>Applicant</th><th>Status</th><th>Decision</th><th>Time</th></tr>
            </thead>
            <tbody>
              {recentFailed.map(r => (
                <tr key={r.request_id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.request_id}</td>
                  <td style={{ color: 'var(--text-2)' }}>{applicantName(r)}</td>
                  <td><span className="badge badge-red" style={{ fontSize: 9 }}>{r.status.toLowerCase()}</span></td>
                  <td>{r.result?.decision && <span style={{ fontSize: 10, color: r.result.decision === 'APPROVED' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{r.result.decision}</span>}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-3)' }}>{(r.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
