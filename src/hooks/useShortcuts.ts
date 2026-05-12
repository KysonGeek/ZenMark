import { useEffect } from 'react'

interface Handlers {
  onNew: () => void
  onExport: () => void
  onToggleSidebar: () => void
  onFocusSearch: () => void
}

export function useShortcuts(h: Handlers) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); h.onNew() }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); h.onExport() }
      else if (e.key === '\\') { e.preventDefault(); h.onToggleSidebar() }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); h.onFocusSearch() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [h])
}
