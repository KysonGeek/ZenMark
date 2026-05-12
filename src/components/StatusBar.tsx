import { useEffect, useState } from 'react'

interface Props {
  savedAt: number | null
  wordCount: number
}

export function StatusBar({ savedAt, wordCount }: Props) {
  const [, setTick] = useState(0)

  // Refresh "saved Xs ago" label every 5s.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <footer className="statusbar">
      <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
      <span>{savedAt ? `saved ${formatAgo(savedAt)}` : 'unsaved'}</span>
      <span className="spacer" />
      <span style={{ opacity: 0.7 }}>md.qixin.ch</span>
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
