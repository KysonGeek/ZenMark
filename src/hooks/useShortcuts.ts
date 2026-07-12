import { useEffect, useRef } from 'react'

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
  // Keep the latest handlers in a ref so the global keydown listener can stay
  // bound for the lifetime of the component. Re-registering on every render
  // (because `h` is a fresh object each time) caused add/remove churn on each
  // keystroke and silently dropped events if a handler changed identity mid-dispatch.
  const ref = useRef(h)
  ref.current = h

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const cur = ref.current
      const key = e.key.toLowerCase()
      if (e.shiftKey) {
        // ⇧⌘E exports (was ⌘S). ⇧⌘R toggles read-only view.
        if (key === 'e') { e.preventDefault(); cur.onExport() }
        else if (key === 'r') { e.preventDefault(); cur.onToggleRead() }
        return
      }
      if (key === 'n') { e.preventDefault(); cur.onNew() }
      else if (key === 's') { e.preventDefault(); cur.onForceSave() }
      else if (key === '\\') { e.preventDefault(); cur.onToggleSidebar() }
      else if (key === 'k') { e.preventDefault(); cur.onFocusSearch() }
      else if (key === 'p') { e.preventDefault(); cur.onQuickOpen() }
      else if (key === '/') { e.preventDefault(); cur.onToggleSource() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}