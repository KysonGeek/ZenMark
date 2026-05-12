import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from '../lib/storage'

interface Props {
  docs: Doc[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

export function Sidebar({ docs, activeId, onSelect, onCreate, onDelete, onRename }: Props) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => d.title.toLowerCase().includes(q))
  }, [docs, query])

  // Auto-focus and select-all when an item enters edit mode so the user can
  // immediately overtype.
  useEffect(() => {
    if (editingId !== null) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingId])

  function startEdit(doc: Doc) {
    setEditingId(doc.id)
    setDraft(doc.title)
  }

  function commit() {
    if (editingId === null) return
    onRename(editingId, draft)
    setEditingId(null)
  }

  function cancel() {
    setEditingId(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button onClick={onCreate} title="New document (⌘N)">+ New</button>
      </div>
      <div className="sidebar-search">
        <input
          type="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documents"
        />
      </div>
      <ul className="doc-list">
        {filtered.map((d) => {
          const isEditing = d.id === editingId
          return (
            <li
              key={d.id}
              className={`doc-item ${d.id === activeId ? 'active' : ''}`}
              onClick={() => !isEditing && onSelect(d.id)}
              onDoubleClick={() => startEdit(d)}
              title={isEditing ? undefined : 'Double-click to rename'}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="doc-title-input"
                  value={draft}
                  spellCheck={false}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancel()
                    }
                  }}
                />
              ) : (
                <span className="doc-title">{d.title}</span>
              )}
              <button
                className="doc-delete"
                aria-label={`Delete ${d.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(d.id)
                }}
              >
                ×
              </button>
            </li>
          )
        })}
        {filtered.length === 0 && <li className="doc-empty">No documents.</li>}
      </ul>
    </aside>
  )
}
