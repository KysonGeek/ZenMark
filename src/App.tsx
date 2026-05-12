import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useDocs } from './hooks/useDocs'
import { useShortcuts } from './hooks/useShortcuts'
import { downloadMarkdown } from './lib/ioFile'
import { applyTheme, getStoredTheme, type Theme } from './lib/theme'
import './styles/theme.css'
import './styles/app.css'

const SAVE_DEBOUNCE_MS = 500
const SIDEBAR_KEY = 'markra.sidebarOpen'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  })
  const [theme, setTheme] = useState<Theme>('light')
  const docs = useDocs()
  const saveTimer = useRef<number | null>(null)
  const [savingAt, setSavingAt] = useState<number | null>(null)

  useEffect(() => {
    const t = getStoredTheme()
    setTheme(t)
    applyTheme(t)
  }, [])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen))
  }, [sidebarOpen])

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

  const onToggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }, [theme])

  const onExport = useCallback(() => {
    if (docs.activeDoc) {
      downloadMarkdown(docs.activeDoc.title, docs.activeDoc.content)
    }
  }, [docs.activeDoc])

  const onFocusSearch = useCallback(() => {
    if (!sidebarOpen) setSidebarOpen(true)
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('.sidebar-search input')
      el?.focus()
    }, 0)
  }, [sidebarOpen])

  useShortcuts({
    onNew: () => docs.createDoc(),
    onExport,
    onToggleSidebar: () => setSidebarOpen((v) => !v),
    onFocusSearch,
  })

  if (!docs.ready || !docs.activeDoc) {
    return <div className="app"><main className="editor-pane" /></div>
  }

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      {sidebarOpen && (
        <Sidebar
          docs={docs.docs}
          activeId={docs.activeId}
          onSelect={docs.setActiveId}
          onCreate={() => docs.createDoc()}
          onDelete={(id) => docs.removeDoc(id)}
        />
      )}
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
      <StatusBar
        savedAt={savingAt}
        wordCount={countWords(docs.activeDoc.content)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onExport={onExport}
      />
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
