import { useEffect, useRef, useState } from 'react'
import type { OutlineItem } from '../lib/parseOutline'

interface Props {
  items: OutlineItem[]
  activeIndex?: number
  onJump: (item: OutlineItem) => void
}

const COLLAPSED_KEY = 'markra.outlineCollapsed'

export function Outline({ items, activeIndex = -1, onJump }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  })
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  // Auto-scroll the active item into view inside the outline panel so it
  // stays visible during long-document scrolling.
  useEffect(() => {
    if (collapsed || activeIndex < 0) return
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, collapsed])

  if (collapsed) {
    return (
      <button
        type="button"
        className="outline-toggle outline-toggle-collapsed"
        onClick={() => setCollapsed(false)}
        title="Show outline"
        aria-label="Show outline"
      >
        ☰
      </button>
    )
  }

  return (
    <aside className="outline">
      <div className="outline-header">
        <div className="outline-title">Outline</div>
        <button
          type="button"
          className="outline-toggle"
          onClick={() => setCollapsed(true)}
          title="Hide outline"
          aria-label="Hide outline"
        >
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <div className="outline-empty">No headings.</div>
      ) : (
        <ul className="outline-list" ref={listRef}>
          {items.map((it) => (
            <li
              key={it.index}
              data-idx={it.index}
              className={`outline-item outline-l${it.level}${it.index === activeIndex ? ' outline-item-active' : ''}`}
              onClick={() => onJump(it)}
              title={it.text}
            >
              {it.text}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
