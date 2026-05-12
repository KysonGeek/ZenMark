import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { Outline } from './components/Outline'
import { Sidebar } from './components/Sidebar'
import { SourceEditor } from './components/SourceEditor'
import { StatusBar } from './components/StatusBar'
import { useDocs } from './hooks/useDocs'
import { useShortcuts } from './hooks/useShortcuts'
import { downloadMarkdown } from './lib/ioFile'
import { parseOutline } from './lib/parseOutline'
import { applyTheme, getStoredTheme, type Theme } from './lib/theme'
import './styles/theme.css'
import './styles/app.css'

const SIDEBAR_KEY = 'markra.sidebarOpen'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  })
  const [theme, setTheme] = useState<Theme>('light')
  const [sourceMode, setSourceMode] = useState(false)
  const docs = useDocs()
  const [savingAt, setSavingAt] = useState<number | null>(null)
  // Holds the latest in-memory content so a mode switch can seed the next
  // editor before the previous editor's async save has landed in storage.
  const latestContentRef = useRef<string>('')
  // Tracks which doc id `latestContentRef` belongs to. Required because when
  // the user switches files, this component re-renders *before* the useEffect
  // below gets a chance to reset the ref — so without this guard the freshly
  // mounted <Editor> for doc B would read doc A's content out of the ref as
  // its initialContent (and then overwrite B in storage on the next save).
  const latestContentDocIdRef = useRef<string | null>(null)
  // Same value as latestContentRef but reactive — drives the live outline
  // without forcing the editor to remount on every keystroke.
  const [liveContent, setLiveContent] = useState<string>('')
  const editorRef = useRef<EditorHandle>(null)

  const activeDocId = docs.activeDoc?.id
  const activeDocContent = docs.activeDoc?.content
  useEffect(() => {
    latestContentRef.current = activeDocContent ?? ''
    latestContentDocIdRef.current = activeDocId ?? null
    setLiveContent(activeDocContent ?? '')
  }, [activeDocId, activeDocContent])

  const outlineItems = useMemo(() => parseOutline(liveContent), [liveContent])

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

  const onContentUpdate = useCallback((md: string) => {
    // Only adopt this update if it belongs to the currently active doc. Late
    // updates from a previous doc's editor (e.g. fired during unmount) must
    // not poison the new doc's in-memory content.
    if (latestContentDocIdRef.current !== activeDocId) return
    latestContentRef.current = md
    setLiveContent(md)
  }, [activeDocId])

  const onToggleSource = useCallback(() => {
    setSourceMode((v) => !v)
  }, [])

  useShortcuts({
    onNew: () => docs.createDoc(),
    onExport,
    onToggleSidebar: () => setSidebarOpen((v) => !v),
    onFocusSearch,
    onToggleSource,
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

  // Seed the editor with the freshest in-memory content *iff* our ref still
  // belongs to this doc. If the ref is stale (e.g. still holding doc A while
  // we've just switched to doc B), fall back to the doc's persisted content.
  const seedContent =
    latestContentDocIdRef.current === docs.activeDoc.id
      ? latestContentRef.current || docs.activeDoc.content
      : docs.activeDoc.content

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
          {sourceMode ? (
            <SourceEditor
              key={`${docs.activeDoc.id}-src`}
              docId={docs.activeDoc.id}
              initialContent={seedContent}
              onContentUpdate={onContentUpdate}
              onSave={onSaveDoc}
            />
          ) : (
            <Editor
              key={`${docs.activeDoc.id}-wyg`}
              ref={editorRef}
              docId={docs.activeDoc.id}
              initialContent={seedContent}
              onContentUpdate={onContentUpdate}
              onSave={onSaveDoc}
            />
          )}
        </div>
      </main>
      {!sourceMode && (
        <Outline
          items={outlineItems}
          onJump={(it) => editorRef.current?.scrollToHeading(it.index)}
        />
      )}
      <StatusBar
        savedAt={savingAt}
        wordCount={countWords(docs.activeDoc.content)}
        theme={theme}
        sourceMode={sourceMode}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleSource={onToggleSource}
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
