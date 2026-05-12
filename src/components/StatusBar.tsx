import { useEffect, useState } from 'react'
import type { Theme } from '../lib/theme'

interface Props {
  savedAt: number | null
  wordCount: number
  theme: Theme
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onExport: () => void
}

export function StatusBar({ savedAt, wordCount, theme, onToggleTheme, onToggleSidebar, onExport }: Props) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <footer className="statusbar">
      <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
      <span>{savedAt ? `saved ${formatAgo(savedAt)}` : 'unsaved'}</span>
      <span className="spacer" />
      <button onClick={onExport} title="Export current doc (⌘S)">Export</button>
      <button onClick={onToggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
      <button onClick={onToggleSidebar} title="Toggle sidebar (⌘\\)">⌘\</button>
    </footer>
  )
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}
