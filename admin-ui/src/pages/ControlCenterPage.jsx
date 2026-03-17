import { useMemo, useState } from 'react'

import { getControlCenterTab, setControlCenterTab } from '../lib/preferences'
import RoutingPage from './RoutingPage'
import StopFactorsPage from './StopFactorsPage'
import DecisionRulesPage from './DecisionRulesPage'
import PipelinePage from './PipelinePage'

const tabs = [
  {
    id: 'routing',
    label: 'Routing',
    summary: 'Choose one routing policy: all to custom, all to auto / flowable, or rule-based with an explicit fallback.',
  },
  {
    id: 'stopfactors',
    label: 'Stop factors',
    summary: 'Manage pre and post stop logic without mixing it with final Flowable decisioning.',
  },
  {
    id: 'decisionrules',
    label: 'Decision rules',
    summary: 'Edit the Flowable-only rules that run after external reports are collected and parsed.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    summary: 'Adjust connector order and mode-specific skip behavior without mixing it with routing logic.',
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
        return <StopFactorsPage canEdit={canEdit} stageOptions={['', 'pre', 'post']} />
      case 'decisionrules':
        return <DecisionRulesPage canEdit={canEdit} />
      case 'pipeline':
        return <PipelinePage canEdit={canEdit} />
      default:
        return <RoutingPage canEdit={canEdit} />
    }
  }, [canEdit, currentTab.id])

  return (
    <div className="control-shell">
      <div className="card mb-16">
        <div className="control-header">
          <div>
            <div className="card-title">Orchestration workspace</div>
            <p className="muted">
              Routing, stop logic, and pipeline stay together here. Services and access remain separate so the
              operational path is simpler and does not duplicate the same controls in multiple places.
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
