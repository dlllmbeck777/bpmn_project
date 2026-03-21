import { useEffect, useState, useCallback } from 'react'
import { get, put } from '../lib/api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const SVC_LABELS = { 'ai-prescreen': 'AI Pre-Screen', 'ai-advisor': 'AI Advisor' }
const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 days' },
  { id: '30d',   label: '30 days' },
  { id: 'all',   label: 'All time' },
]

function fmtCost(v) {
  const n = Number(v) || 0
  if (n === 0) return '$0.00'
  if (n < 0.001) return `$${n.toFixed(6)}`
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}
function fmtNum(v) { return (Number(v) || 0).toLocaleString() }

const css = `
  .ai-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; margin-bottom:20px; }
  .ai-kpi { background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:14px 16px; }
  .ai-kpi-lbl { font-size:10px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }
  .ai-kpi-val { font-size:22px; font-weight:800; font-family:monospace; color:var(--text-1); }
  .ai-kpi-sub { font-size:11px; color:var(--text-3); margin-top:2px; }
  .ai-budget-card { background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:12px; }
  .ai-budget-header { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .ai-budget-svc { font-size:13px; font-weight:700; color:var(--text-1); font-family:monospace; }
  .ai-budget-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap; }
  .ai-budget-lbl { font-size:11px; color:var(--text-2); width:140px; flex-shrink:0; }
  .ai-budget-inp { width:120px; padding:4px 8px; border-radius:5px; border:1px solid var(--border); background:var(--bg-inset); color:var(--text-1); font-size:12px; font-family:monospace; }
  .ai-budget-inp:focus { outline:none; border-color:var(--blue); }
  .ai-progress { height:6px; border-radius:3px; background:var(--bg-inset); overflow:hidden; margin-top:4px; }
  .ai-progress-bar { height:100%; border-radius:3px; transition:width .3s; }
  .ai-tbl { width:100%; border-collapse:collapse; font-size:11px; }
  .ai-tbl th { padding:5px 8px; text-align:left; font-size:9px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:.5px; background:var(--bg-inset); border-bottom:1px solid var(--border); }
  .ai-tbl td { padding:4px 8px; border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent); vertical-align:middle; }
  .ai-tbl tr:last-child td { border-bottom:none; }
  .ai-status-ok { color:var(--green); font-weight:700; }
  .ai-status-fallback { color:var(--amber); font-weight:700; }
  .ai-status-budget { color:var(--red); font-weight:700; }
`

function BudgetCard({ item, onSave }) {
  const [daily,   setDaily]   = useState(item.daily_budget_usd   ?? '')
  const [monthly, setMonthly] = useState(item.monthly_budget_usd ?? '')
  const [enabled, setEnabled] = useState(item.budget_enabled ?? false)
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')

  const totalBudgetDay = Number(daily) || 0
  const totalBudgetMon = Number(monthly) || 0
  const pctDay = totalBudgetDay > 0 ? Math.min(100, (item.today_usd / totalBudgetDay) * 100) : 0
  const pctMon = totalBudgetMon > 0 ? Math.min(100, (item.month_usd / totalBudgetMon) * 100) : 0
  const barColor = (pct) => pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)'

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await put(`/api/v1/ai/budget/${item.service_id}`, {
        budget_enabled:     enabled,
        daily_budget_usd:   daily !== '' ? Number(daily) : null,
        monthly_budget_usd: monthly !== '' ? Number(monthly) : null,
      })
      onSave()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="ai-budget-card">
      <div className="ai-budget-header">
        <span className="ai-budget-svc">{item.service_id}</span>
        <span style={{fontSize:11,color:'var(--text-3)'}}>{SVC_LABELS[item.service_id]}</span>
        <span className={`badge ${item.enabled ? 'badge-green' : 'badge-gray'}`} style={{fontSize:9,marginLeft:'auto'}}>
          {item.enabled ? 'enabled' : 'disabled'}
        </span>
        <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,cursor:'pointer'}}>
          <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} style={{width:'auto'}}/>
          Enforce budget
        </label>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:12}}>
        <div>
          <div style={{fontSize:10,color:'var(--text-3)',marginBottom:2}}>Today spent</div>
          <div style={{fontSize:16,fontWeight:700,fontFamily:'monospace',color:pctDay>=90?'var(--red)':pctDay>=70?'var(--amber)':'var(--text-1)'}}>{fmtCost(item.today_usd)}</div>
          {totalBudgetDay > 0 && <>
            <div className="ai-progress"><div className="ai-progress-bar" style={{width:`${pctDay}%`,background:barColor(pctDay)}}/></div>
            <div style={{fontSize:9,color:'var(--text-3)',marginTop:2}}>{pctDay.toFixed(1)}% of ${totalBudgetDay} daily limit</div>
          </>}
        </div>
        <div>
          <div style={{fontSize:10,color:'var(--text-3)',marginBottom:2}}>This month</div>
          <div style={{fontSize:16,fontWeight:700,fontFamily:'monospace',color:pctMon>=90?'var(--red)':pctMon>=70?'var(--amber)':'var(--text-1)'}}>{fmtCost(item.month_usd)}</div>
          {totalBudgetMon > 0 && <>
            <div className="ai-progress"><div className="ai-progress-bar" style={{width:`${pctMon}%`,background:barColor(pctMon)}}/></div>
            <div style={{fontSize:9,color:'var(--text-3)',marginTop:2}}>{pctMon.toFixed(1)}% of ${totalBudgetMon} monthly limit</div>
          </>}
        </div>
      </div>

      <div className="ai-budget-row">
        <span className="ai-budget-lbl">Daily limit (USD)</span>
        <input className="ai-budget-inp" type="number" step="0.01" min="0" value={daily}
          onChange={e=>setDaily(e.target.value)} placeholder="no limit" disabled={!enabled}/>
      </div>
      <div className="ai-budget-row">
        <span className="ai-budget-lbl">Monthly limit (USD)</span>
        <input className="ai-budget-inp" type="number" step="0.1" min="0" value={monthly}
          onChange={e=>setMonthly(e.target.value)} placeholder="no limit" disabled={!enabled}/>
      </div>

      {err && <div className="notice notice-error mt-8">{err}</div>}
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:10}}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </div>
    </div>
  )
}

export default function AiControlPage() {
  const [period,  setPeriod]  = useState('30d')
  const [usage,   setUsage]   = useState(null)
  const [budget,  setBudget]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const load = useCallback(async (p = period) => {
    setLoading(true)
    try {
      const [u, b] = await Promise.all([
        get(`/api/v1/ai/usage?period=${p}`),
        get('/api/v1/ai/budget'),
      ])
      setUsage(u); setBudget(b.items || [])
      setError('')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [period])

  useEffect(() => { load(period) }, [period]) // eslint-disable-line

  const changePeriod = (p) => { setPeriod(p); load(p) }

  // Aggregate summary
  const summary = (usage?.summary || []).reduce((acc, r) => {
    acc.calls    += Number(r.calls) || 0
    acc.tokens   += Number(r.total_tokens) || 0
    acc.cost_usd += Number(r.cost_usd) || 0
    acc.fallbacks+= Number(r.fallbacks) || 0
    acc.budget_exceeded += Number(r.budget_exceeded) || 0
    return acc
  }, { calls: 0, tokens: 0, cost_usd: 0, fallbacks: 0, budget_exceeded: 0 })

  const perService = (usage?.summary || []).reduce((acc, r) => {
    acc[r.service_id] = r; return acc
  }, {})

  // Daily chart data
  const dailyMap = {}
  ;(usage?.daily || []).forEach(d => {
    const key = String(d.day).slice(0, 10)
    if (!dailyMap[key]) dailyMap[key] = { day: key, total: 0, 'ai-prescreen': 0, 'ai-advisor': 0 }
    dailyMap[key][d.service_id] = Number(d.cost_usd) || 0
    dailyMap[key].total += Number(d.cost_usd) || 0
  })
  const chartData = Object.values(dailyMap).sort((a,b)=>a.day>b.day?1:-1).slice(-30)

  const statusClass = (s) => s === 'ok' ? 'ai-status-ok' : s === 'fallback' ? 'ai-status-fallback' : 'ai-status-budget'

  return (
    <>
      <style>{css}</style>
      {error && <div className="notice notice-error mb-16">{error}</div>}

      {/* Period selector */}
      <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        {PERIODS.map(p=>(
          <button key={p.id} className={`btn btn-sm ${period===p.id?'btn-primary':'btn-ghost'}`}
            onClick={()=>changePeriod(p.id)}>{p.label}</button>
        ))}
        <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>load(period)}>↻ Refresh</button>
      </div>

      {/* KPI cards */}
      <div className="ai-grid">
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Total calls</div>
          <div className="ai-kpi-val">{fmtNum(summary.calls)}</div>
          <div className="ai-kpi-sub">{fmtNum(summary.fallbacks)} fallbacks · {fmtNum(summary.budget_exceeded)} budget blocks</div>
        </div>
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Total cost</div>
          <div className="ai-kpi-val">{fmtCost(summary.cost_usd)}</div>
          <div className="ai-kpi-sub">avg {summary.calls > 0 ? fmtCost(summary.cost_usd / summary.calls) : '$0'}/call</div>
        </div>
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Tokens used</div>
          <div className="ai-kpi-val">{fmtNum(summary.tokens)}</div>
          <div className="ai-kpi-sub">gpt-4o-mini</div>
        </div>
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Pre-screen cost</div>
          <div className="ai-kpi-val">{fmtCost(perService['ai-prescreen']?.cost_usd)}</div>
          <div className="ai-kpi-sub">{fmtNum(perService['ai-prescreen']?.calls)} calls</div>
        </div>
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Advisor cost</div>
          <div className="ai-kpi-val">{fmtCost(perService['ai-advisor']?.cost_usd)}</div>
          <div className="ai-kpi-sub">{fmtNum(perService['ai-advisor']?.calls)} calls</div>
        </div>
        <div className="ai-kpi">
          <div className="ai-kpi-lbl">Success rate</div>
          <div className="ai-kpi-val" style={{color:summary.calls>0&&summary.fallbacks/summary.calls<0.1?'var(--green)':'var(--amber)'}}>
            {summary.calls > 0 ? `${(((summary.calls - summary.fallbacks) / summary.calls) * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="ai-kpi-sub">{fmtNum(summary.calls - summary.fallbacks)} successful</div>
        </div>
      </div>

      {/* Cost chart */}
      {chartData.length > 1 && (
        <div className="card mb-16" style={{padding:'16px 12px'}}>
          <div className="card-title" style={{marginBottom:12}}>Daily spend (USD)</div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{top:0,right:10,bottom:0,left:0}}>
              <defs>
                <linearGradient id="pre" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--blue)"  stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--blue)"  stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="adv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5}/>
              <XAxis dataKey="day" tick={{fontSize:9,fill:'var(--text-3)'}} tickLine={false}
                tickFormatter={v=>v.slice(5)}/>
              <YAxis tick={{fontSize:9,fill:'var(--text-3)'}} tickLine={false} axisLine={false}
                tickFormatter={v=>`$${v.toFixed(3)}`} width={55}/>
              <Tooltip contentStyle={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:6,fontSize:11}}
                formatter={(v,n)=>[`$${Number(v).toFixed(5)}`, n]}/>
              <Area type="monotone" dataKey="ai-prescreen" name="Pre-Screen" stroke="var(--blue)" fill="url(#pre)" strokeWidth={1.5}/>
              <Area type="monotone" dataKey="ai-advisor"   name="Advisor"    stroke="var(--green)"fill="url(#adv)" strokeWidth={1.5}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Budget settings */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:12}}>
          Budget limits
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:12}}>
          {budget.map(item=>(
            <BudgetCard key={item.service_id} item={item} onSave={()=>load(period)}/>
          ))}
        </div>
        {budget.length === 0 && !loading && (
          <div style={{color:'var(--text-3)',fontSize:12}}>AI services not found in registry. Add ai-prescreen and ai-advisor first.</div>
        )}
      </div>

      {/* Recent calls table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:13,fontWeight:700,color:'var(--text-1)'}}>Recent calls</span>
          <span style={{fontSize:11,color:'var(--text-3)'}}>{(usage?.recent||[]).length} entries</span>
        </div>
        {loading ? (
          <div style={{padding:24,textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table className="ai-tbl">
              <thead>
                <tr>
                  <th>Time</th><th>Service</th><th>Request ID</th>
                  <th>Model</th><th>Prompt</th><th>Completion</th>
                  <th>Cost</th><th>Status</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(usage?.recent || []).map(r=>(
                  <tr key={r.id}>
                    <td style={{fontFamily:'monospace',fontSize:10,color:'var(--text-3)',whiteSpace:'nowrap'}}>
                      {String(r.created_at||'').slice(0,19).replace('T',' ')}
                    </td>
                    <td style={{fontFamily:'monospace',fontSize:10}}>{r.service_id}</td>
                    <td style={{fontFamily:'monospace',fontSize:9,color:'var(--text-3)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {r.request_id||'—'}
                    </td>
                    <td style={{fontSize:10,color:'var(--text-3)'}}>{r.model}</td>
                    <td style={{fontFamily:'monospace',fontSize:10}}>{fmtNum(r.prompt_tokens)}</td>
                    <td style={{fontFamily:'monospace',fontSize:10}}>{fmtNum(r.completion_tokens)}</td>
                    <td style={{fontFamily:'monospace',fontSize:10,color:'var(--green)'}}>{fmtCost(r.cost_usd)}</td>
                    <td><span className={statusClass(r.status)} style={{fontSize:9}}>{r.status}</span></td>
                    <td style={{fontSize:9,color:'var(--text-3)'}}>{r.error_code||''}</td>
                  </tr>
                ))}
                {(usage?.recent||[]).length === 0 && (
                  <tr><td colSpan={9} style={{textAlign:'center',padding:20,color:'var(--text-3)'}}>No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
