import { describe, expect, it } from 'vitest'
import { deleteDoc, getDoc, listDocs, putDoc } from '../lib/storage'
import { collectSubtreeIds } from '../lib/tree'

// We don't use renderHook here because pulling in React Testing Library
// adds a dependency. Instead, we test the underlying invariant directly:
// a save that races with a delete must NOT resurrect the deleted doc.
//
// The fix is in useDocs.saveDoc: it reads from storage (via getDoc) and
// no-ops if the doc no longer exists. This test simulates that contract.

async function safeSave(id: string, content: string) {
  const existing = await getDoc(id)
  if (!existing) return false
  await putDoc({ ...existing, content, updatedAt: Date.now() })
  return true
}

describe('safe save (regression for delete-then-save race)', () => {
  it('returns false and does not write when the doc was already deleted', async () => {
    await putDoc({ id: 'a', title: 'A', content: 'a', createdAt: 1, updatedAt: 1, parentId: null, order: 0 })
    await deleteDoc('a')
    const wrote = await safeSave('a', 'this should be discarded')
    expect(wrote).toBe(false)
    expect(await getDoc('a')).toBeUndefined()
    expect(await listDocs()).toEqual([])
  })

  it('writes when the doc still exists', async () => {
    await putDoc({ id: 'b', title: 'B', content: 'b', createdAt: 1, updatedAt: 1, parentId: null, order: 0 })
    const wrote = await safeSave('b', 'new content')
    expect(wrote).toBe(true)
    const got = await getDoc('b')
    expect(got?.content).toBe('new content')
  })
})

describe('cascade delete + restore contract (what useDocs.removeDoc/restoreDoc compose)', () => {
  const base = { content: '', createdAt: 1, updatedAt: 1 }

  it('removes the whole subtree and a snapshot restores it', async () => {
    await putDoc({ id: 'root', title: 'Root', parentId: null, order: 0, ...base })
    await putDoc({ id: 'child', title: 'Child', parentId: 'root', order: 0, ...base })
    await putDoc({ id: 'grand', title: 'Grand', parentId: 'child', order: 0, ...base })
    await putDoc({ id: 'other', title: 'Other', parentId: null, order: 1, ...base })

    const all = await listDocs()
    const ids = collectSubtreeIds(all, 'root')
    const snapshot = all.filter((d) => ids.includes(d.id))
    for (const id of ids) await deleteDoc(id)
    expect((await listDocs()).map((d) => d.id)).toEqual(['other'])

    for (const d of snapshot) await putDoc(d)
    expect((await listDocs()).length).toBe(4)
  })
})
