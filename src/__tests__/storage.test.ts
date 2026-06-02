import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { DB_NAME, __resetDbForTests, deleteDoc, getDoc, listDocs, moveDoc, putDoc } from '../lib/storage'

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
      parentId: null,
      order: 0,
    }
    await putDoc(doc)
    expect(await getDoc('a1')).toEqual(doc)
  })

  it('listDocs returns docs ordered by updatedAt desc', async () => {
    await putDoc({ id: 'a', title: 'A', content: 'a', createdAt: 1, updatedAt: 100, parentId: null, order: 0 })
    await putDoc({ id: 'b', title: 'B', content: 'b', createdAt: 2, updatedAt: 300, parentId: null, order: 1 })
    await putDoc({ id: 'c', title: 'C', content: 'c', createdAt: 3, updatedAt: 200, parentId: null, order: 2 })
    const ids = (await listDocs()).map((d) => d.id)
    expect(ids).toEqual(['b', 'c', 'a'])
  })

  it('putDoc overwrites an existing doc by id', async () => {
    await putDoc({ id: 'x', title: 'old', content: 'old', createdAt: 1, updatedAt: 1, parentId: null, order: 0 })
    await putDoc({ id: 'x', title: 'new', content: 'new', createdAt: 1, updatedAt: 2, parentId: null, order: 0 })
    const got = await getDoc('x')
    expect(got?.title).toBe('new')
    expect(got?.content).toBe('new')
  })

  it('deleteDoc removes a doc', async () => {
    await putDoc({ id: 'k', title: 'k', content: 'k', createdAt: 1, updatedAt: 1, parentId: null, order: 0 })
    await deleteDoc('k')
    expect(await getDoc('k')).toBeUndefined()
  })

  it('getDoc returns undefined for missing id', async () => {
    expect(await getDoc('nope')).toBeUndefined()
  })
})

describe('moveDoc', () => {
  const base = { content: '', createdAt: 1, updatedAt: 1 }

  it('reorders within a sibling group and renumbers densely', async () => {
    await putDoc({ id: 'a', title: 'A', parentId: null, order: 0, ...base })
    await putDoc({ id: 'b', title: 'B', parentId: null, order: 1, ...base })
    await putDoc({ id: 'c', title: 'C', parentId: null, order: 2, ...base })
    // Drop c before b: parent unchanged, fractional order 0.5.
    await moveDoc('c', null, 0.5)
    const order = Object.fromEntries((await listDocs()).map((d) => [d.id, d.order]))
    expect(order).toEqual({ a: 0, c: 1, b: 2 })
  })

  it('reparents a doc and gives it the requested order', async () => {
    await putDoc({ id: 'p', title: 'P', parentId: null, order: 0, ...base })
    await putDoc({ id: 'q', title: 'Q', parentId: null, order: 1, ...base })
    await moveDoc('q', 'p', 0)
    const q = await getDoc('q')
    expect(q?.parentId).toBe('p')
    expect(q?.order).toBe(0)
  })

  it('renumbers the source group densely after a reparent', async () => {
    await putDoc({ id: 'r0', title: 'R0', parentId: null, order: 0, ...base })
    await putDoc({ id: 'r1', title: 'R1', parentId: null, order: 1, ...base })
    await putDoc({ id: 'r2', title: 'R2', parentId: null, order: 2, ...base })
    await putDoc({ id: 'p', title: 'P', parentId: null, order: 3, ...base })
    // Move r1 (middle of root group) under p.
    await moveDoc('r1', 'p', 0)
    const roots = (await listDocs()).filter((d) => d.parentId === null).sort((a, b) => a.order - b.order)
    expect(roots.map((d) => [d.id, d.order])).toEqual([['r0', 0], ['r2', 1], ['p', 2]])
  })

  it('is a no-op for a missing id', async () => {
    await moveDoc('ghost', null, 0)
    expect(await listDocs()).toEqual([])
  })
})

describe('migration v1 -> v2', () => {
  it('backfills parentId=null and dense order by updatedAt desc', async () => {
    // Seed a legacy v1 database with no parentId/order.
    const legacy = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const s = db.createObjectStore('documents', { keyPath: 'id' })
        s.createIndex('by-updatedAt', 'updatedAt')
      },
    })
    await legacy.put('documents', { id: 'a', title: 'A', content: 'a', createdAt: 1, updatedAt: 100 })
    await legacy.put('documents', { id: 'b', title: 'B', content: 'b', createdAt: 2, updatedAt: 300 })
    legacy.close()
    await __resetDbForTests()

    // Opening via our module triggers the v2 upgrade.
    const docs = await listDocs()
    const a = docs.find((d) => d.id === 'a')!
    const b = docs.find((d) => d.id === 'b')!
    expect(a.parentId).toBe(null)
    expect(b.parentId).toBe(null)
    // updatedAt desc => b (300) first => order 0, a (100) => order 1
    expect(b.order).toBe(0)
    expect(a.order).toBe(1)
  })
})
