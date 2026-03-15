const DEFAULT_API_BASE = (() => {
  if (import.meta.env?.VITE_CONFIG_API_URL) return import.meta.env.VITE_CONFIG_API_URL
  const port = window.location.port || ''
  const useSameOrigin = !port || port === '80' || port === '443'
  return useSameOrigin
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:8000`
})()

const API_BASE_STORAGE_KEY = 'credit-platform.api-base'
const API_KEY_STORAGE_KEY = 'credit-platform.api-key'
const USER_ROLE_STORAGE_KEY = 'credit-platform.user-role'
const USERNAME_STORAGE_KEY = 'credit-platform.user-name'

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'senior_analyst', label: 'Senior Analyst' },
  { value: 'analyst', label: 'Analyst' },
]

function normalizeBaseUrl(value) {
  const trimmed = (value || '').trim()
  return trimmed.replace(/\/+$/, '')
}

export function getDefaultApiBase() {
  return normalizeBaseUrl(DEFAULT_API_BASE)
}

function readSessionValue(key) {
  return (sessionStorage.getItem(key) || localStorage.getItem(key) || '').trim()
}

function writeSessionValue(key, value) {
  const normalized = (value || '').trim()
  sessionStorage.removeItem(key)
  localStorage.removeItem(key)
  if (normalized) sessionStorage.setItem(key, normalized)
  return normalized
}

function normalizeUserRole(value) {
  const normalized = (value || '').trim().toLowerCase()
  return ROLE_OPTIONS.some((option) => option.value === normalized) ? normalized : 'admin'
}

export function getApiBase() {
  return normalizeBaseUrl(localStorage.getItem(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE)
}

export function setApiBase(value) {
  const normalized = normalizeBaseUrl(value)
  localStorage.setItem(API_BASE_STORAGE_KEY, normalized)
  return normalized
}

export function getApiKey() {
  return readSessionValue(API_KEY_STORAGE_KEY)
}

export function setApiKey(value) {
  return writeSessionValue(API_KEY_STORAGE_KEY, value)
}

export function clearApiKey() {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY)
  localStorage.removeItem(API_KEY_STORAGE_KEY)
}

export function getUserRole() {
  return normalizeUserRole(readSessionValue(USER_ROLE_STORAGE_KEY))
}

export function setUserRole(value) {
  const normalized = normalizeUserRole(value)
  writeSessionValue(USER_ROLE_STORAGE_KEY, normalized)
  return normalized
}

export function getRoleLabel(value) {
  return ROLE_OPTIONS.find((option) => option.value === normalizeUserRole(value))?.label || 'Admin'
}

export function getCurrentUsername() {
  return readSessionValue(USERNAME_STORAGE_KEY)
}

export function setCurrentUsername(value) {
  return writeSessionValue(USERNAME_STORAGE_KEY, value)
}

export function clearAuth() {
  clearApiKey()
  sessionStorage.removeItem(USER_ROLE_STORAGE_KEY)
  localStorage.removeItem(USER_ROLE_STORAGE_KEY)
  sessionStorage.removeItem(USERNAME_STORAGE_KEY)
  localStorage.removeItem(USERNAME_STORAGE_KEY)
}

export function hasUiSession() {
  return !!(getCurrentUsername() || getApiKey())
}

async function parseError(response) {
  try {
    const body = await response.json()
    if (body?.detail) return `${response.status} ${body.detail}`
    if (body?.error) return `${response.status} ${body.error}`
  } catch {}
  return `${response.status} ${response.statusText}`
}

export async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {})
  const apiKey = getApiKey()
  const userRole = getUserRole()
  const username = getCurrentUsername()
  if (opts.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (apiKey && !headers.has('X-Api-Key')) {
    headers.set('X-Api-Key', apiKey)
  }
  if (userRole && !headers.has('X-User-Role')) {
    headers.set('X-User-Role', userRole)
  }
  if (username && !headers.has('X-User-Name')) {
    headers.set('X-User-Name', username)
  }

  const response = await fetch(`${getApiBase()}${path}`, { ...opts, headers })
  if (!response.ok) {
    throw new Error(await parseError(response))
  }
  if (response.status === 204) return null
  return response.json()
}

export const get = (path) => api(path)
export const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) })
export const put = (path, data) => api(path, { method: 'PUT', body: JSON.stringify(data) })
export const del = (path) => api(path, { method: 'DELETE' })

export async function login({ username, password, baseUrl }) {
  const resolvedBase = setApiBase(baseUrl || getApiBase())
  const response = await fetch(`${resolvedBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    throw new Error(await parseError(response))
  }
  const data = await response.json()
  setApiKey(data.api_key || '')
  setUserRole(data.role || 'analyst')
  setCurrentUsername(data.username || username)
  return data
}
