import { describe, expect, it } from 'vitest'
import { deleteDoc, getDoc, listDocs, putDoc } from '../lib/storage'

describe('storage', () => {
  it('returns empty array when no docs exist', async () => {
    expect(await listDocs()).toEqual([])
  })

  it('putDoc creates and getDoc retrieves a doc', async () => {
    const doc = {
      id: 'a1',
      title: 'Test',
      content: '# Test',
      createdAt: 1000,
      updatedAt: 1000,
    }
    await putDoc(doc)
    expect(await getDoc('a1')).toEqual(doc)
  })

  it('listDocs returns docs ordered by updatedAt desc', async () => {
    await putDoc({ id: 'a', title: 'A', content: 'a', createdAt: 1, updatedAt: 100 })
    await putDoc({ id: 'b', title: 'B', content: 'b', createdAt: 2, updatedAt: 300 })
    await putDoc({ id: 'c', title: 'C', content: 'c', createdAt: 3, updatedAt: 200 })
    const ids = (await listDocs()).map((d) => d.id)
    expect(ids).toEqual(['b', 'c', 'a'])
  })

  it('putDoc overwrites an existing doc by id', async () => {
    await putDoc({ id: 'x', title: 'old', content: 'old', createdAt: 1, updatedAt: 1 })
    await putDoc({ id: 'x', title: 'new', content: 'new', createdAt: 1, updatedAt: 2 })
    const got = await getDoc('x')
    expect(got?.title).toBe('new')
    expect(got?.content).toBe('new')
  })

  it('deleteDoc removes a doc', async () => {
    await putDoc({ id: 'k', title: 'k', content: 'k', createdAt: 1, updatedAt: 1 })
    await deleteDoc('k')
    expect(await getDoc('k')).toBeUndefined()
  })

  it('getDoc returns undefined for missing id', async () => {
    expect(await getDoc('nope')).toBeUndefined()
  })
})
