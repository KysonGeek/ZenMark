import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useDocs } from './hooks/useDocs'
import { applyTheme, getStoredTheme } from './lib/theme'
import './styles/theme.css'
import './styles/app.css'

const SAVE_DEBOUNCE_MS = 500

export default function App() {
  const [sidebarOpen] = useState(true)
  const docs = useDocs()
  const saveTimer = useRef<number | null>(null)
  const [savingAt, setSavingAt] = useState<number | null>(null)

  useEffect(() => {
    applyTheme(getStoredTheme())
  }, [])

  const onEditorChange = useCallback((md: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        await docs.saveActive(md)
        setSavingAt(Date.now())
      } catch (err) {
        console.error('save failed', err)
      }
    }, SAVE_DEBOUNCE_MS)
  }, [docs])

  if (!docs.ready || !docs.activeDoc) {
    return <div className="app"><main className="editor-pane" /></div>
  }

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <Sidebar />
      <main className="editor-pane">
        <div className="editor-root">
          <Editor
            key={docs.activeDoc.id}
            docId={docs.activeDoc.id}
            initialContent={docs.activeDoc.content}
            onChange={onEditorChange}
          />
        </div>
      </main>
      <StatusBar savedAt={savingAt} wordCount={countWords(docs.activeDoc.content)} />
    </div>
  )
}

function countWords(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`~\-+]/g, ' ')
  const tokens = stripped.trim().match(/\S+/g)
  return tokens ? tokens.length : 0
}
