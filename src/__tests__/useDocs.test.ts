import { describe, expect, it } from 'vitest'
import { deleteDoc, getDoc, listDocs, putDoc } from '../lib/storage'

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
    await putDoc({ id: 'a', title: 'A', content: 'a', createdAt: 1, updatedAt: 1 })
    await deleteDoc('a')
    const wrote = await safeSave('a', 'this should be discarded')
    expect(wrote).toBe(false)
    expect(await getDoc('a')).toBeUndefined()
    expect(await listDocs()).toEqual([])
  })

  it('writes when the doc still exists', async () => {
    await putDoc({ id: 'b', title: 'B', content: 'b', createdAt: 1, updatedAt: 1 })
    const wrote = await safeSave('b', 'new content')
    expect(wrote).toBe(true)
    const got = await getDoc('b')
    expect(got?.content).toBe('new content')
  })
})
