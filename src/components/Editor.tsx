import { Crepe } from '@milkdown/crepe'
import { useEffect, useRef } from 'react'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import '../styles/editor-overrides.css'

const SAVE_DEBOUNCE_MS = 500

interface Props {
  docId: string                  // re-mounts Crepe on change (via React `key`)
  initialContent: string
  onSave: (docId: string, content: string) => void
}

export function Editor({ docId, initialContent, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const latestRef = useRef(initialContent)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return
    const crepe = new Crepe({
      root: hostRef.current,
      defaultValue: initialContent,
    })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md) => {
        latestRef.current = md
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          onSaveRef.current(docId, md)
        }, SAVE_DEBOUNCE_MS)
      })
    })
    crepe.create().catch((err) => {
      console.error('Crepe failed to mount', err)
    })
    return () => {
      // Flush any pending save synchronously so doc switches and unmounts
      // don't drop the last keystrokes.
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        onSaveRef.current(docId, latestRef.current)
      }
      crepe.destroy().catch(() => {
        // ignore destroy errors during unmount
      })
    }
    // initialContent + docId are captured intentionally on mount; doc switches
    // remount this component via React `key`. Crepe has no setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="editor-host" />
}
