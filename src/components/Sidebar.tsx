import { useMemo, useState } from 'react'
import type { Doc } from '../lib/storage'

interface Props {
  docs: Doc[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ docs, activeId, onSelect, onCreate, onDelete }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => d.title.toLowerCase().includes(q))
  }, [docs, query])

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
        {filtered.map((d) => (
          <li
            key={d.id}
            className={`doc-item ${d.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <span className="doc-title">{d.title}</span>
            <button
              className="doc-delete"
              aria-label={`Delete ${d.title}`}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete "${d.title}"?`)) onDelete(d.id)
              }}
            >
              ×
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="doc-empty">No documents.</li>}
      </ul>
    </aside>
  )
}
