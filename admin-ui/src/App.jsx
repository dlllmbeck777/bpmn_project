import { useEffect, useMemo, useState } from 'react'

import Dashboard from './pages/Dashboard'
import ServicesPage from './pages/ServicesPage'
import UsersPage from './pages/UsersPage'
import ProcessTrackerPage from './pages/ProcessTrackerPage'
import FlowableOpsPage from './pages/FlowableOpsPage'
import RequestsPage from './pages/RequestsPage'
import CreditOpsDashboard from './pages/CreditOpsDashboard'
import AuditPage from './pages/AuditPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import ControlCenterPage from './pages/ControlCenterPage'
import { getTheme, setTheme } from './lib/theme'
import { clearAuth, getApiBase, getApiKey, getCurrentUsername, getRoleLabel, getUserRole, hasUiSession } from './lib/api'
import { getStartPage } from './lib/preferences'
import { getLang, setLang, t, LANGUAGES } from './lib/i18n'
import { IconGrid, IconSettings, IconRoute, IconUsers, IconClipboard, IconActivity, IconClock, IconGear, IconLayers } from './components/Icons'

const ROLE_LEVELS = { analyst: 1, senior_analyst: 2, admin: 3 }

function hasMinRole(role, min) {
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[min] || 0)
}

const ALL_PAGES = [
  { id: 'dashboard', group: 'nav_dashboard', Icon: IconGrid,      minRole: 'analyst' },
  { id: 'tracker',   group: 'nav_monitoring', Icon: IconActivity,  minRole: 'analyst' },
  { id: 'flowable',  group: 'nav_monitoring', Icon: IconLayers,    minRole: 'analyst' },
  { id: 'audit',     group: 'nav_monitoring', Icon: IconClock,     minRole: 'analyst' },
  { id: 'requests',  group: 'nav_analysis',   Icon: IconClipboard, minRole: 'analyst' },
  { id: 'creditops', group: 'nav_analysis',   Icon: IconActivity,  minRole: 'analyst' },
  { id: 'control',   group: 'nav_control',    Icon: IconRoute,     minRole: 'senior_analyst' },
  { id: 'services',  group: 'nav_control',    Icon: IconSettings,  minRole: 'senior_analyst' },
  { id: 'users',     group: 'nav_control',    Icon: IconUsers,     minRole: 'admin' },
  { id: 'settings',  group: 'nav_settings',   Icon: IconGear,      minRole: 'analyst' },
]

const GROUP_ORDER = ['nav_dashboard','nav_monitoring','nav_analysis','nav_control','nav_settings']

export default function App() {
  const [apiMeta, setApiMeta] = useState(() => ({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  }))
  const [active, setActive] = useState(() => {
    const hash = window.location.hash.replace(/^#\/?/, '').split('/')[0]
    const validIds = ALL_PAGES.map(p => p.id)
    return validIds.includes(hash) ? hash : getStartPage()
  })
  const [theme, setThemeState] = useState(() => getTheme())
  const [lang, setLangState] = useState(() => getLang())
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      const saved = localStorage.getItem('nav_collapsed')
      if (saved !== null) return JSON.parse(saved)
    } catch {}
    return Object.fromEntries(GROUP_ORDER.map(g => [g, true]))
  })

  useEffect(() => { window.location.hash = active }, [active])

  const refresh = () => setApiMeta({
    base: getApiBase(), hasKey: !!getApiKey(), role: getUserRole(), username: getCurrentUsername(),
  })

  const toggleGroup = (group) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [group]: !prev[group] }
      localStorage.setItem('nav_collapsed', JSON.stringify(next))
      return next
    })
  }

  const handleLangChange = (code) => { setLang(code); setLangState(code) }
  const tr = (key) => t(key, lang)

  const isAuth = hasUiSession()

  const visiblePages = useMemo(
    () => ALL_PAGES.filter(p => hasMinRole(apiMeta.role, p.minRole)),
    [apiMeta.role],
  )

  const visibleSections = useMemo(() => {
    return GROUP_ORDER
      .map(group => ({ group, items: visiblePages.filter(p => p.group === group) }))
      .filter(s => s.items.length > 0)
  }, [visiblePages])

  const visibleIds = useMemo(() => visiblePages.map(p => p.id), [visiblePages])
  const visibleItems = useMemo(() => visiblePages, [visiblePages])
  const current = visibleIds.includes(active) ? active : (visibleIds[0] || 'dashboard')

  useEffect(() => {
    if (!visibleIds.includes(active)) setActive(visibleIds[0] || 'dashboard')
  }, [active, visibleIds])

  const title    = tr(`page_${current}`)
  const subtitle = tr(`sub_${current}`)

  const canManageConfig = hasMinRole(apiMeta.role, 'senior_analyst')
  const canAdmin = hasMinRole(apiMeta.role, 'admin')

  const handleThemeChange = (value) => { const n = setTheme(value); setThemeState(n); return n }
  const handleThemeToggle = () => handleThemeChange(theme === 'dark' ? 'light' : 'dark')

  const content = useMemo(() => {
    switch (current) {
      case 'control':  return <ControlCenterPage canEdit={canManageConfig} canAdmin={canAdmin} onNavigate={setActive} />
      case 'services': return <ServicesPage canEdit={canAdmin} />
      case 'users':    return <UsersPage canEdit={canAdmin} />
      case 'flowable': return <FlowableOpsPage canManage={canManageConfig} />
      case 'tracker':  return <ProcessTrackerPage />
      case 'requests':  return <RequestsPage />
      case 'creditops': return <CreditOpsDashboard />
      case 'audit':     return <AuditPage />
      case 'settings': return <SettingsPage onSave={refresh} theme={theme} onThemeChange={handleThemeChange} availablePages={visibleItems.map(p=>({...p,label:tr(`page_${p.id}`)}))} currentPage={current} onNavigate={setActive} />
      default:         return <Dashboard />
    }
  }, [canAdmin, canManageConfig, current, theme, visibleItems, lang])

  const handleLogout = () => { clearAuth(); refresh(); setActive(getStartPage()) }

  if (!isAuth) return <LoginPage onLogin={refresh} />

  const initials = (apiMeta.username || 'U').slice(0, 2).toUpperCase()
  const currentLang = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]

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

        {visibleSections.map(section => {
          const collapsed = !!collapsedGroups[section.group]
          return (
            <div className="nav-group" key={section.group}>
              <div
                className={`nav-label nav-label-toggle${collapsed ? ' collapsed' : ''}`}
                onClick={() => toggleGroup(section.group)}
                title={collapsed ? tr('expand') : tr('collapse')}
              >
                {tr(section.group)}
                <span className="nav-chevron">{collapsed ? '›' : '‹'}</span>
              </div>
              {!collapsed && section.items.map(item => (
                <button
                  key={item.id}
                  className={`nav-btn${current === item.id ? ' active' : ''}`}
                  onClick={() => setActive(item.id)}
                >
                  <item.Icon />
                  {tr(`page_${item.id}`)}
                </button>
              ))}
            </div>
          )
        })}

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div>
              <div className="sidebar-name">{apiMeta.username || 'session'}</div>
              <div className="sidebar-role">{getRoleLabel(apiMeta.role)}</div>
            </div>
          </div>

          {/* Language selector */}
          <div className="lang-selector">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`lang-btn${lang === l.code ? ' active' : ''}`}
                onClick={() => handleLangChange(l.code)}
                title={l.label}
              >
                {l.flag}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost btn-sm sidebar-theme" onClick={handleThemeToggle}>
            {tr('theme')}: {theme === 'dark' ? tr('theme_dark') : tr('theme_light')}
          </button>
          <button className="btn btn-ghost btn-sm sidebar-logout" onClick={handleLogout}>{tr('logout')}</button>
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
