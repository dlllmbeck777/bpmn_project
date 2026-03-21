import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const STYLES = `
  .bdb-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .bdb-preset {
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--bg-inset);
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .bdb-preset:hover { background: var(--border); }
  .bdb-preset.active {
    background: var(--blue);
    color: #fff;
    border-color: var(--blue);
  }
  .bdb-date, .bdb-select {
    padding: 4px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--bg-inset);
    color: var(--text-1);
    font-size: 12px;
  }
  .bdb-date:focus, .bdb-select:focus {
    outline: none;
    border-color: var(--blue);
  }
  .bdb-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .bdb-kpi {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    border-top-width: 3px;
  }
  .bdb-kpi-lbl {
    font-size: 11px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .bdb-kpi .val {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-1);
    line-height: 1.1;
  }
  .bdb-kpi .sub {
    font-size: 11px;
    color: var(--text-3);
    margin-top: 2px;
  }
  .bdb-chart-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  .bdb-grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .bdb-grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .bdb-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
  }
  .bdb-trend-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 16px;
  }
  .bdb-hbar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 11px;
    color: var(--text-2);
  }
  .bdb-hbar-label { width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bdb-hbar-track {
    flex: 1;
    height: 8px;
    background: var(--bg-inset);
    border-radius: 4px;
    overflow: hidden;
  }
  .bdb-hbar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s;
  }
  .bdb-hbar-count { width: 30px; text-align: right; flex-shrink: 0; }
  .bdb-prog-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-2);
  }
  .bdb-prog-label { width: 80px; flex-shrink: 0; }
  .bdb-prog-track {
    flex: 1;
    height: 12px;
    background: var(--bg-inset);
    border-radius: 6px;
    overflow: hidden;
  }
  .bdb-prog-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.4s;
  }
  .bdb-prog-pct { width: 40px; text-align: right; flex-shrink: 0; font-size: 11px; }
  @media (max-width: 900px) {
    .bdb-grid2 { grid-template-columns: 1fr; }
    .bdb-grid3 { grid-template-columns: 1fr; }
  }
`;

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--text-1)',
};

const PRESETS = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'All time', value: 'all' },
];

const SCORE_BANDS = [
  { label: '<500',    min: 0,   max: 500,      color: '#ef4444' },
  { label: '500-579', min: 500, max: 580,      color: '#ef4444' },
  { label: '580-649', min: 580, max: 650,      color: '#f97316' },
  { label: '650-699', min: 650, max: 700,      color: '#f59e0b' },
  { label: '700-749', min: 700, max: 750,      color: '#86efac' },
  { label: '750+',    min: 750, max: Infinity, color: '#22c55e' },
];

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#84cc16'];

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'today') {
    return { from: toISODate(today), to: toISODate(today) };
  }
  if (preset === '7d') {
    const from = new Date(today); from.setDate(from.getDate() - 6);
    return { from: toISODate(from), to: toISODate(today) };
  }
  if (preset === '30d') {
    const from = new Date(today); from.setDate(from.getDate() - 29);
    return { from: toISODate(from), to: toISODate(today) };
  }
  return { from: '', to: '' };
}

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function pct(num, total) {
  if (!total) return '0.0';
  return ((num / total) * 100).toFixed(1);
}

function getDecision(req) {
  const r = req.result || {};
  return (r.decision || r?.summary?.decision || '').toUpperCase();
}

function computeStats(requests) {
  if (!requests || !requests.length) {
    return { total: 0, approved: 0, rejected: 0, review: 0, failed: 0, aiCount: 0, running: 0, avgScore: null, avgDur: null };
  }
  let approved = 0, rejected = 0, review = 0, failed = 0, running = 0, aiCount = 0;
  let scoreSum = 0, scoreCount = 0, durSum = 0, durCount = 0;

  for (const req of requests) {
    const status = (req.status || '').toUpperCase();
    const decision = getDecision(req);

    if (status === 'COMPLETED' && decision === 'APPROVED') {
      approved++;
    } else if (decision === 'REJECTED') {
      rejected++;
    } else if (status === 'REVIEW') {
      review++;
    } else if (['FAILED', 'ENGINE_ERROR', 'ORPHANED'].includes(status)) {
      failed++;
    } else if (status === 'RUNNING') {
      running++;
    }

    const r = req.result || {};
    const score = r?.summary?.credit_score ?? r?.parsed_report?.summary?.credit_score ?? null;
    if (score != null && !isNaN(score)) {
      scoreSum += Number(score);
      scoreCount++;
    }

    if (req.created_at && req.updated_at) {
      const dur = (new Date(req.updated_at) - new Date(req.created_at)) / 1000;
      if (dur >= 0 && dur <= 300) {
        durSum += dur;
        durCount++;
      }
    }

    if (r.ai_assessment && !r.ai_assessment.fallback) aiCount++;
  }

  return {
    total: requests.length,
    approved, rejected, review, failed, running, aiCount,
    avgScore: scoreCount ? scoreSum / scoreCount : null,
    avgDur: durCount ? durSum / durCount : null,
  };
}

function computeDailyTrend(requests) {
  const map = {};
  for (const req of requests) {
    const day = (req.created_at || '').slice(5, 10);
    if (!day) continue;
    if (!map[day]) map[day] = { day, total: 0, approved: 0, rejected: 0 };
    map[day].total++;
    const status = (req.status || '').toUpperCase();
    const decision = getDecision(req);
    if (status === 'COMPLETED' && decision === 'APPROVED') map[day].approved++;
    if (decision === 'REJECTED') map[day].rejected++;
  }
  return Object.values(map).sort((a, b) => (a.day > b.day ? 1 : -1));
}

function computeHourlyToday(requests) {
  const today = toISODate(new Date());
  const map = {};
  for (let h = 0; h < 24; h++) map[h] = { hour: `${String(h).padStart(2, '0')}h`, count: 0 };
  for (const req of requests) {
    const d = req.created_at || '';
    if (!d.startsWith(today)) continue;
    const hour = new Date(d).getHours();
    if (map[hour] !== undefined) map[hour].count++;
  }
  return Object.values(map);
}

function computeScoreDist(requests) {
  const counts = SCORE_BANDS.map(b => ({ ...b, count: 0 }));
  for (const req of requests) {
    const r = req.result || {};
    const score = r?.summary?.credit_score ?? r?.parsed_report?.summary?.credit_score ?? null;
    if (score == null) continue;
    for (const b of counts) {
      if (Number(score) >= b.min && Number(score) < b.max) { b.count++; break; }
    }
  }
  return counts;
}

function computeRejectionReasons(requests) {
  const map = {};
  for (const req of requests) {
    if (getDecision(req) !== 'REJECTED') continue;
    const r = req.result || {};
    const reason = r.decision_reason || r?.summary?.decision_reason || r.reason || 'Unknown';
    map[reason] = (map[reason] || 0) + 1;
  }
  return Object.entries(map)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function computeModePie(requests) {
  const map = {};
  for (const req of requests) {
    const mode = req.orchestration_mode || req.mode || 'unknown';
    map[mode] = (map[mode] || 0) + 1;
  }
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

function computeProductPie(requests) {
  const map = {};
  for (const req of requests) {
    const pt = req.product_type || req.productType || 'unknown';
    map[pt] = (map[pt] || 0) + 1;
  }
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export default function Dashboard() {
  const [preset, setPreset] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [appliedPreset, setAppliedPreset] = useState('7d');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const fetchData = useCallback(async (pset, cFrom, cTo) => {
    setLoading(true);
    try {
      let params = '';
      if (pset !== 'all') {
        const range = presetRange(pset);
        if (range.from) params += `from=${range.from}&to=${range.to}&`;
      } else {
        if (cFrom) params += `from=${cFrom}&`;
        if (cTo) params += `to=${cTo}&`;
      }
      const data = await get('/api/v1/requests?limit=2000&' + params);
      setRequests(Array.isArray(data) ? data : (data?.items || data?.requests || []));
    } catch (e) {
      console.error('Dashboard fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(appliedPreset, appliedFrom, appliedTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = useCallback(() => {
    setAppliedPreset(preset);
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    fetchData(preset, customFrom, customTo);
  }, [preset, customFrom, customTo, fetchData]);

  const handleRefresh = useCallback(() => {
    fetchData(appliedPreset, appliedFrom, appliedTo);
  }, [appliedPreset, appliedFrom, appliedTo, fetchData]);

  const filteredRequests = useMemo(() => {
    let list = requests;
    if (productTypeFilter !== 'all') {
      list = list.filter(r => (r.product_type || r.productType || '') === productTypeFilter);
    }
    if (modeFilter !== 'all') {
      list = list.filter(r => (r.orchestration_mode || r.mode || '') === modeFilter);
    }
    return list;
  }, [requests, productTypeFilter, modeFilter]);

  const productTypes = useMemo(() => {
    const set = new Set(requests.map(r => r.product_type || r.productType || '').filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [requests]);

  const modes = useMemo(() => {
    const set = new Set(requests.map(r => r.orchestration_mode || r.mode || '').filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [requests]);

  const stats = useMemo(() => computeStats(filteredRequests), [filteredRequests]);
  const dailyTrend = useMemo(() => computeDailyTrend(filteredRequests), [filteredRequests]);
  const hourlyToday = useMemo(() => computeHourlyToday(filteredRequests), [filteredRequests]);
  const scoreDist = useMemo(() => computeScoreDist(filteredRequests), [filteredRequests]);
  const rejectionReasons = useMemo(() => computeRejectionReasons(filteredRequests), [filteredRequests]);
  const modePie = useMemo(() => computeModePie(filteredRequests), [filteredRequests]);
  const productPie = useMemo(() => computeProductPie(filteredRequests), [filteredRequests]);

  const maxRejReason = useMemo(() =>
    rejectionReasons.length ? rejectionReasons[0].count : 1,
    [rejectionReasons]
  );

  const kpis = useMemo(() => {
    const { total, approved, rejected, review, failed, aiCount, avgScore, avgDur, running } = stats;
    const approvalRate = total ? (approved / total) * 100 : 0;
    const rejectionRate = total ? (rejected / total) * 100 : 0;
    return [
      {
        label: 'Total Applications',
        value: total,
        sub: null,
        accent: 'var(--blue)',
      },
      {
        label: 'Approval Rate',
        value: `${fmt(approvalRate, 1)}%`,
        sub: `${approved} approved`,
        accent: 'var(--green)',
      },
      {
        label: 'Rejection Rate',
        value: `${fmt(rejectionRate, 1)}%`,
        sub: null,
        accent: 'var(--red)',
      },
      {
        label: 'In Review',
        value: review,
        sub: `${pct(review, total)}% of total`,
        accent: 'var(--amber)',
      },
      {
        label: 'Avg Credit Score',
        value: avgScore != null ? fmt(avgScore, 0) : '—',
        sub: null,
        accent: '#a855f7',
      },
      {
        label: 'Avg Processing',
        value: avgDur != null ? `${fmt(avgDur, 1)}s` : '—',
        sub: null,
        accent: '#06b6d4',
      },
      {
        label: 'AI Assessed',
        value: aiCount,
        sub: `${pct(aiCount, total)}% of total`,
        accent: 'var(--blue)',
      },
      {
        label: 'Errors',
        value: failed,
        sub: running > 0 ? `${running} running now` : 'none running',
        accent: failed > 0 ? 'var(--red)' : 'var(--green)',
      },
    ];
  }, [stats]);

  const decisionDistRows = useMemo(() => {
    const { total, approved, rejected, review, failed } = stats;
    return [
      { label: 'Approved', count: approved, color: 'var(--green)' },
      { label: 'Rejected', count: rejected, color: 'var(--red)' },
      { label: 'Review',   count: review,   color: 'var(--amber)' },
      { label: 'Errors',   count: failed,   color: 'var(--red)' },
    ].map(row => ({ ...row, pct: total ? (row.count / total) * 100 : 0 }));
  }, [stats]);

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: 'var(--bg-inset)' }}>
      <style>{STYLES}</style>

      {/* Filter Bar */}
      <div className="bdb-filter">
        {PRESETS.map(p => (
          <button
            key={p.value}
            className={`bdb-preset${preset === p.value ? ' active' : ''}`}
            onClick={() => setPreset(p.value)}
          >
            {p.label}
          </button>
        ))}
        <input
          type="date"
          className="bdb-date"
          value={customFrom}
          onChange={e => { setCustomFrom(e.target.value); setPreset('all'); }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>–</span>
        <input
          type="date"
          className="bdb-date"
          value={customTo}
          onChange={e => { setCustomTo(e.target.value); setPreset('all'); }}
        />
        <select
          className="bdb-select"
          value={productTypeFilter}
          onChange={e => setProductTypeFilter(e.target.value)}
        >
          {productTypes.map(pt => (
            <option key={pt} value={pt}>{pt === 'all' ? 'All Products' : pt}</option>
          ))}
        </select>
        <select
          className="bdb-select"
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value)}
        >
          {modes.map(m => (
            <option key={m} value={m}>{m === 'all' ? 'All Modes' : m}</option>
          ))}
        </select>
        <button className="bdb-preset active" onClick={handleApply} disabled={loading}>
          Apply
        </button>
        <button className="bdb-preset" onClick={handleRefresh} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          {filteredRequests.length.toLocaleString()} requests
        </span>
      </div>

      {/* KPI Cards */}
      <div className="bdb-kpis">
        {kpis.map(kpi => (
          <div key={kpi.label} className="bdb-kpi" style={{ borderTopColor: kpi.accent }}>
            <div className="bdb-kpi-lbl">{kpi.label}</div>
            <div className="val">{kpi.value}</div>
            {kpi.sub && <div className="sub">{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* Daily Trend */}
      <div className="bdb-trend-wrap">
        <div className="bdb-chart-title">Daily Trend</div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradApproved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRejected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="total"    stroke="#3b82f6" fill="url(#gradTotal)"    strokeWidth={1.5} name="Total"    dot={false} />
            <Area type="monotone" dataKey="approved" stroke="#22c55e" fill="url(#gradApproved)" strokeWidth={1.5} name="Approved" dot={false} />
            <Area type="monotone" dataKey="rejected" stroke="#ef4444" fill="url(#gradRejected)" strokeWidth={1.5} name="Rejected" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Two-column: Hourly + Score Distribution */}
      <div className="bdb-grid2">
        <div className="bdb-card">
          <div className="bdb-chart-title">Hourly Volume (Today)</div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={hourlyToday} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--text-3)' }} interval={3} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="var(--blue)" radius={[2, 2, 0, 0]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bdb-card">
          <div className="bdb-chart-title">Credit Score Distribution</div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={scoreDist} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-3)' }} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} name="Count">
                {scoreDist.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Three-column: Rejection reasons + Mode pie + Product pie */}
      <div className="bdb-grid3">
        <div className="bdb-card">
          <div className="bdb-chart-title">Top Rejection Reasons</div>
          {rejectionReasons.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', paddingTop: 8 }}>No rejections in range</div>
          ) : (
            rejectionReasons.map((r, i) => (
              <div className="bdb-hbar-row" key={i}>
                <div className="bdb-hbar-label" title={r.reason}>{r.reason}</div>
                <div className="bdb-hbar-track">
                  <div
                    className="bdb-hbar-fill"
                    style={{ width: `${(r.count / maxRejReason) * 100}%`, background: 'var(--red)' }}
                  />
                </div>
                <div className="bdb-hbar-count">{r.count}</div>
              </div>
            ))
          )}
        </div>

        <div className="bdb-card">
          <div className="bdb-chart-title">Mode Breakdown</div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={modePie}
                cx="50%" cy="50%"
                innerRadius={32} outerRadius={56}
                paddingAngle={2}
                dataKey="value" nameKey="name"
              >
                {modePie.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 4 }}>
            {modePie.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[idx % PIE_COLORS.length], display: 'inline-block' }} />
                {entry.name}
              </div>
            ))}
          </div>
        </div>

        <div className="bdb-card">
          <div className="bdb-chart-title">Product Types</div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={productPie}
                cx="50%" cy="50%"
                innerRadius={32} outerRadius={56}
                paddingAngle={2}
                dataKey="value" nameKey="name"
              >
                {productPie.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 4 }}>
            {productPie.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[idx % PIE_COLORS.length], display: 'inline-block' }} />
                {entry.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decision Distribution */}
      <div className="bdb-card">
        <div className="bdb-chart-title">Decision Distribution</div>
        {decisionDistRows.map((row, i) => (
          <div className="bdb-prog-row" key={i}>
            <div className="bdb-prog-label">{row.label}</div>
            <div className="bdb-prog-track">
              <div className="bdb-prog-fill" style={{ width: `${row.pct}%`, background: row.color }} />
            </div>
            <div className="bdb-prog-pct">{row.pct.toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 36, textAlign: 'right' }}>{row.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
