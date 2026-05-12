import { useEffect } from 'react'

interface Handlers {
  onNew: () => void
  onExport: () => void
  onForceSave: () => void
  onToggleSidebar: () => void
  onFocusSearch: () => void
  onQuickOpen: () => void
  onToggleSource: () => void
  onToggleRead: () => void
}

export function useShortcuts(h: Handlers) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (e.shiftKey) {
        // ⇧⌘E exports (was ⌘S). ⇧⌘R toggles read-only view.
        if (key === 'e') { e.preventDefault(); h.onExport() }
        else if (key === 'r') { e.preventDefault(); h.onToggleRead() }
        return
      }
      if (key === 'n') { e.preventDefault(); h.onNew() }
      else if (key === 's') { e.preventDefault(); h.onForceSave() }
      else if (key === '\\') { e.preventDefault(); h.onToggleSidebar() }
      else if (key === 'k') { e.preventDefault(); h.onFocusSearch() }
      else if (key === 'p') { e.preventDefault(); h.onQuickOpen() }
      else if (key === '/') { e.preventDefault(); h.onToggleSource() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [h])
}
