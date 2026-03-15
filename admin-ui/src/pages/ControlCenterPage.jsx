import { useMemo, useState } from 'react'

import { getControlCenterTab, setControlCenterTab } from '../lib/preferences'
import ScenariosPage from './ScenariosPage'
import RoutingPage from './RoutingPage'
import StopFactorsPage from './StopFactorsPage'
import PipelinePage from './PipelinePage'

const tabs = [
  {
    id: 'scenarios',
    label: 'Scenarios',
    summary: 'Apply ready-made operating modes without visiting four separate pages.',
  },
  {
    id: 'routing',
    label: 'Routing rules',
    summary: 'Control how auto traffic is split between custom and Flowable.',
  },
  {
    id: 'stopfactors',
    label: 'Stop factors',
    summary: 'Manage pre and post checks that can reject or review requests.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    summary: 'Adjust connector order and mode-specific skip behavior.',
  },
]

export default function ControlCenterPage({ canEdit, canAdmin, onNavigate }) {
  const [activeTab, setActiveTabState] = useState(() => getControlCenterTab())

  const setActiveTab = (tabId) => {
    setActiveTabState(setControlCenterTab(tabId))
  }

  const currentTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
    [activeTab],
  )

  const tabContent = useMemo(() => {
    switch (currentTab.id) {
      case 'routing':
        return <RoutingPage canEdit={canEdit} />
      case 'stopfactors':
        return <StopFactorsPage canEdit={canEdit} />
      case 'pipeline':
        return <PipelinePage canEdit={canEdit} />
      default:
        return <ScenariosPage canEdit={canEdit} />
    }
  }, [canEdit, currentTab.id])

  return (
    <div className="control-shell">
      <div className="card mb-16">
        <div className="control-header">
          <div>
            <div className="card-title">Configuration control center</div>
            <p className="muted">
              Keep routing, stop logic, and connector execution in one working area. Services and access stay separate,
              because they have broader operational impact.
            </p>
          </div>
          <div className="control-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.('services')}>Open services</button>
            {canAdmin && <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.('users')}>Open users & access</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.('settings')}>Workspace settings</button>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn${currentTab.id === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="control-summary">
          <div className="sum-card">
            <div className="sum-label">Current workspace</div>
            <div className="sum-val">{currentTab.label}</div>
          </div>
          <div className="notice">{currentTab.summary}</div>
        </div>
      </div>

      {tabContent}
    </div>
  )
}
