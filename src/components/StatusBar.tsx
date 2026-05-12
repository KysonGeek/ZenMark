import { useEffect, useState } from 'react'
import type { ViewMode } from '../App'
import type { Theme } from '../lib/theme'

interface Props {
  savedAt: number | null
  wordCount: number
  theme: Theme
  mode: ViewMode
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onSetMode: (mode: ViewMode) => void
  onExport: () => void
}

const MODE_OPTIONS: { value: ViewMode; label: string; title: string }[] = [
  { value: 'wyg', label: 'Edit', title: 'Edit (default)' },
  { value: 'read', label: 'Read', title: 'Read-only — drag-select copies clean text (⇧⌘R)' },
  { value: 'source', label: 'Source', title: 'Markdown source (⌘/)' },
]

export function StatusBar({
  savedAt,
  wordCount,
  theme,
  mode,
  onToggleTheme,
  onToggleSidebar,
  onSetMode,
  onExport,
}: Props) {
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
      <div className="mode-switch" role="tablist" aria-label="View mode">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            role="tab"
            aria-selected={mode === opt.value}
            className={`mode-switch-btn${mode === opt.value ? ' selected' : ''}`}
            onClick={() => onSetMode(opt.value)}
            title={opt.title}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <button onClick={onExport} title="Export current doc (⇧⌘E)">Export</button>
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
