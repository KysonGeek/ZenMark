import { useCallback, useEffect, useState } from 'react'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useDocs } from './hooks/useDocs'
import { useShortcuts } from './hooks/useShortcuts'
import { downloadMarkdown } from './lib/ioFile'
import { applyTheme, getStoredTheme, type Theme } from './lib/theme'
import './styles/theme.css'
import './styles/app.css'

const SIDEBAR_KEY = 'markra.sidebarOpen'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  })
  const [theme, setTheme] = useState<Theme>('light')
  const docs = useDocs()
  const [savingAt, setSavingAt] = useState<number | null>(null)

  useEffect(() => {
    const t = getStoredTheme()
    setTheme(t)
    applyTheme(t)
  }, [])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen))
  }, [sidebarOpen])

  const onSaveDoc = useCallback(async (docId: string, md: string) => {
    try {
      await docs.saveDoc(docId, md)
      setSavingAt(Date.now())
    } catch (err) {
      console.error('save failed', err)
    }
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

  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDragOver(true)
      }
    }
    function onDragLeave(e: DragEvent) {
      if (e.relatedTarget === null) setDragOver(false)
    }
    async function onDrop(e: DragEvent) {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.md') && f.type !== 'text/markdown') continue
        const content = await f.text()
        await docs.importDoc(content)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [docs])

  useShortcuts({
    onNew: () => docs.createDoc(),
    onExport,
    onToggleSidebar: () => setSidebarOpen((v) => !v),
    onFocusSearch,
  })

  if (!docs.ready) {
    return (
      <div className="app">
        <main className="editor-pane">
          <div className="editor-root" style={{ padding: 32, color: 'var(--text-muted)' }}>
            Loading…
          </div>
        </main>
      </div>
    )
  }
  if (docs.error) {
    return (
      <div className="app">
        <main className="editor-pane">
          <div className="editor-root" style={{ padding: 32 }}>
            <h2>Can’t open local storage</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              This editor stores documents in your browser via IndexedDB, but it
              looks like that isn’t available. Common causes: private/incognito
              mode with strict settings, browser policy, or quota exhaustion.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Error: {docs.error}
            </p>
          </div>
        </main>
      </div>
    )
  }
  if (!docs.activeDoc) {
    return <div className="app"><main className="editor-pane" /></div>
  }

  return (
    <div
      className="app"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      data-dragover={dragOver ? 'true' : undefined}
    >
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
            onSave={onSaveDoc}
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
