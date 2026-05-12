import { Crepe } from '@milkdown/crepe'
import { useEffect, useRef } from 'react'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import '../styles/editor-overrides.css'

interface Props {
  docId: string                  // re-mounts Crepe on change (via React `key`)
  initialContent: string
  onChange: (markdown: string) => void
}

export function Editor({ initialContent, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const crepe = new Crepe({
      root: hostRef.current,
      defaultValue: initialContent,
    })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md) => onChange(md))
    })
    crepe.create().catch((err) => {
      console.error('Crepe failed to mount', err)
    })
    return () => {
      crepe.destroy().catch(() => {
        // ignore destroy errors during unmount
      })
    }
    // Intentionally NOT depending on initialContent — the parent uses
    // a React `key={docId}` so a doc switch remounts this whole component,
    // which is the only way to load new content (Crepe has no setMarkdown).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="editor-host" />
}
