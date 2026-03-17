const START_PAGE_STORAGE_KEY = 'credit-platform.start-page'
const CONTROL_TAB_STORAGE_KEY = 'credit-platform.control-tab'

const START_PAGE_OPTIONS = ['dashboard', 'control', 'services', 'users', 'requests', 'tracker', 'flowable', 'audit', 'settings']
const CONTROL_TAB_OPTIONS = ['routing', 'stopfactors', 'decisionrules', 'pipeline']

function readStoredValue(key) {
  return (localStorage.getItem(key) || '').trim()
}

export function getStartPage() {
  const stored = readStoredValue(START_PAGE_STORAGE_KEY)
  return START_PAGE_OPTIONS.includes(stored) ? stored : 'dashboard'
}

export function setStartPage(value) {
  const normalized = (value || '').trim()
  const next = START_PAGE_OPTIONS.includes(normalized) ? normalized : 'dashboard'
  localStorage.setItem(START_PAGE_STORAGE_KEY, next)
  return next
}

export function getControlCenterTab() {
  const stored = readStoredValue(CONTROL_TAB_STORAGE_KEY)
  return CONTROL_TAB_OPTIONS.includes(stored) ? stored : 'routing'
}

export function setControlCenterTab(value) {
  const normalized = (value || '').trim()
  const next = CONTROL_TAB_OPTIONS.includes(normalized) ? normalized : 'routing'
  localStorage.setItem(CONTROL_TAB_STORAGE_KEY, next)
  return next
}
