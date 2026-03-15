import { useEffect, useMemo, useState } from 'react'

import Dashboard from './pages/Dashboard'
import ServicesPage from './pages/ServicesPage'
import UsersPage from './pages/UsersPage'
import RoutingPage from './pages/RoutingPage'
import StopFactorsPage from './pages/StopFactorsPage'
import PipelinePage from './pages/PipelinePage'
import ProcessTrackerPage from './pages/ProcessTrackerPage'
import FlowableAdminPage from './pages/FlowableAdminPage'
import RequestsPage from './pages/RequestsPage'
import AuditPage from './pages/AuditPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import { clearAuth, getApiBase, getApiKey, getCurrentUsername, getRoleLabel, getUserRole, hasUiSession } from './lib/api'
import { IconGrid, IconSettings, IconRoute, IconAlert, IconList, IconUsers, IconClipboard, IconActivity, IconClock, IconGear, IconLayers } from './components/Icons'

const ROLE_LEVELS = { analyst: 1, senior_analyst: 2, admin: 3 }

const sections = [
  {
    group: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', Icon: IconGrid, minRole: 'analyst' }],
  },
  {
    group: 'Configuration',
    items: [
      { id: 'services', label: 'Services', Icon: IconSettings, minRole: 'senior_analyst' },
      { id: 'routing', label: 'Routing rules', Icon: IconRoute, minRole: 'senior_analyst' },
      { id: 'stopfactors', label: 'Stop factors', Icon: IconAlert, minRole: 'senior_analyst' },
      { id: 'pipeline', label: 'Pipeline', Icon: IconList, minRole: 'senior_analyst' },
      { id: 'users', label: 'Users & access', Icon: IconUsers, minRole: 'admin' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'requests', label: 'Requests', Icon: IconClipboard, minRole: 'analyst' },
      { id: 'tracker', label: 'Process tracker', Icon: IconActivity, minRole: 'analyst' },
      { id: 'flowable', label: 'Flowable engine', Icon: IconLayers, minRole: 'analyst' },
      { id: 'audit', label: 'Audit log', Icon: IconClock, minRole: 'analyst' },
      { id: 'settings', label: 'Settings', Icon: IconGear, minRole: 'analyst' },
    ],
  },
]

const pageTitle = {
  dashboard: ['Dashboard', 'Platform overview and health status'],
  services: ['Services', 'Manage service registry, URLs and retries'],
  users: ['Users & access', 'Create users, assign roles, manage sessions'],
  routing: ['Routing rules', 'Control flowable vs custom routing'],
  stopfactors: ['Stop factors', 'Pre and post checks for request decisions'],
  pipeline: ['Pipeline', 'Connector execution order'],
  flowable: ['Flowable engine', 'Inspect and manage Flowable instances, jobs and process definitions'],
  tracker: ['Process tracker', 'Trace request steps with waterfall timeline'],
  requests: ['Requests', 'Credit check request lifecycle'],
  audit: ['Audit log', 'Configuration change history'],
  settings: ['Settings', 'Configure API base URL and view session info'],
}

function hasMinRole(role, min) {
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[min] || 0)
}

export default function App() {
  const [apiMeta, setApiMeta] = useState(() => ({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  }))
  const [active, setActive] = useState('dashboard')

  const refresh = () => setApiMeta({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  })

  const isAuth = hasUiSession()

  const visibleSections = useMemo(
    () => sections
      .map(s => ({ ...s, items: s.items.filter(i => hasMinRole(apiMeta.role, i.minRole)) }))
      .filter(s => s.items.length > 0),
    [apiMeta.role],
  )

  const visibleIds = useMemo(() => visibleSections.flatMap(s => s.items.map(i => i.id)), [visibleSections])
  const current = visibleIds.includes(active) ? active : (visibleIds[0] || 'dashboard')

  useEffect(() => {
    if (!visibleIds.includes(active)) setActive(visibleIds[0] || 'dashboard')
  }, [active, visibleIds])

  const [title, subtitle] = pageTitle[current] || ['', '']

  const canManageConfig = hasMinRole(apiMeta.role, 'senior_analyst')
  const canAdmin = hasMinRole(apiMeta.role, 'admin')

  const content = useMemo(() => {
    switch (current) {
      case 'services': return <ServicesPage canEdit={canAdmin} />
      case 'users': return <UsersPage canEdit={canAdmin} />
      case 'routing': return <RoutingPage canEdit={canManageConfig} />
      case 'stopfactors': return <StopFactorsPage canEdit={canManageConfig} />
      case 'pipeline': return <PipelinePage canEdit={canManageConfig} />
      case 'flowable': return <FlowableAdminPage canManage={canManageConfig} />
      case 'tracker': return <ProcessTrackerPage />
      case 'requests': return <RequestsPage />
      case 'audit': return <AuditPage />
      case 'settings': return <SettingsPage onSave={refresh} />
      default: return <Dashboard />
    }
  }, [apiMeta.role, current])

  const handleLogout = () => {
    clearAuth()
    refresh()
    setActive('dashboard')
  }

  if (!isAuth) return <LoginPage onLogin={refresh} />

  const initials = (apiMeta.username || 'U').slice(0, 2).toUpperCase()

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon"><IconLayers /></div>
          <div>
            <div className="logo-text">Credit Platform</div>
            <div className="logo-sub">Admin Console v5.1</div>
          </div>
        </div>

        {visibleSections.map(section => (
          <div className="nav-group" key={section.group}>
            <div className="nav-label">{section.group}</div>
            {section.items.map(item => (
              <button
                key={item.id}
                className={`nav-btn${current === item.id ? ' active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                <item.Icon />
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div>
              <div className="sidebar-name">{apiMeta.username || 'session'}</div>
              <div className="sidebar-role">{getRoleLabel(apiMeta.role)}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm sidebar-logout" onClick={handleLogout}>Log out</button>
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
