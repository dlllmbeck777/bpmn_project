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

const icons = {
  dashboard: '[]',
  services: '<>',
  users: 'US',
  routing: '->',
  stopfactors: 'SF',
  pipeline: '||',
  flowableops: 'FO',
  tracker: 'TR',
  requests: 'RQ',
  audit: 'LG',
  settings: '::',
}

const ROLE_LEVELS = {
  analyst: 1,
  senior_analyst: 2,
  admin: 3,
}

const sections = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: icons.dashboard, minRole: 'analyst' }] },
  {
    group: 'Configuration',
    items: [
      { id: 'services', label: 'Services', icon: icons.services, minRole: 'senior_analyst' },
      { id: 'users', label: 'Users & Access', icon: icons.users, minRole: 'admin' },
      { id: 'routing', label: 'Routing Rules', icon: icons.routing, minRole: 'senior_analyst' },
      { id: 'stopfactors', label: 'Stop Factors', icon: icons.stopfactors, minRole: 'senior_analyst' },
      { id: 'pipeline', label: 'Pipeline', icon: icons.pipeline, minRole: 'senior_analyst' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'flowableops', label: 'Flowable Ops', icon: icons.flowableops, minRole: 'analyst' },
      { id: 'tracker', label: 'Process Tracker', icon: icons.tracker, minRole: 'analyst' },
      { id: 'requests', label: 'Requests', icon: icons.requests, minRole: 'analyst' },
      { id: 'audit', label: 'Audit Log', icon: icons.audit, minRole: 'analyst' },
      { id: 'settings', label: 'Settings', icon: icons.settings, minRole: 'analyst' },
    ],
  },
]

const pageTitle = {
  dashboard: ['Dashboard', 'Platform overview and health status'],
  services: ['Services', 'Manage service registry, URLs and retries'],
  users: ['Users & Access', 'Create users, assign roles, disable accounts and revoke sessions'],
  routing: ['Routing Rules', 'Control flowable vs custom routing'],
  stopfactors: ['Stop Factors', 'Pre and post checks for request decisions'],
  pipeline: ['Pipeline', 'Order connector execution chain'],
  flowableops: ['Flowable Ops', 'Inspect Flowable instances, jobs, and controlled recovery actions'],
  tracker: ['Process Tracker', 'Trace request steps, payloads, and skipped chains'],
  requests: ['Requests', 'Inspect submitted credit check requests'],
  audit: ['Audit Log', 'Review configuration changes'],
  settings: ['Settings', 'Configure API base URL, key and role used by this UI'],
}

function hasMinRole(role, minimumRole) {
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[minimumRole] || 0)
}

function getDefaultSection(role) {
  return sections
    .flatMap((section) => section.items)
    .find((item) => hasMinRole(role, item.minRole))?.id || 'dashboard'
}

export default function App() {
  const [apiMeta, setApiMeta] = useState(() => ({ base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername() }))
  const [active, setActive] = useState(() => getDefaultSection(getUserRole()))

  const refreshApiMeta = () => setApiMeta({ base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername() })
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
    const canManageConfig = hasMinRole(apiMeta.role, 'senior_analyst')
    const canManageServices = hasMinRole(apiMeta.role, 'admin')

    switch (currentPage) {
      case 'services':
        return <ServicesPage canEdit={canManageServices} />
      case 'users':
        return <UsersPage canEdit={canManageServices} />
      case 'routing':
        return <RoutingPage canEdit={canManageConfig} />
      case 'stopfactors':
        return <StopFactorsPage canEdit={canManageConfig} />
      case 'pipeline':
        return <PipelinePage canEdit={canManageConfig} />
      case 'flowableops':
        return <FlowableOpsPage canManage={canManageConfig} />
      case 'tracker':
        return <ProcessTrackerPage />
      case 'requests':
        return <RequestsPage />
      case 'audit':
        return <AuditPage />
      case 'settings':
        return <SettingsPage onSave={refreshApiMeta} />
      default:
        return <Dashboard />
    }
  }, [apiMeta.role, currentPage])

  const handleLogout = () => {
    clearAuth()
    refreshApiMeta()
    setActive('dashboard')
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={refreshApiMeta} />
  }

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
              <button key={item.id} className={`nav-btn ${currentPage === item.id ? 'active' : ''}`} onClick={() => setActive(item.id)}>
                <span className="icon">{item.icon}</span> {item.label}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="sidebar-meta">User</div>
          <div className="mono sidebar-copy">{apiMeta.username || 'session'}</div>
          <div className="sidebar-meta">API</div>
          <div className="mono sidebar-copy">{apiMeta.base}</div>
          <div className="sidebar-meta">Role</div>
          <div className="mono sidebar-copy">{getRoleLabel(apiMeta.role)}</div>
          <div className="sidebar-meta">Key</div>
          <div className="mono sidebar-copy">{apiMeta.hasKey ? 'configured' : 'not set'}</div>
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
