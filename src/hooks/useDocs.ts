import { useCallback, useEffect, useState } from 'react'
import { deriveTitle } from '../lib/deriveTitle'
import { type Doc, deleteDoc, getDoc, listDocs, putDoc } from '../lib/storage'

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
  saveDoc: (docId: string, content: string) => Promise<void>
  error: string | null
  setActiveId: (id: string) => void
  createDoc: (content?: string) => Promise<string>
  // Returns the id of any blank placeholder we had to spin up because the
  // user deleted the last remaining doc — undo can use it to clean up.
  removeDoc: (id: string) => Promise<{ placeholderId: string | null }>
  // Re-insert a previously-deleted doc with its original id/timestamps. Used
  // by the Undo affordance on the delete toast.
  restoreDoc: (doc: Doc) => Promise<void>
  // Rename a doc. Empty `title` reverts to the H1-derived title and clears
  // the override flag.
  renameDoc: (id: string, title: string) => Promise<void>
  importDoc: (content: string) => Promise<string>
}

export function useDocs(): UseDocsApi {
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setDocs(await listDocs())
  }, [])

  // First load.
  useEffect(() => {
    (async () => {
      try {
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
        if (initial) setActiveIdState(initial.id)
        setReady(true)
      } catch (err) {
        console.error('Failed to load docs', err)
        setError(err instanceof Error ? err.message : String(err))
        setReady(true)
      }
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

  const saveDoc = useCallback(async (id: string, content: string) => {
    // Read fresh from storage so a deleted doc isn't accidentally resurrected.
    const existing = await getDoc(id)
    if (!existing) return
    // Respect a user-set title: only re-derive from the H1 when the user has
    // not manually renamed this doc.
    const nextTitle = existing.titleOverridden ? existing.title : deriveTitle(content)
    await putDoc({
      ...existing,
      content,
      title: nextTitle,
      updatedAt: Date.now(),
    })
    await refresh()
  }, [refresh])

  const removeDoc = useCallback(async (id: string): Promise<{ placeholderId: string | null }> => {
    await deleteDoc(id)
    const remaining = await listDocs()
    setDocs(remaining)
    let placeholderId: string | null = null
    if (activeId === id) {
      const next = remaining[0]?.id ?? null
      if (next) setActiveId(next)
      else {
        // No docs left → create a fresh blank one. Track it so undo can
        // remove it after restoring the original doc.
        placeholderId = await createDoc()
      }
    }
    return { placeholderId }
  }, [activeId, createDoc, setActiveId])

  const restoreDoc = useCallback(async (doc: Doc) => {
    await putDoc(doc)
    await refresh()
    setActiveId(doc.id)
  }, [refresh, setActiveId])

  const renameDoc = useCallback(async (id: string, title: string) => {
    const existing = await getDoc(id)
    if (!existing) return
    const trimmed = title.trim()
    // Empty input clears the override and falls back to the H1-derived title.
    // Non-empty input pins the user-supplied title until they clear it again.
    const next: Doc = trimmed.length === 0
      ? { ...existing, title: deriveTitle(existing.content), titleOverridden: false, updatedAt: Date.now() }
      : { ...existing, title: trimmed, titleOverridden: true, updatedAt: Date.now() }
    if (next.title === existing.title && !!next.titleOverridden === !!existing.titleOverridden) {
      // Nothing actually changed — avoid bumping updatedAt for no reason.
      return
    }
    await putDoc(next)
    await refresh()
  }, [refresh])

  const importDoc = useCallback((content: string) => createDoc(content), [createDoc])

  const activeDoc = docs.find((d) => d.id === activeId) ?? null

  return {
    docs,
    activeId,
    activeDoc,
    ready,
    error,
    setActiveId,
    createDoc,
    saveDoc,
    removeDoc,
    restoreDoc,
    renameDoc,
    importDoc,
  }
}
