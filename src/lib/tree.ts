import type { Doc } from './storage'

export interface TreeNode {
  doc: Doc
  children: TreeNode[]
}

// Build a nested tree from a flat doc list. Siblings are sorted by `order`.
// Docs whose parentId points to a missing doc are surfaced as roots
// (defensive — should not happen in normal operation).
export function buildTree(docs: Doc[]): TreeNode[] {
  const byParent = new Map<string | null, Doc[]>()
  for (const d of docs) {
    const arr = byParent.get(d.parentId) ?? []
    arr.push(d)
    byParent.set(d.parentId, arr)
  }
  const ids = new Set(docs.map((d) => d.id))

  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((d) => ({ doc: d, children: build(d.id) }))

  const roots = build(null)
  const orphans = docs
    .filter((d) => d.parentId !== null && !ids.has(d.parentId))
    .sort((a, b) => a.order - b.order)
  for (const d of orphans) {
    roots.push({ doc: d, children: build(d.id) })
  }
  return roots
}

// All ids in the subtree rooted at `rootId`, including `rootId` itself.
export function collectSubtreeIds(docs: Doc[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const d of docs) {
    if (d.parentId !== null) {
      const arr = childrenOf.get(d.parentId) ?? []
      arr.push(d.id)
      childrenOf.set(d.parentId, arr)
    }
  }
  const result: string[] = []
  const visited = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    result.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return result
}

// The order value to append a new node to the end of a sibling group.
export function nextOrder(docs: Doc[], parentId: string | null): number {
  const siblings = docs.filter((d) => d.parentId === parentId)
  if (siblings.length === 0) return 0
  return Math.max(...siblings.map((d) => d.order)) + 1
}
