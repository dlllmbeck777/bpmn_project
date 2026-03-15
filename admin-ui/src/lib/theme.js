const THEME_STORAGE_KEY = 'credit-platform.theme'

export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'

export const THEME_OPTIONS = [
  { value: THEME_LIGHT, label: 'Light' },
  { value: THEME_DARK, label: 'Dark' },
]

function normalizeTheme(value) {
  return value === THEME_DARK ? THEME_DARK : THEME_LIGHT
}

export function getTheme() {
  if (typeof window === 'undefined') return THEME_LIGHT
  return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY) || THEME_LIGHT)
}

export function applyTheme(value) {
  const theme = normalizeTheme(value)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }
  return theme
}

export function setTheme(value) {
  const theme = normalizeTheme(value)
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
  return applyTheme(theme)
}

export function initializeTheme() {
  return applyTheme(getTheme())
}
