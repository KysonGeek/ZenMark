import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from '../lib/storage'

interface Props {
  docs: Doc[]
  onSelect: (id: string) => void
  onClose: () => void
}

interface Scored {
  doc: Doc
  score: number
  positions: number[]   // matched character indices in title (for bolding)
}

// Subsequence fuzzy match: every query char must appear in order. Score
// rewards consecutive runs and matches at word boundaries so "fn" prefers
// "Field Notes" over "Refinements".
function fuzzyScore(query: string, title: string): Scored['positions'] | null {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  if (q.length === 0) return []
  const positions: number[] = []
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      positions.push(i)
      qi++
    }
  }
  return qi === q.length ? positions : null
}

function scoreOf(title: string, positions: number[]): number {
  if (positions.length === 0) return 0
  let score = 0
  let consecutive = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const isStart = p === 0 || /\s|[-_/.]/.test(title[p - 1] ?? '')
    if (isStart) score += 4
    if (i > 0 && positions[i] === positions[i - 1] + 1) {
      consecutive++
      score += consecutive * 2
    } else {
      consecutive = 0
    }
    score += 1
  }
  // Shorter titles win on ties.
  score -= title.length * 0.01
  return score
}

export function QuickOpen({ docs, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const matches = useMemo<Scored[]>(() => {
    const q = query.trim()
    if (!q) {
      // No query: show most-recently-updated docs first (already the docs order).
      return docs.slice(0, 50).map((doc) => ({ doc, score: 0, positions: [] }))
    }
    const out: Scored[] = []
    for (const doc of docs) {
      const positions = fuzzyScore(q, doc.title)
      if (!positions) continue
      out.push({ doc, positions, score: scoreOf(doc.title, positions) })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, 50)
  }, [docs, query])

  // Reset highlight to top when the result set changes.
  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.querySelector<HTMLElement>(`[data-i="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = matches[selected]
      if (hit) {
        onSelect(hit.doc.id)
        onClose()
      }
    }
  }

  return (
    <div className="qo-backdrop" onMouseDown={onClose}>
      <div className="qo" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          type="text"
          placeholder="Search documents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {matches.length === 0 ? (
          <div className="qo-empty">No matches.</div>
        ) : (
          <ul className="qo-list" ref={listRef}>
            {matches.map((m, i) => (
              <li
                key={m.doc.id}
                data-i={i}
                className={`qo-item ${i === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  onSelect(m.doc.id)
                  onClose()
                }}
              >
                {renderTitle(m.doc.title, m.positions)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function renderTitle(title: string, positions: number[]) {
  if (positions.length === 0) return title
  const set = new Set(positions)
  const out: React.ReactNode[] = []
  let buf = ''
  for (let i = 0; i < title.length; i++) {
    if (set.has(i)) {
      if (buf) { out.push(buf); buf = '' }
      out.push(<mark key={i} className="qo-hl">{title[i]}</mark>)
    } else {
      buf += title[i]
    }
  }
  if (buf) out.push(buf)
  return out
}
