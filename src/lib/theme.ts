export type Theme = 'light' | 'dark'

const KEY = 'markra.theme'

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(KEY)
  if (v === 'dark' || v === 'light') return v
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(KEY, theme)
}
