import { describe, expect, it } from 'vitest'
import type { Doc } from '../lib/storage'
import { buildTree, collectSubtreeIds, computeMoveTarget, nextOrder } from '../lib/tree'

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

  it('appends multiple orphans sorted by order', () => {
    const docs = [
      doc('normal', null, 0),
      doc('o1', 'ghost', 1),
      doc('o2', 'ghost', 0),
    ]
    const tree = buildTree(docs)
    // normal root first, then orphans sorted by order (o2 order=0, o1 order=1)
    expect(tree.map((n) => n.doc.id)).toEqual(['normal', 'o2', 'o1'])
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

  it('terminates and returns each id once when there is a parentId cycle', () => {
    // x is parent of y, y is parent of x — a two-node cycle
    const docs = [doc('x', 'y', 0), doc('y', 'x', 0)]
    const result = collectSubtreeIds(docs, 'x')
    expect(result.sort()).toEqual(['x', 'y'])
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

describe('computeMoveTarget', () => {
  const docs = [
    doc('a', null, 0),
    doc('b', null, 1),
    doc('c', null, 2),
    doc('a1', 'a', 0),
  ]

  it('before: keeps target parent, order just below target', () => {
    expect(computeMoveTarget(docs, 'c', 'b', 'before')).toEqual({ parentId: null, order: 0.5 })
  })

  it('after: keeps target parent, order just above target', () => {
    expect(computeMoveTarget(docs, 'a', 'b', 'after')).toEqual({ parentId: null, order: 1.5 })
  })

  it('into: target becomes parent, order appended after existing children', () => {
    expect(computeMoveTarget(docs, 'b', 'a', 'into')).toEqual({ parentId: 'a', order: 1 })
  })

  it('rejects dropping a node onto itself', () => {
    expect(computeMoveTarget(docs, 'a', 'a', 'into')).toBeNull()
  })

  it('rejects dropping a node into its own descendant (cycle)', () => {
    expect(computeMoveTarget(docs, 'a', 'a1', 'into')).toBeNull()
  })

  it('returns null for an unknown target', () => {
    expect(computeMoveTarget(docs, 'a', 'ghost', 'into')).toBeNull()
  })
})
