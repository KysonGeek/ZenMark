import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deriveTitle } from '../lib/deriveTitle'
import { type Doc, deleteDocs, getDoc, listDocs, putDoc, moveDoc as storageMoveDoc } from '../lib/storage'
import { buildTree, collectSubtreeIds, findSubtreeRoot, nextOrder, type TreeNode } from '../lib/tree'

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
  tree: TreeNode[]
  activeId: string | null
  activeDoc: Doc | null
  ready: boolean
  saveDoc: (docId: string, content: string) => Promise<void>
  error: string | null
  setActiveId: (id: string) => void
  // Create a page. Pass parentId to create it as a child page.
  createDoc: (content?: string, parentId?: string | null) => Promise<string>
  // Cascade-deletes the page and its entire subtree. Returns a snapshot of
  // every deleted doc (for whole-subtree Undo) plus any blank placeholder we
  // had to create because the last remaining doc was deleted.
  removeDoc: (id: string) => Promise<{ docs: Doc[]; placeholderId: string | null }>
  // Re-insert a previously-deleted subtree with original ids/parentId/order.
  restoreDoc: (docs: Doc[]) => Promise<void>
  // Rename a doc. Empty `title` reverts to the H1-derived title and clears
  // the override flag.
  renameDoc: (id: string, title: string) => Promise<void>
  importDoc: (content: string) => Promise<string>
  // Reparent/reorder a page. parentId=null moves it to the root.
  moveDoc: (id: string, parentId: string | null, order: number) => Promise<void>
}

export function useDocs(): UseDocsApi {
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mirror of `docs` for synchronous reads inside async callbacks without a
  // full `listDocs()` round-trip. Kept in sync on every render.
  const docsRef = useRef<Doc[]>(docs)
  docsRef.current = docs

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
            parentId: null,
            order: 0,
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

  const createDoc = useCallback(async (content = '# Untitled\n\n', parentId: string | null = null) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const doc: Doc = {
      id,
      title: deriveTitle(content),
      content,
      createdAt: now,
      updatedAt: now,
      parentId,
      order: nextOrder(docsRef.current, parentId),
    }
    await putDoc(doc)
    // Insert into state at the front (matches listDocs' updatedAt-desc sort)
    // instead of re-reading the entire table.
    setDocs((prev) => [doc, ...prev])
    setActiveId(id)
    return id
  }, [setActiveId])

  const saveDoc = useCallback(async (id: string, content: string) => {
    // Read fresh from storage so a deleted doc isn't accidentally resurrected.
    // A single getDoc is far cheaper than the refresh() it replaces (which used
    // to getAll + sort + trigger a full tree rebuild on every keystroke-save).
    const existing = await getDoc(id)
    if (!existing) return
    // Respect a user-set title: only re-derive from the H1 when the user has
    // not manually renamed this doc.
    const nextTitle = existing.titleOverridden ? existing.title : deriveTitle(content)
    const next: Doc = { ...existing, content, title: nextTitle, updatedAt: Date.now() }
    await putDoc(next)
    // Local update: pull the saved doc to the front (matches listDocs'
    // updatedAt-desc ordering) without a full re-read.
    setDocs((prev) => {
      const idx = prev.findIndex((d) => d.id === id)
      if (idx < 0) return prev
      if (idx === 0 && prev[0] === next) return prev
      const without = prev.slice(0, idx).concat(prev.slice(idx + 1))
      return [next, ...without]
    })
  }, [])

  const removeDoc = useCallback(async (id: string): Promise<{ docs: Doc[]; placeholderId: string | null }> => {
    const all = docsRef.current
    if (!all.some((d) => d.id === id)) return { docs: [], placeholderId: null }
    const ids = new Set(collectSubtreeIds(all, id))
    const snapshot = all.filter((d) => ids.has(d.id))
    await deleteDocs(ids)
    setDocs((prev) => prev.filter((d) => !ids.has(d.id)))
    let placeholderId: string | null = null
    // The active doc may itself be a descendant of the deleted root.
    if (activeId !== null && ids.has(activeId)) {
      const remaining = all.filter((d) => !ids.has(d.id))
      const next = remaining[0]?.id ?? null
      if (next) setActiveId(next)
      else placeholderId = await createDoc()
    }
    return { docs: snapshot, placeholderId }
  }, [activeId, createDoc, setActiveId])

  const restoreDoc = useCallback(async (snapshot: Doc[]) => {
    for (const d of snapshot) await putDoc(d)
    // Merge snapshot back into state without a full re-read. Dedupes against
    // any stragglers that somehow still exist in state.
    setDocs((prev) => {
      const ids = new Set(snapshot.map((d) => d.id))
      const kept = prev.filter((d) => !ids.has(d.id))
      return [...snapshot, ...kept]
    })
    // Re-activate the subtree root.
    const root = findSubtreeRoot(snapshot)
    if (root) setActiveId(root.id)
  }, [setActiveId])

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
    setDocs((prev) => prev.map((d) => (d.id === id ? next : d)))
  }, [])

  const importDoc = useCallback((content: string) => createDoc(content), [createDoc])

  // Reparent/reorder a page. NOTE: cycle-prevention (not dropping a node into
  // its own subtree) is the caller's responsibility — Sidebar routes every move
  // through `computeMoveTarget`, which rejects invalid drops. Direct callers
  // must guard themselves.
  const moveDoc = useCallback(async (id: string, parentId: string | null, order: number) => {
    await storageMoveDoc(id, parentId, order)
    await refresh()
  }, [refresh])

  const activeDoc = docs.find((d) => d.id === activeId) ?? null

  const tree = useMemo(() => buildTree(docs), [docs])

  return {
    docs,
    tree,
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
    moveDoc,
  }
}
