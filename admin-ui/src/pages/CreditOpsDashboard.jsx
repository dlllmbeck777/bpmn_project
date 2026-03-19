import { useState, useEffect, useMemo, useRef } from "react";
import { get, getUserRole } from "../lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area } from "recharts";

/* ─── Field mapping from real API response ─── */
function mapRequest(r) {
  const result = r.result && typeof r.result === "object" ? r.result : {};
  const summary = result.summary || result.parsed_report?.summary || {};
  const name = r.applicant_name ||
    [r.applicant_profile?.firstName, r.applicant_profile?.lastName].filter(Boolean).join(" ") ||
    r.customer_id || "Unknown";
  const city = [r.applicant_profile?.city, r.applicant_profile?.state].filter(Boolean).join(", ") || "—";
  const score  = summary.credit_score || 0;
  const reason = result.decision_reason || result.summary?.decision_reason ||
    result.post_stop_factor?.reason || r.error || "—";
  const collections = summary.collection_count || 0;
  const alerts      = summary.creditsafe_alerts || summary.alerts || 0;
  const created     = r.created_at || new Date().toISOString();
  const ts          = new Date(created).getTime();
  const updated     = r.updated_at || created;
  const dur         = Math.max(0, new Date(updated).getTime() - ts);
  const needsAction = ["FAILED", "ENGINE_ERROR", "REVIEW", "ORPHANED"].includes(r.status);
  return {
    id: r.request_id,
    name, city,
    mode: r.orchestration_mode || "custom",
    status: r.status || "UNKNOWN",
    score, dur, needsAction, collections, alerts, reason, created, ts,
    hour: new Date(created).getHours(),
    day:  new Date(created).toLocaleDateString("en", { weekday: "short" }),
  };
}

/* ─── Design tokens ─── */
const T = {
  bg0: "#04060b", bg1: "#080c14", bg2: "#0d1320", bg3: "#131b2e",
  border: "#1a2540", borderHover: "#243352",
  text0: "#f1f5f9", text1: "#cbd5e1", text2: "#8294b0", text3: "#4a5f80",
  accent: "#2563eb", accentGlow: "rgba(37,99,235,0.15)",
  green: "#22c55e", greenDim: "#166534", greenGlow: "rgba(34,197,94,0.12)",
  red: "#ef4444", redDim: "#7f1d1d", redGlow: "rgba(239,68,68,0.12)",
  amber: "#f59e0b", amberDim: "#78350f", amberGlow: "rgba(245,158,11,0.12)",
  cyan: "#06b6d4", purple: "#a855f7",
};

const STATUS_MAP = {
  COMPLETED:    { c: T.green,  bg: T.greenDim,  glow: T.greenGlow,  label: "completed"    },
  REJECTED:     { c: T.red,    bg: T.redDim,    glow: T.redGlow,    label: "rejected"     },
  REVIEW:       { c: T.amber,  bg: T.amberDim,  glow: T.amberGlow,  label: "review"       },
  FAILED:       { c: T.red,    bg: T.redDim,    glow: T.redGlow,    label: "failed"       },
  RUNNING:      { c: T.accent, bg: "#1e3a5f",   glow: T.accentGlow, label: "running"      },
  ENGINE_ERROR: { c: T.purple, bg: "#3b0764",   glow: "rgba(168,85,247,0.12)", label: "engine error" },
  ORPHANED:     { c: T.red,    bg: T.redDim,    glow: T.redGlow,    label: "orphaned"     },
  SUBMITTED:    { c: T.cyan,   bg: "#164e63",   glow: "transparent", label: "submitted"   },
};

const ST = ["COMPLETED", "REJECTED", "REVIEW", "FAILED", "RUNNING", "ENGINE_ERROR"];

/* ─── Micro components ─── */
function Pill({ status }) {
  const s = STATUS_MAP[status] || { c: T.text3, bg: T.bg3, glow: "transparent", label: status?.toLowerCase() || "n/a" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px 3px 7px", borderRadius: 6,
      background: s.bg, color: s.c, fontSize: 10.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
      letterSpacing: 0.4, textTransform: "uppercase", border: `1px solid ${s.c}22`, boxShadow: `0 0 12px ${s.glow}` }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.c, boxShadow: `0 0 6px ${s.c}` }} />
      {s.label}
    </span>
  );
}

function Mode({ mode }) {
  const f = mode === "flowable";
  return (
    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase",
      background: f ? "#0c2d5a" : "#2d1054", color: f ? "#60a5fa" : "#c084fc",
      border: `1px solid ${f ? "#1d4ed833" : "#7c3aed33"}` }}>
      {mode}
    </span>
  );
}

function ScoreGauge({ score }) {
  const pct = Math.max(0, Math.min(100, ((score - 300) / 550) * 100));
  const c = score >= 700 ? T.green : score >= 580 ? T.amber : T.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ position: "relative", width: 44, height: 4, borderRadius: 2, background: T.bg3, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2,
          width: `${pct}%`, background: `linear-gradient(90deg, ${c}88, ${c})`, boxShadow: `0 0 8px ${c}44` }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c, minWidth: 28, textAlign: "right" }}>
        {score || "—"}
      </span>
    </div>
  );
}

function Elapsed({ iso }) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return <span style={{ fontSize: 10.5, color: T.green,  fontFamily: "'JetBrains Mono',monospace" }}>now</span>;
  if (m < 60) return <span style={{ fontSize: 10.5, color: T.text2,  fontFamily: "'JetBrains Mono',monospace" }}>{m}m</span>;
  const h = Math.floor(m / 60);
  if (h < 24) return <span style={{ fontSize: 10.5, color: T.text3,  fontFamily: "'JetBrains Mono',monospace" }}>{h}h</span>;
  return              <span style={{ fontSize: 10.5, color: T.text3,  fontFamily: "'JetBrains Mono',monospace" }}>{Math.floor(h / 24)}d</span>;
}

function KV({ label, children, mono }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: T.text3, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text1, fontFamily: mono ? "'JetBrains Mono',monospace" : "inherit", fontWeight: mono ? 500 : 400 }}>{children}</div>
    </div>
  );
}

/* ─── Main ─── */
export default function CreditOpsDashboard() {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState("ALL");
  const [modeF, setModeF]     = useState("ALL");
  const [actionF, setActionF] = useState(false);
  const [q, setQ]             = useState("");
  const [sel, setSel]         = useState(null);
  const [pg, setPg]           = useState(0);
  const [sortK, setSortK]     = useState("ts");
  const [sortD, setSortD]     = useState(-1);
  const [view, setView]       = useState("table");
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef(null);
  const PS = 30;

  const loadRequests = async () => {
    setLoading(true);
    try {
      const d = await get("/api/v1/requests?limit=500");
      setData((d.items || []).map(mapRequest));
    } catch (_) {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadRequests(); setMounted(true); }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setSel(null); setQ(""); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const stats = useMemo(() => {
    const bySt = {}; ST.forEach(s => bySt[s] = 0);
    let totalDur = 0, totalScore = 0, scoreCount = 0;
    data.forEach(r => {
      bySt[r.status] = (bySt[r.status] || 0) + 1;
      totalDur += r.dur;
      if (r.score > 0) { totalScore += r.score; scoreCount++; }
    });
    const act = data.filter(r => r.needsAction).length;
    const hourly = Array.from({ length: 24 }, (_, i) => ({ h: String(i).padStart(2, "0"), v: 0 }));
    data.forEach(r => { if (r.hour >= 0 && r.hour < 24) hourly[r.hour].v++; });
    const dayMap = {};
    data.forEach(r => {
      const d = r.created.slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { d, total: 0, ok: 0, fail: 0 };
      dayMap[d].total++;
      if (r.status === "COMPLETED") dayMap[d].ok++;
      if (["REJECTED", "FAILED", "ENGINE_ERROR"].includes(r.status)) dayMap[d].fail++;
    });
    const daily = Object.values(dayMap).sort((a, b) => a.d.localeCompare(b.d));
    const pie = Object.entries(bySt).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value, color: STATUS_MAP[name]?.c || T.text3 }));
    return {
      bySt, act, daily, hourly, pie,
      avgDur:   data.length ? Math.round(totalDur / data.length / 1000) : 0,
      avgScore: scoreCount  ? Math.round(totalScore / scoreCount) : 0,
      total:    data.length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    let r = data;
    if (statusF !== "ALL") r = r.filter(x => x.status === statusF);
    if (modeF   !== "ALL") r = r.filter(x => x.mode   === modeF);
    if (actionF)           r = r.filter(x => x.needsAction);
    if (q) { const lq = q.toLowerCase(); r = r.filter(x => x.id?.toLowerCase().includes(lq) || x.name?.toLowerCase().includes(lq) || x.city?.toLowerCase().includes(lq)); }
    return [...r].sort((a, b) => {
      const va = a[sortK] ?? ""; const vb = b[sortK] ?? "";
      return va < vb ? sortD : va > vb ? -sortD : 0;
    });
  }, [data, statusF, modeF, actionF, q, sortK, sortD]);

  const pages = Math.ceil(filtered.length / PS);
  const pageData = filtered.slice(pg * PS, (pg + 1) * PS);
  useEffect(() => setPg(0), [statusF, modeF, actionF, q]);

  const toggleSort = (k) => { if (sortK === k) setSortD(d => -d); else { setSortK(k); setSortD(-1); } };
  const SortArr = ({ k }) => sortK !== k
    ? <span style={{ opacity: 0.2, marginLeft: 2 }}>↕</span>
    : <span style={{ color: T.accent, marginLeft: 2 }}>{sortD === -1 ? "↓" : "↑"}</span>;

  const glass = (extra = {}) => ({
    background: "linear-gradient(135deg, rgba(13,19,32,0.85) 0%, rgba(8,12,20,0.95) 100%)",
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    border: `1px solid ${T.border}`, borderRadius: 14, ...extra,
  });

  const kanbanGroups = useMemo(() => {
    const groups = { RUNNING: [], REVIEW: [], FAILED: [], ENGINE_ERROR: [], REJECTED: [], COMPLETED: [] };
    filtered.forEach(r => { if (groups[r.status]) groups[r.status].push(r); });
    return groups;
  }, [filtered]);

  const tooltipStyle = { background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 11, color: T.text1 };

  if (loading && data.length === 0) {
    return (
      <div style={{ fontFamily: "'Outfit',system-ui,sans-serif", background: T.bg0, color: T.text2, minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
        <span style={{ fontSize: 14, opacity: 0.5 }}>Loading requests…</span>
      </div>
    );
  }

  return (
    <div className="co-dash" style={{ fontFamily: "'Outfit','Satoshi',system-ui,sans-serif", background: T.bg0, color: T.text1, minHeight: "60vh", borderRadius: 8, overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Ambient glow */}
      <div style={{ position: "absolute", top: -200, right: -200, width: 600, height: 600, borderRadius: "50%",
        background: `radial-gradient(circle, ${T.accentGlow} 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, padding: "16px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20,
          opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(-10px)", transition: "all 0.5s" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
                letterSpacing: 2, textTransform: "uppercase", color: T.accent,
                background: T.accentGlow, padding: "2px 8px", borderRadius: 4, border: `1px solid ${T.accent}33` }}>CREDIT OPS</span>
              <span style={{ fontSize: 10, color: T.text3, fontFamily: "'JetBrains Mono',monospace" }}>v5.2</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text0, letterSpacing: -0.8 }}>Requests Dashboard</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {stats.act > 0 && (
              <div style={{ ...glass({ padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }), borderColor: `${T.amber}44` }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.amber, boxShadow: `0 0 8px ${T.amber}` }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: T.amber, fontFamily: "'JetBrains Mono',monospace" }}>{stats.act}</span>
                <span style={{ fontSize: 11, color: T.text2 }}>needs action</span>
              </div>
            )}
            <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
              {["table", "kanban"].map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: "5px 14px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", letterSpacing: 0.5,
                  background: view === v ? T.accent : T.bg2, color: view === v ? "#fff" : T.text3, transition: "all 0.2s",
                }}>{v}</button>
              ))}
            </div>
            <button onClick={loadRequests} style={{ ...glass({ padding: "5px 12px" }), cursor: "pointer", color: T.text2, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
              {loading ? "…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 16,
          opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(10px)", transition: "all 0.6s 0.1s" }}>
          {[
            { l: "Total Requests", v: stats.total,    c: T.text0,  sub: `${Math.round(stats.total / 7)}/day avg` },
            { l: "Approved",       v: stats.bySt.COMPLETED || 0, c: T.green,  sub: `${stats.total ? Math.round((stats.bySt.COMPLETED || 0) / stats.total * 100) : 0}% rate` },
            { l: "Rejected",       v: stats.bySt.REJECTED  || 0, c: T.red,    sub: `${stats.total ? Math.round((stats.bySt.REJECTED  || 0) / stats.total * 100) : 0}% rate` },
            { l: "In Review",      v: stats.bySt.REVIEW    || 0, c: T.amber,  sub: "manual check" },
            { l: "Avg Duration",   v: `${stats.avgDur}s`,        c: T.cyan,   sub: "end-to-end"   },
            { l: "Avg Score",      v: stats.avgScore || "—",     c: T.purple, sub: "credit score"  },
          ].map((m, i) => (
            <div key={i} style={{ ...glass({ padding: "14px 16px" }), cursor: "default" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = T.borderHover}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
              <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: T.text3, marginBottom: 6 }}>{m.l}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: m.c, fontVariantNumeric: "tabular-nums", lineHeight: 1, letterSpacing: -1 }}>{m.v}</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "5fr 3fr 2fr", gap: 10, marginBottom: 16,
          opacity: mounted ? 1 : 0, transition: "all 0.6s 0.2s" }}>
          <div style={{ ...glass({ padding: "14px 16px" }) }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: T.text3, marginBottom: 8 }}>Daily trend — approvals vs failures</div>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={stats.daily}>
                <defs>
                  <linearGradient id="coGOk"   x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.green} stopOpacity={0.3}/><stop offset="100%" stopColor={T.green} stopOpacity={0.01}/></linearGradient>
                  <linearGradient id="coGFail" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.red}   stopOpacity={0.25}/><stop offset="100%" stopColor={T.red}   stopOpacity={0.01}/></linearGradient>
                </defs>
                <XAxis dataKey="d" tick={{ fontSize: 9, fill: T.text3 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="ok"   stroke={T.green} fill="url(#coGOk)"   strokeWidth={2}   name="Approved" />
                <Area type="monotone" dataKey="fail" stroke={T.red}   fill="url(#coGFail)" strokeWidth={1.5} strokeDasharray="4 3" name="Failed/Rejected" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...glass({ padding: "14px 16px" }) }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: T.text3, marginBottom: 8 }}>Hourly volume</div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={stats.hourly} barCategoryGap={1}>
                <XAxis dataKey="h" tick={{ fontSize: 8, fill: T.text3 }} axisLine={false} tickLine={false} interval={3} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="v" radius={[2, 2, 0, 0]} name="Requests">
                  {stats.hourly.map((e, i) => <Cell key={i} fill={e.v > (stats.total / 24 * 1.5) ? T.accent : `${T.accent}55`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...glass({ padding: "14px 16px", display: "flex", flexDirection: "column" }) }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: T.text3, marginBottom: 4 }}>Status mix</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <ResponsiveContainer width="55%" height={90}>
                <PieChart>
                  <Pie data={stats.pie} dataKey="value" innerRadius={22} outerRadius={38} paddingAngle={2} strokeWidth={0}>
                    {stats.pie.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {stats.pie.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                    <span style={{ color: T.text2 }}>{p.name.slice(0, 9)}</span>
                    <span style={{ color: T.text3, fontFamily: "'JetBrains Mono',monospace", marginLeft: "auto" }}>{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ ...glass({ padding: "8px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }),
          opacity: mounted ? 1 : 0, transition: "all 0.6s 0.3s" }}>
          <div style={{ position: "relative" }}>
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 12px 6px 30px",
                color: T.text1, fontSize: 12, width: 200, outline: "none", fontFamily: "'Outfit',sans-serif" }}
              onFocus={e => e.target.style.borderColor = T.accent}
              onBlur={e => e.target.style.borderColor = T.border} />
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: T.text3 }}>⌕</span>
          </div>

          <div style={{ display: "flex", gap: 3 }}>
            {["ALL", ...ST].map(s => {
              const active = statusF === s;
              const cnt = s === "ALL" ? stats.total : stats.bySt[s] || 0;
              const sc = STATUS_MAP[s];
              return (
                <button key={s} onClick={() => setStatusF(s)} style={{
                  padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 600,
                  fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.3,
                  border: active ? `1px solid ${sc?.c || T.accent}55` : "1px solid transparent",
                  background: active ? (sc?.bg || T.accent + "22") : "transparent",
                  color: active ? (sc?.c || T.accent) : T.text3, transition: "all 0.15s",
                }}>
                  {s === "ALL" ? "all" : s.toLowerCase().replace("_", " ")}
                  <span style={{ marginLeft: 4, opacity: 0.5 }}>{cnt}</span>
                </button>
              );
            })}
          </div>

          <div style={{ width: 1, height: 20, background: T.border }} />

          <div style={{ display: "flex", gap: 3 }}>
            {["ALL", "flowable", "custom"].map(m => (
              <button key={m} onClick={() => setModeF(m)} style={{
                padding: "4px 9px", borderRadius: 6, border: "1px solid transparent", cursor: "pointer",
                fontSize: 10.5, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace",
                background: modeF === m ? T.bg3 : "transparent", color: modeF === m ? T.text1 : T.text3, transition: "all 0.15s",
              }}>{m === "ALL" ? "all modes" : m}</button>
            ))}
          </div>

          <button onClick={() => setActionF(!actionF)} style={{
            padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 700,
            fontFamily: "'JetBrains Mono',monospace",
            border: actionF ? `1px solid ${T.amber}55` : "1px solid transparent",
            background: actionF ? T.amberDim : "transparent", color: actionF ? T.amber : T.text3, transition: "all 0.15s",
          }}>⚡ action{actionF ? " ✓" : ""}</button>

          <div style={{ marginLeft: "auto", fontSize: 11, color: T.text3, fontFamily: "'JetBrains Mono',monospace" }}>
            {filtered.length} results{view === "table" && ` · pg ${pg + 1}/${pages || 1}`}
          </div>
        </div>

        {/* Table view */}
        {view === "table" && (<>
          <div style={{ ...glass({ padding: 0, overflow: "hidden", marginBottom: 12 }),
            opacity: mounted ? 1 : 0, transition: "all 0.6s 0.4s" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {[
                    { k: "id", l: "Request ID", w: "13%" }, { k: "name", l: "Applicant", w: "13%" },
                    { k: "status", l: "Status", w: "10%" }, { k: "mode", l: "Mode", w: "7%" },
                    { k: "score", l: "Score", w: "9%" }, { k: "reason", l: "Decision Reason", w: "22%" },
                    { k: "dur", l: "Time", w: "7%" }, { k: "ts", l: "Created", w: "7%" }, { k: "act", l: "", w: "5%" },
                  ].map(col => (
                    <th key={col.k} onClick={() => ["id", "status", "score", "dur", "ts"].includes(col.k) && toggleSort(col.k)}
                      style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: 0.8, color: T.text3, width: col.w,
                        cursor: ["id", "status", "score", "dur", "ts"].includes(col.k) ? "pointer" : "default",
                        userSelect: "none", fontFamily: "'JetBrains Mono',monospace" }}>
                      {col.l}{["id", "status", "score", "dur", "ts"].includes(col.k) && <SortArr k={col.k} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageData.map(r => {
                  const isSel = sel === r.id;
                  return (
                    <tr key={r.id} onClick={() => setSel(isSel ? null : r.id)}
                      style={{ borderBottom: `1px solid ${T.bg0}`, cursor: "pointer", background: isSel ? T.bg3 : "transparent", transition: "background 0.12s" }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = T.bg2; }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}>
                      <td style={{ padding: "7px 10px", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 11.5, color: T.text0 }}>{r.id}</td>
                      <td style={{ padding: "7px 10px" }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: T.text0 }}>{r.name}</div>
                        <div style={{ fontSize: 10, color: T.text3 }}>{r.city}</div>
                      </td>
                      <td style={{ padding: "7px 10px" }}><Pill status={r.status} /></td>
                      <td style={{ padding: "7px 10px" }}><Mode mode={r.mode} /></td>
                      <td style={{ padding: "7px 10px" }}><ScoreGauge score={r.score} /></td>
                      <td style={{ padding: "7px 10px", fontSize: 11, color: T.text2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: T.text2 }}>{r.dur > 0 ? `${(r.dur / 1000).toFixed(1)}s` : "—"}</td>
                      <td style={{ padding: "7px 10px" }}><Elapsed iso={r.created} /></td>
                      <td style={{ padding: "7px 10px", textAlign: "center" }}>
                        {r.needsAction && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: T.amber, boxShadow: `0 0 8px ${T.amber}88`, animation: "coPulse 2s infinite" }} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 16 }}>
            <button onClick={() => setPg(Math.max(0, pg - 1))} disabled={pg === 0}
              style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg1, color: pg === 0 ? T.text3 : T.text2, cursor: pg === 0 ? "default" : "pointer", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>←</button>
            {Array.from({ length: Math.min(9, pages) }, (_, i) => {
              let n;
              if (pages <= 9) n = i; else if (pg < 4) n = i; else if (pg > pages - 5) n = pages - 9 + i; else n = pg - 4 + i;
              return (
                <button key={n} onClick={() => setPg(n)} style={{
                  padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11,
                  fontFamily: "'JetBrains Mono',monospace", fontWeight: pg === n ? 700 : 400,
                  background: pg === n ? T.accent : T.bg1, color: pg === n ? "#fff" : T.text3, transition: "all 0.15s",
                }}>{n + 1}</button>
              );
            })}
            <button onClick={() => setPg(Math.min(pages - 1, pg + 1))} disabled={pg >= pages - 1}
              style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg1, color: pg >= pages - 1 ? T.text3 : T.text2, cursor: pg >= pages - 1 ? "default" : "pointer", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>→</button>
          </div>
        </>)}

        {/* Kanban view */}
        {view === "kanban" && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Object.keys(kanbanGroups).length}, 1fr)`, gap: 10, marginBottom: 20,
            opacity: mounted ? 1 : 0, transition: "all 0.6s 0.4s" }}>
            {Object.entries(kanbanGroups).map(([status, kItems]) => {
              const sc = STATUS_MAP[status];
              return (
                <div key={status} style={{ ...glass({ padding: 0, overflow: "hidden" }) }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc?.c, boxShadow: `0 0 6px ${sc?.c}` }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", letterSpacing: 0.5, color: sc?.c }}>{status.toLowerCase().replace("_", " ")}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: T.text3, background: T.bg3, padding: "1px 6px", borderRadius: 4 }}>{kItems.length}</span>
                  </div>
                  <div style={{ maxHeight: 420, overflowY: "auto", padding: 6 }}>
                    {kItems.slice(0, 30).map(r => (
                      <div key={r.id} onClick={() => setSel(sel === r.id ? null : r.id)}
                        style={{ padding: "8px 10px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
                          background: sel === r.id ? T.bg3 : "transparent", border: `1px solid ${sel === r.id ? T.borderHover : "transparent"}`, transition: "background 0.12s" }}
                        onMouseEnter={e => { if (sel !== r.id) e.currentTarget.style.background = T.bg2; }}
                        onMouseLeave={e => { if (sel !== r.id) e.currentTarget.style.background = "transparent"; }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", color: T.text0 }}>{r.id?.slice(-10)}</span>
                          {r.needsAction && <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.amber, animation: "coPulse 2s infinite" }} />}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: T.text1, marginBottom: 2 }}>{r.name}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <ScoreGauge score={r.score} /><Mode mode={r.mode} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Detail drawer */}
        {sel && (() => {
          const r = data.find(x => x.id === sel);
          if (!r) return null;
          return (
            <div style={{ ...glass({ padding: 20, marginBottom: 20, borderColor: STATUS_MAP[r.status]?.c + "33" }), animation: "coSlideUp 0.25s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: T.text0 }}>{r.id}</span>
                  <Pill status={r.status} />
                  <Mode mode={r.mode} />
                </div>
                <button onClick={() => setSel(null)} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text2, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>ESC · close</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 20 }}>
                <div>
                  <KV label="Applicant">{r.name}</KV>
                  <KV label="Location">{r.city}</KV>
                  <KV label="Created" mono>{r.created.slice(0, 19).replace("T", " ")}</KV>
                </div>
                <div>
                  <KV label="Decision Reason">{r.reason}</KV>
                  <KV label="Duration" mono>{r.dur > 0 ? `${(r.dur / 1000).toFixed(1)}s` : "—"}</KV>
                </div>
                <div>
                  <KV label="Credit Score">
                    <span style={{ fontSize: 22, fontWeight: 800, color: r.score >= 580 ? T.green : r.score > 0 ? T.red : T.text3 }}>
                      {r.score || "—"}
                    </span>
                  </KV>
                  <KV label="Collections" mono>{r.collections}</KV>
                  <KV label="Creditsafe Alerts" mono>{r.alerts}</KV>
                </div>
                <div>
                  {r.needsAction ? (
                    <div style={{ padding: 12, borderRadius: 10, background: T.amberDim, border: `1px solid ${T.amber}33` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 8 }}>⚡ ACTION REQUIRED</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["Retry as new", "Clone", "Ignore", "Add note"].map(a => (
                          <button key={a} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer", border: `1px solid ${T.amber}44`, background: "transparent", color: T.amber }}>{a}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 12, borderRadius: 10, background: T.greenDim, border: `1px solid ${T.green}22` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.green }}>✓ No action needed</div>
                      <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>Request processed successfully</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <style>{`
        @keyframes coPulse   { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
        @keyframes coSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .co-dash * { box-sizing: border-box; }
        .co-dash ::-webkit-scrollbar { width:4px; }
        .co-dash ::-webkit-scrollbar-track { background: ${T.bg0}; }
        .co-dash ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius:2px; }
      `}</style>
    </div>
  );
}
