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

// Given a subtree snapshot (a doc plus its descendants), return its root — the
// member whose parent is null or lies outside the snapshot. undefined if empty.
export function findSubtreeRoot(docs: Doc[]): Doc | undefined {
  const ids = new Set(docs.map((d) => d.id))
  return docs.find((d) => d.parentId === null || !ids.has(d.parentId)) ?? docs[0]
}

export type DropPosition = 'before' | 'after' | 'into'

// Translate a drop gesture into a (parentId, order) for storage.moveDoc.
// `order` may be fractional (e.g. target.order ± 0.5); storage renumbers the
// sibling group to dense integers afterwards. Returns null for invalid drops
// (onto self, into own subtree, or unknown target).
export function computeMoveTarget(
  docs: Doc[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
): { parentId: string | null; order: number } | null {
  if (draggedId === targetId) return null
  const target = docs.find((d) => d.id === targetId)
  if (!target) return null

  const newParentId = position === 'into' ? target.id : target.parentId

  // Cycle guard: cannot reparent a node beneath itself.
  if (newParentId !== null && collectSubtreeIds(docs, draggedId).includes(newParentId)) {
    return null
  }

  let order: number
  if (position === 'into') order = nextOrder(docs, target.id)
  else if (position === 'before') order = target.order - 0.5
  else order = target.order + 0.5

  return { parentId: newParentId, order }
}
