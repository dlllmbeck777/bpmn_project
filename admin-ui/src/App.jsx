import { useEffect, useMemo, useState } from 'react'

import Dashboard from './pages/Dashboard'
import ServicesPage from './pages/ServicesPage'
import UsersPage from './pages/UsersPage'
import RoutingPage from './pages/RoutingPage'
import StopFactorsPage from './pages/StopFactorsPage'
import PipelinePage from './pages/PipelinePage'
import ProcessTrackerPage from './pages/ProcessTrackerPage'
import FlowableOpsPage from './pages/FlowableOpsPage'
import RequestsPage from './pages/RequestsPage'
import AuditPage from './pages/AuditPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import { clearAuth, getApiBase, getApiKey, getCurrentUsername, getRoleLabel, getUserRole, hasUiSession } from './lib/api'

// SVG icon components — keeps markup clean, no extra dependency
const NavIcon = ({ id }) => {
  const icons = {
    dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    services:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>,
    users:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    routing:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>,
    stopfactors: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
    pipeline:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
    flowableops: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    tracker:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    requests:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    audit:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    settings:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  }
  return icons[id] || null
}

const ROLE_LEVELS = { analyst: 1, senior_analyst: 2, admin: 3 }

const sections = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', minRole: 'analyst' }] },
  {
    group: 'Configuration',
    items: [
      { id: 'services',     label: 'Services',      minRole: 'senior_analyst' },
      { id: 'users',        label: 'Users & Access', minRole: 'admin' },
      { id: 'routing',      label: 'Routing Rules',  minRole: 'senior_analyst' },
      { id: 'stopfactors',  label: 'Stop Factors',   minRole: 'senior_analyst' },
      { id: 'pipeline',     label: 'Pipeline',       minRole: 'senior_analyst' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'flowableops', label: 'Flowable Ops',    minRole: 'analyst' },
      { id: 'tracker',     label: 'Process Tracker', minRole: 'analyst' },
      { id: 'requests',    label: 'Requests',        minRole: 'analyst' },
      { id: 'audit',       label: 'Audit Log',       minRole: 'analyst' },
      { id: 'settings',    label: 'Settings',        minRole: 'analyst' },
    ],
  },
]

const pageTitle = {
  dashboard:   ['Dashboard',         'Platform overview and health status'],
  services:    ['Services',          'Manage service registry, URLs and retries'],
  users:       ['Users & Access',    'Create users, assign roles and revoke sessions'],
  routing:     ['Routing Rules',     'Control flowable vs custom routing'],
  stopfactors: ['Stop Factors',      'Pre and post checks for request decisions'],
  pipeline:    ['Pipeline',          'Order connector execution chain'],
  flowableops: ['Flowable Ops',      'Inspect Flowable instances, jobs, and controlled recovery actions'],
  tracker:     ['Process Tracker',   'Trace request steps, payloads, and skipped chains'],
  requests:    ['Requests',          'Inspect submitted credit check requests'],
  audit:       ['Audit Log',         'Review configuration changes'],
  settings:    ['Settings',          'Configure API base URL, key and role used by this UI'],
}

function hasMinRole(role, minimumRole) {
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[minimumRole] || 0)
}

function getDefaultSection(role) {
  return sections
    .flatMap((section) => section.items)
    .find((item) => hasMinRole(role, item.minRole))?.id || 'dashboard'
}

function roleClass(role) {
  if (role === 'admin') return 'role-admin'
  if (role === 'senior_analyst') return 'role-senior'
  return 'role-analyst'
}

function avatarInitials(username) {
  if (!username) return '?'
  const parts = username.split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return username.slice(0, 2).toUpperCase()
}

export default function App() {
  const [apiMeta, setApiMeta] = useState(() => ({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  }))
  const [active, setActive] = useState(() => getDefaultSection(getUserRole()))

  const refreshApiMeta = () => setApiMeta({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  })
  const isAuthenticated = hasUiSession()

  const visibleSections = useMemo(
    () => sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => hasMinRole(apiMeta.role, item.minRole)),
      }))
      .filter((section) => section.items.length > 0),
    [apiMeta.role],
  )

  const visibleIds = useMemo(() => visibleSections.flatMap((section) => section.items.map((item) => item.id)), [visibleSections])
  const currentPage = visibleIds.includes(active) ? active : (visibleIds[0] || 'dashboard')
  const [title, subtitle] = pageTitle[currentPage] || ['', '']

  useEffect(() => {
    if (!visibleIds.includes(active)) setActive(visibleIds[0] || 'dashboard')
  }, [active, visibleIds])

  const content = useMemo(() => {
    const canManageConfig    = hasMinRole(apiMeta.role, 'senior_analyst')
    const canManageServices  = hasMinRole(apiMeta.role, 'admin')
    switch (currentPage) {
      case 'services':    return <ServicesPage canEdit={canManageServices} />
      case 'users':       return <UsersPage canEdit={canManageServices} />
      case 'routing':     return <RoutingPage canEdit={canManageConfig} />
      case 'stopfactors': return <StopFactorsPage canEdit={canManageConfig} />
      case 'pipeline':    return <PipelinePage canEdit={canManageConfig} />
      case 'flowableops': return <FlowableOpsPage canManage={canManageConfig} />
      case 'tracker':     return <ProcessTrackerPage />
      case 'requests':    return <RequestsPage />
      case 'audit':       return <AuditPage />
      case 'settings':    return <SettingsPage onSave={refreshApiMeta} />
      default:            return <Dashboard />
    }
  }, [apiMeta.role, currentPage])

  const handleLogout = () => {
    clearAuth()
    refreshApiMeta()
    setActive('dashboard')
  }

  if (!isAuthenticated) return <LoginPage onLogin={refreshApiMeta} />

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">CP</div>
          <div>
            <div className="logo-text">Credit Platform</div>
            <div className="logo-sub">Admin Console v2.1</div>
          </div>
        </div>

        {visibleSections.map((section) => (
          <div className="nav-group" key={section.group}>
            <div className="nav-label">{section.group}</div>
            {section.items.map((item) => (
              <button
                key={item.id}
                className={`nav-btn ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                <span className="icon"><NavIcon id={item.id} /></span>
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div className="sidebar-avatar">{avatarInitials(apiMeta.username)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{apiMeta.username || 'session'}</div>
              <span className={`role-badge ${roleClass(apiMeta.role)}`}>{getRoleLabel(apiMeta.role)}</span>
            </div>
          </div>
          <div className="sidebar-meta">API</div>
          <div className="mono sidebar-copy" style={{ fontSize: 11, wordBreak: 'break-all' }}>{apiMeta.base}</div>
          <button className="btn btn-ghost btn-sm sidebar-logout" onClick={handleLogout}>Log Out</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="page-header">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {content}
      </main>
    </div>
  )
}
