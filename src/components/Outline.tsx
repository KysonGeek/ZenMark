import type { OutlineItem } from '../lib/parseOutline'

interface Props {
  items: OutlineItem[]
  onJump: (item: OutlineItem) => void
}

export function Outline({ items, onJump }: Props) {
  return (
    <aside className="outline">
      <div className="outline-title">Outline</div>
      {items.length === 0 ? (
        <div className="outline-empty">No headings.</div>
      ) : (
        <ul className="outline-list">
          {items.map((it) => (
            <li
              key={it.index}
              className={`outline-item outline-l${it.level}`}
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
