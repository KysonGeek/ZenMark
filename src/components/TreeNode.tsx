import { useState, type DragEvent } from 'react'
import type { TreeNode as TreeNodeData, DropPosition } from '../lib/tree'

export interface TreeNodeProps {
  node: TreeNodeData
  depth: number
  activeId: string | null
  collapsed: Set<string>
  editingId: string | null
  dropTarget: { id: string; position: DropPosition } | null
  onToggleCollapse: (id: string) => void
  onSelect: (id: string) => void
  onCreateChild: (parentId: string) => void
  onDelete: (id: string) => void
  onStartEdit: (id: string) => void
  onRename: (id: string, title: string) => void
  onCancelEdit: () => void
  onDragStartNode: (id: string) => void
  onDragOverNode: (id: string, position: DropPosition) => void
  onDropNode: () => void
  onDragEndNode: () => void
}

function positionFromEvent(e: DragEvent<HTMLDivElement>): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - rect.top
  if (y < rect.height / 3) return 'before'
  if (y > (rect.height * 2) / 3) return 'after'
  return 'into'
}

export function TreeNode(props: TreeNodeProps) {
  const {
    node, depth, activeId, collapsed, editingId, dropTarget,
    onToggleCollapse, onSelect, onCreateChild, onDelete,
    onStartEdit, onRename, onCancelEdit,
    onDragStartNode, onDragOverNode, onDropNode, onDragEndNode,
  } = props
  const { doc, children } = node
  const hasChildren = children.length > 0
  const isCollapsed = collapsed.has(doc.id)
  const isEditing = editingId === doc.id
  const isActive = activeId === doc.id
  const [draft, setDraft] = useState(doc.title)

  const dropClass =
    dropTarget?.id === doc.id ? ` drop-${dropTarget.position}` : ''

  return (
    <li className="tree-node">
      <div
        className={`doc-item${isActive ? ' active' : ''}${dropClass}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!isEditing}
        onClick={() => !isEditing && onSelect(doc.id)}
        onDoubleClick={() => { setDraft(doc.title); onStartEdit(doc.id) }}
        title={isEditing ? undefined : 'Double-click to rename'}
        onDragStart={(e) => { e.stopPropagation(); onDragStartNode(doc.id) }}
        onDragOver={(e) => {
          e.preventDefault()
          onDragOverNode(doc.id, positionFromEvent(e))
        }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropNode() }}
        onDragEnd={onDragEndNode}
      >
        <button
          className={`tree-toggle${hasChildren ? '' : ' invisible'}`}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(doc.id) }}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>

        {isEditing ? (
          <input
            className="doc-title-input"
            value={draft}
            spellCheck={false}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onRename(doc.id, draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRename(doc.id, draft) }
              else if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
            }}
          />
        ) : (
          <span className="doc-title">{doc.title}</span>
        )}

        <button
          className="doc-add"
          aria-label={`Add sub-page under ${doc.title}`}
          onClick={(e) => { e.stopPropagation(); onCreateChild(doc.id) }}
        >
          +
        </button>
        <button
          className="doc-delete"
          aria-label={`Delete ${doc.title}`}
          onClick={(e) => { e.stopPropagation(); onDelete(doc.id) }}
        >
          ×
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="doc-list">
          {children.map((child) => (
            <TreeNode key={child.doc.id} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
