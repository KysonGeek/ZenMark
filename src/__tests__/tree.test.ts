import { describe, expect, it } from 'vitest'
import type { Doc } from '../lib/storage'
import { buildTree, collectSubtreeIds, nextOrder } from '../lib/tree'

function doc(id: string, parentId: string | null, order: number): Doc {
  return { id, title: id, content: '', createdAt: 0, updatedAt: 0, parentId, order }
}

describe('buildTree', () => {
  it('nests children under parents, sorted by order', () => {
    const docs = [
      doc('b', null, 1),
      doc('a', null, 0),
      doc('a2', 'a', 1),
      doc('a1', 'a', 0),
    ]
    const tree = buildTree(docs)
    expect(tree.map((n) => n.doc.id)).toEqual(['a', 'b'])
    expect(tree[0].children.map((n) => n.doc.id)).toEqual(['a1', 'a2'])
    expect(tree[1].children).toEqual([])
  })

  it('treats a doc with a dangling parentId as a root', () => {
    const docs = [doc('orphan', 'ghost', 0)]
    const tree = buildTree(docs)
    expect(tree.map((n) => n.doc.id)).toEqual(['orphan'])
  })
})

describe('collectSubtreeIds', () => {
  it('returns the root plus all descendants', () => {
    const docs = [
      doc('root', null, 0),
      doc('child', 'root', 0),
      doc('grand', 'child', 0),
      doc('other', null, 1),
    ]
    expect(collectSubtreeIds(docs, 'root').sort()).toEqual(['child', 'grand', 'root'])
  })
})

describe('nextOrder', () => {
  it('returns 0 for an empty sibling group', () => {
    expect(nextOrder([], null)).toBe(0)
  })

  it('returns max sibling order + 1', () => {
    const docs = [doc('a', 'p', 0), doc('b', 'p', 3), doc('c', null, 9)]
    expect(nextOrder(docs, 'p')).toBe(4)
  })
})
