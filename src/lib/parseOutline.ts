// Parse ATX-style markdown headings from raw markdown text.
// Only levels 1-3 are returned. Fenced code blocks are skipped so `# foo`
// inside them is not mistaken for a heading. Setext headings (`===`/`---`)
// are not supported here — the editor produces ATX exclusively.

export interface OutlineItem {
  level: 1 | 2 | 3
  text: string
  // 0-based occurrence index in the document, across all levels. Used to
  // locate the matching heading node in the ProseMirror doc when jumping.
  index: number
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/

export function parseOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = markdown.split('\n')
  let inFence = false
  let fenceMarker: string | null = null
  let index = 0

  for (const line of lines) {
    const trimmed = line.trimStart()
    // Track ``` / ~~~ code fences so headings inside them are ignored.
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceMarker = fenceMatch[1][0]
      } else if (fenceMarker && trimmed.startsWith(fenceMarker.repeat(3))) {
        inFence = false
        fenceMarker = null
      }
      continue
    }
    if (inFence) continue

    const m = HEADING_RE.exec(line)
    if (!m) continue
    const level = m[1].length as 1 | 2 | 3
    const text = m[2].trim()
    if (!text) continue
    items.push({ level, text, index: index++ })
  }

  return items
}
