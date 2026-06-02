import { useEffect, useMemo, useState } from 'react'
import type { Doc } from '../lib/storage'
import { computeMoveTarget, type DropPosition, type TreeNode as TreeNodeData } from '../lib/tree'
import { TreeNode } from './TreeNode'

const COLLAPSED_KEY = 'markra.collapsed'

interface Props {
  docs: Doc[]
  tree: TreeNodeData[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onCreateChild: (parentId: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onMove: (id: string, parentId: string | null, order: number) => void
}

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function Sidebar(props: Props) {
  const { docs, tree, activeId, onSelect, onCreate, onCreateChild, onDelete, onRename, onMove } = props
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return docs.filter((d) => d.title.toLowerCase().includes(q))
  }, [docs, query])

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startEdit(id: string) {
    setEditingId(id)
  }

  function commitRename(id: string, title: string) {
    onRename(id, title)
    setEditingId(null)
  }

  function handleDrop() {
    if (draggedId && dropTarget) {
      const move = computeMoveTarget(docs, draggedId, dropTarget.id, dropTarget.position)
      if (move) {
        // Auto-expand the new parent so the moved node stays visible.
        if (dropTarget.position === 'into') {
          setCollapsed((prev) => {
            const next = new Set(prev)
            next.delete(dropTarget.id)
            return next
          })
        }
        onMove(draggedId, move.parentId, move.order)
      }
    }
    setDraggedId(null)
    setDropTarget(null)
  }

  function handleCreateChild(parentId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(parentId)
      return next
    })
    onCreateChild(parentId)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button onClick={onCreate} title="New page (⌘N)">+ New</button>
      </div>
      <div className="sidebar-search">
        <input
          type="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search pages"
        />
      </div>

      {filtered !== null ? (
        <ul className="doc-list">
          {filtered.map((d) => (
            <li
              key={d.id}
              className={`doc-item${d.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(d.id)}
            >
              <span className="doc-title">{d.title}</span>
              <button
                className="doc-delete"
                aria-label={`Delete ${d.title}`}
                onClick={(e) => { e.stopPropagation(); onDelete(d.id) }}
              >
                ×
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="doc-empty">No pages.</li>}
        </ul>
      ) : (
        <ul className="doc-list tree-root">
          {tree.map((node) => (
            <TreeNode
              key={node.doc.id}
              node={node}
              depth={0}
              activeId={activeId}
              collapsed={collapsed}
              editingId={editingId}
              dropTarget={dropTarget}
              onToggleCollapse={toggleCollapse}
              onSelect={onSelect}
              onCreateChild={handleCreateChild}
              onDelete={onDelete}
              onStartEdit={startEdit}
              onRename={commitRename}
              onCancelEdit={() => setEditingId(null)}
              onDragStartNode={setDraggedId}
              onDragOverNode={(id, position) => setDropTarget({ id, position })}
              onDropNode={handleDrop}
              onDragEndNode={() => { setDraggedId(null); setDropTarget(null) }}
            />
          ))}
          {tree.length === 0 && <li className="doc-empty">No pages.</li>}
        </ul>
      )}
    </aside>
  )
}
