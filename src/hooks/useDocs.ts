import { useCallback, useEffect, useState } from 'react'
import { deriveTitle } from '../lib/deriveTitle'
import { type Doc, deleteDoc, listDocs, putDoc } from '../lib/storage'

const LAST_ID_KEY = 'markra.lastOpenedDocId'

const WELCOME_CONTENT = `# Welcome

This is **md.qixin.ch** — a local-only markdown editor.

## What you should know

- Your documents live in this browser's **IndexedDB**. They do not sync.
- Clearing site data will erase them. Use **Export** to back up.
- Drag a \`.md\` file onto this window to import it.

## Try it

Press \`/\` for the slash menu. Try a table:

| col a | col b |
| ----- | ----- |
| 1     | 2     |

Or math: $E = mc^2$.

Have fun.
`

export interface UseDocsApi {
  docs: Doc[]
  activeId: string | null
  activeDoc: Doc | null
  ready: boolean
  setActiveId: (id: string) => void
  createDoc: (content?: string) => Promise<string>
  saveActive: (content: string) => Promise<void>
  removeDoc: (id: string) => Promise<void>
  importDoc: (content: string) => Promise<string>
}

export function useDocs(): UseDocsApi {
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    setDocs(await listDocs())
  }, [])

  // First load.
  useEffect(() => {
    (async () => {
      let all = await listDocs()
      if (all.length === 0) {
        const id = crypto.randomUUID()
        const now = Date.now()
        await putDoc({
          id,
          title: deriveTitle(WELCOME_CONTENT),
          content: WELCOME_CONTENT,
          createdAt: now,
          updatedAt: now,
        })
        all = await listDocs()
      }
      setDocs(all)
      const lastId = localStorage.getItem(LAST_ID_KEY)
      const initial = (lastId && all.find((d) => d.id === lastId)) || all[0]
      setActiveIdState(initial.id)
      setReady(true)
    })()
  }, [])

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
    localStorage.setItem(LAST_ID_KEY, id)
  }, [])

  const createDoc = useCallback(async (content = '# Untitled\n\n') => {
    const id = crypto.randomUUID()
    const now = Date.now()
    await putDoc({
      id,
      title: deriveTitle(content),
      content,
      createdAt: now,
      updatedAt: now,
    })
    await refresh()
    setActiveId(id)
    return id
  }, [refresh, setActiveId])

  const saveActive = useCallback(async (content: string) => {
    if (!activeId) return
    const existing = docs.find((d) => d.id === activeId)
    if (!existing) return
    await putDoc({
      ...existing,
      content,
      title: deriveTitle(content),
      updatedAt: Date.now(),
    })
    await refresh()
  }, [activeId, docs, refresh])

  const removeDoc = useCallback(async (id: string) => {
    await deleteDoc(id)
    const remaining = await listDocs()
    setDocs(remaining)
    if (activeId === id) {
      const next = remaining[0]?.id ?? null
      if (next) setActiveId(next)
      else {
        // No docs left → create a fresh blank one.
        await createDoc()
      }
    }
  }, [activeId, createDoc, setActiveId])

  const importDoc = useCallback((content: string) => createDoc(content), [createDoc])

  const activeDoc = docs.find((d) => d.id === activeId) ?? null

  return {
    docs,
    activeId,
    activeDoc,
    ready,
    setActiveId,
    createDoc,
    saveActive,
    removeDoc,
    importDoc,
  }
}
