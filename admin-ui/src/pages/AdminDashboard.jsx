import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';

const STYLES = `
  .adm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .adm-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-1);
  }
  .adm-refresh-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-inset);
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .adm-refresh-btn:hover { background: var(--border); }
  .adm-refresh-btn:disabled { opacity: 0.5; cursor: default; }
  .adm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .adm-kpi {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-top: 3px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .adm-kpi-lbl {
    font-size: 11px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .adm-kpi .adm-val {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-1);
    line-height: 1.15;
  }
  .adm-kpi .adm-sub {
    font-size: 11px;
    color: var(--text-3);
    margin-top: 2px;
  }
  .adm-row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .adm-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
  }
  .adm-right-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .adm-chart-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 10px;
  }
  .adm-svc-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .adm-svc-row:last-child { border-bottom: none; }
  .adm-svc-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .adm-svc-dot.up   { background: var(--green); }
  .adm-svc-dot.down { background: var(--red); }
  .adm-type-badge {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    background: var(--bg-inset);
    color: var(--text-3);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .adm-mono {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-2);
  }
  .adm-svc-host {
    color: var(--text-3);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .adm-cb-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .adm-cb-row:last-child { border-bottom: none; }
  .adm-cb-state {
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .adm-cb-state.open   { background: var(--red);   color: #fff; }
  .adm-cb-state.closed { background: var(--green); color: #fff; }
  .adm-cb-name { flex: 1; color: var(--text-1); }
  .adm-cb-fail { color: var(--text-3); font-size: 11px; }
  .adm-stat-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
    font-size: 12px;
    color: var(--text-2);
  }
  .adm-stat-label { width: 110px; flex-shrink: 0; }
  .adm-stat-track {
    flex: 1;
    height: 10px;
    background: var(--bg-inset);
    border-radius: 5px;
    overflow: hidden;
  }
  .adm-stat-fill {
    height: 100%;
    border-radius: 5px;
    transition: width 0.4s;
  }
  .adm-stat-count { width: 40px; text-align: right; font-size: 11px; color: var(--text-3); flex-shrink: 0; }
  .adm-status-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .adm-fail-tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .adm-fail-tbl th {
    text-align: left;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .adm-fail-tbl td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-1);
    vertical-align: top;
  }
  .adm-fail-tbl tr:last-child td { border-bottom: none; }
  .adm-fail-tbl tr:hover td { background: var(--bg-inset); }
  .adm-err-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 16px;
    overflow-x: auto;
  }
  @media (max-width: 900px) {
    .adm-row2 { grid-template-columns: 1fr; }
  }
`;

const STATUS_COLORS = {
  COMPLETED:    { bar: 'var(--green)',  badge: { background: 'var(--green)',  color: '#fff' } },
  REJECTED:     { bar: 'var(--red)',    badge: { background: 'var(--red)',    color: '#fff' } },
  REVIEW:       { bar: 'var(--amber)',  badge: { background: 'var(--amber)',  color: '#fff' } },
  FAILED:       { bar: 'var(--red)',    badge: { background: 'var(--red)',    color: '#fff' } },
  ENGINE_ERROR: { bar: '#a855f7',       badge: { background: '#a855f7',       color: '#fff' } },
  RUNNING:      { bar: 'var(--blue)',   badge: { background: 'var(--blue)',   color: '#fff' } },
  ORPHANED:     { bar: 'var(--red)',    badge: { background: 'var(--red)',    color: '#fff' } },
};

const ERROR_STATUSES = new Set(['FAILED', 'ENGINE_ERROR', 'ORPHANED']);

function extractHost(baseUrl) {
  if (!baseUrl) return '';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function computePercentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.floor(p * sortedArr.length);
  return sortedArr[Math.min(idx, sortedArr.length - 1)];
}

function computeReqStats(requests) {
  const byStatus = {};
  let failed = 0;
  let running = 0;
  const durations = [];

  for (const req of requests) {
    const status = (req.status || '').toUpperCase();
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (ERROR_STATUSES.has(status)) failed++;
    if (status === 'RUNNING') running++;
    if (req.created_at && req.updated_at) {
      const dur = (new Date(req.updated_at) - new Date(req.created_at)) / 1000;
      if (dur >= 0 && dur <= 300) durations.push(dur);
    }
  }

  durations.sort((a, b) => a - b);
  const p50 = computePercentile(durations, 0.5);
  const p95 = computePercentile(durations, 0.95);

  return { byStatus, failed, running, p50, p95 };
}

function StatusBadge({ status }) {
  const s = (status || '').toUpperCase();
  const style = STATUS_COLORS[s]?.badge || { background: 'var(--border)', color: 'var(--text-2)' };
  return (
    <span className="adm-status-badge" style={style}>{s}</span>
  );
}

export default function AdminDashboard() {
  const [health, setHealth] = useState(null);
  const [services, setServices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, servicesData, requestsData] = await Promise.all([
        get('/health').catch(() => null),
        get('/api/v1/services').catch(() => []),
        get('/api/v1/requests?limit=200').catch(() => []),
      ]);
      setHealth(healthData);
      setServices(Array.isArray(servicesData) ? servicesData : (servicesData?.items || servicesData?.services || []));
      setRequests(Array.isArray(requestsData) ? requestsData : (requestsData?.items || requestsData?.requests || []));
    } catch (e) {
      setError(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const reqStats = useMemo(() => computeReqStats(requests), [requests]);

  const circuitBreakers = useMemo(() => {
    if (!health?.circuit_breakers) return [];
    const cb = health.circuit_breakers;
    if (Array.isArray(cb)) return cb;
    return Object.entries(cb).map(([name, info]) => ({ name, ...(typeof info === 'object' ? info : { state: info }) }));
  }, [health]);

  const openCbCount = useMemo(() =>
    circuitBreakers.filter(cb => (cb.state || '').toUpperCase() === 'OPEN').length,
    [circuitBreakers]
  );

  const servicesEnabled = useMemo(() => {
    const total = services.length;
    const enabled = services.filter(s => s.enabled !== false).length;
    return { enabled, total };
  }, [services]);

  const recentErrors = useMemo(() =>
    requests
      .filter(r => ERROR_STATUSES.has((r.status || '').toUpperCase()))
      .slice(0, 10),
    [requests]
  );

  const statusBarRows = useMemo(() => {
    const { byStatus } = reqStats;
    const total = requests.length;
    const order = ['COMPLETED', 'REJECTED', 'REVIEW', 'FAILED', 'ENGINE_ERROR', 'RUNNING', 'ORPHANED'];
    return order
      .filter(s => byStatus[s] > 0)
      .map(s => ({
        label: s,
        count: byStatus[s] || 0,
        pct: total ? ((byStatus[s] || 0) / total) * 100 : 0,
        color: STATUS_COLORS[s]?.bar || 'var(--border)',
      }));
  }, [reqStats, requests.length]);

  const coreStatus   = health?.status?.toUpperCase() || (health ? 'UNKNOWN' : null);
  const dbStatus     = health?.db?.toUpperCase?.() || health?.database?.toUpperCase?.() || (health ? 'UNKNOWN' : null);
  const svcStatus    = health?.service?.toUpperCase?.() || null;
  const runningCount = reqStats.running;

  const kpis = useMemo(() => [
    {
      label: 'Core API',
      value: coreStatus || '—',
      sub: svcStatus ? `svc: ${svcStatus}` : null,
      accent: coreStatus === 'UP' || coreStatus === 'OK' ? 'var(--green)' : coreStatus ? 'var(--red)' : 'var(--border)',
      valColor: coreStatus === 'UP' || coreStatus === 'OK' ? 'var(--green)' : coreStatus ? 'var(--red)' : 'var(--text-3)',
    },
    {
      label: 'Database',
      value: dbStatus || '—',
      sub: null,
      accent: dbStatus === 'OK' || dbStatus === 'UP' ? 'var(--green)' : dbStatus ? 'var(--red)' : 'var(--border)',
      valColor: dbStatus === 'OK' || dbStatus === 'UP' ? 'var(--green)' : dbStatus ? 'var(--red)' : 'var(--text-3)',
    },
    {
      label: 'Running',
      value: runningCount,
      sub: 'active processes',
      accent: 'var(--blue)',
      valColor: 'var(--blue)',
    },
    {
      label: 'Errors (200)',
      value: reqStats.failed,
      sub: null,
      accent: reqStats.failed > 0 ? 'var(--red)' : 'var(--green)',
      valColor: reqStats.failed > 0 ? 'var(--red)' : 'var(--green)',
    },
    {
      label: 'P50 Latency',
      value: reqStats.p50 != null ? `${reqStats.p50.toFixed(1)}s` : '—',
      sub: null,
      accent: '#06b6d4',
      valColor: '#06b6d4',
    },
    {
      label: 'P95 Latency',
      value: reqStats.p95 != null ? `${reqStats.p95.toFixed(1)}s` : '—',
      sub: null,
      accent: '#a855f7',
      valColor: '#a855f7',
    },
    {
      label: 'Services',
      value: `${servicesEnabled.enabled}/${servicesEnabled.total}`,
      sub: 'enabled / total',
      accent: 'var(--amber)',
      valColor: 'var(--text-1)',
    },
    {
      label: 'Open Breakers',
      value: openCbCount,
      sub: null,
      accent: openCbCount > 0 ? 'var(--red)' : 'var(--green)',
      valColor: openCbCount > 0 ? 'var(--red)' : 'var(--green)',
    },
  ], [coreStatus, svcStatus, dbStatus, runningCount, reqStats, servicesEnabled, openCbCount]);

  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  }

  function truncate(str, n = 60) {
    if (!str) return '—';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  function getErrorReason(req) {
    const r = req.result || {};
    return r.error || r.decision_reason || r?.summary?.decision_reason || req.error_message || null;
  }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: 'var(--bg-inset)' }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div className="adm-header">
        <div className="adm-title">System Admin</div>
        <button className="adm-refresh-btn" onClick={fetchAll} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--bg-card)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--red)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="adm-grid">
        {kpis.map(kpi => (
          <div key={kpi.label} className="adm-kpi" style={{ borderTopColor: kpi.accent }}>
            <div className="adm-kpi-lbl">{kpi.label}</div>
            <div className="adm-val" style={{ color: kpi.valColor || 'var(--text-1)' }}>{String(kpi.value)}</div>
            {kpi.sub && <div className="adm-sub">{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="adm-row2">
        {/* Left: Service Registry */}
        <div className="adm-card">
          <div className="adm-chart-title">Service Registry</div>
          {services.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No services found</div>
          )}
          {services.map((svc, i) => {
            const isEnabled = svc.enabled !== false;
            const host = extractHost(svc.base_url || svc.baseUrl || svc.url || '');
            return (
              <div className="adm-svc-row" key={svc.id || i}>
                <span className={`adm-svc-dot ${isEnabled ? 'up' : 'down'}`} title={isEnabled ? 'Enabled' : 'Disabled'} />
                {svc.type && <span className="adm-type-badge">{svc.type}</span>}
                <span className="adm-mono">{svc.id || svc.name || `svc-${i}`}</span>
                {host && <span className="adm-svc-host" title={svc.base_url || svc.url}>{host}</span>}
              </div>
            );
          })}
        </div>

        {/* Right: Circuit Breakers + Status Breakdown */}
        <div className="adm-right-col">
          <div className="adm-card">
            <div className="adm-chart-title">Circuit Breakers</div>
            {circuitBreakers.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No circuit breaker data</div>
            )}
            {circuitBreakers.map((cb, i) => {
              const state = (cb.state || '').toUpperCase();
              const isOpen = state === 'OPEN';
              return (
                <div className="adm-cb-row" key={cb.name || i}>
                  <span className={`adm-cb-state ${isOpen ? 'open' : 'closed'}`}>
                    {state || 'UNKNOWN'}
                  </span>
                  <span className="adm-cb-name">{cb.name || cb.service || `cb-${i}`}</span>
                  {cb.failure_count != null && (
                    <span className="adm-cb-fail">{cb.failure_count} fail{cb.failure_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="adm-card">
            <div className="adm-chart-title">Status Breakdown (last 200)</div>
            {statusBarRows.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No request data</div>
            )}
            {statusBarRows.map((row, i) => (
              <div className="adm-stat-row" key={i}>
                <div className="adm-stat-label">{row.label}</div>
                <div className="adm-stat-track">
                  <div className="adm-stat-fill" style={{ width: `${row.pct}%`, background: row.color }} />
                </div>
                <div className="adm-stat-count">{row.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Errors Table */}
      <div className="adm-err-card">
        <div className="adm-chart-title">Recent Errors</div>
        {recentErrors.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--green)', padding: '8px 0' }}>No errors in last 200 requests</div>
        ) : (
          <table className="adm-fail-tbl">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Error / Reason</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {recentErrors.map((req, i) => (
                <tr key={req.id || req.request_id || i}>
                  <td>
                    <span className="adm-mono">{req.request_id || req.id || '—'}</span>
                  </td>
                  <td>
                    <StatusBadge status={req.status} />
                  </td>
                  <td style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    {req.orchestration_mode || req.mode || '—'}
                  </td>
                  <td style={{ color: 'var(--text-2)', fontSize: 11, maxWidth: 280 }}>
                    {truncate(getErrorReason(req))}
                  </td>
                  <td style={{ color: 'var(--text-3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {fmtTs(req.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
