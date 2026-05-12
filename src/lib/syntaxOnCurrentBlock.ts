import type { Mark, Node as PMNode } from '@milkdown/prose/model'
import { Plugin } from '@milkdown/prose/state'
import type { EditorState } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'

// Show raw markdown syntax markers (** * ` ~~ [](url) and # prefixes) on the
// block that currently contains the cursor. Lets the editor stay WYSIWYG
// while still revealing source on the line you're editing — Typora-style.

function makeMarker(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'md-marker'
  span.textContent = text
  span.setAttribute('aria-hidden', 'true')
  return span
}

function openMarker(mark: Mark): string | null {
  switch (mark.type.name) {
    case 'strong':
      return '**'
    case 'emphasis':
      return '*'
    case 'inlineCode':
      return '`'
    case 'strike_through':
      return '~~'
    case 'link':
      return '['
    default:
      return null
  }
}

function closeMarker(mark: Mark): string | null {
  switch (mark.type.name) {
    case 'strong':
      return '**'
    case 'emphasis':
      return '*'
    case 'inlineCode':
      return '`'
    case 'strike_through':
      return '~~'
    case 'link': {
      const href = (mark.attrs.href as string | undefined) ?? ''
      return `](${href})`
    }
    default:
      return null
  }
}

function blockPrefix(block: PMNode): string | null {
  if (block.type.name === 'heading') {
    const level = (block.attrs.level as number | undefined) ?? 1
    return '#'.repeat(Math.max(1, Math.min(6, level))) + ' '
  }
  return null
}

function decorationsForBlock(state: EditorState): DecorationSet {
  const { $from } = state.selection
  const parent = $from.parent
  if (!parent.isTextblock) return DecorationSet.empty

  // Position right before the parent textblock, then +1 to step inside it.
  const blockStart = $from.before($from.depth)
  const contentStart = blockStart + 1

  const decos: Decoration[] = []

  const prefix = blockPrefix(parent)
  if (prefix) {
    decos.push(
      Decoration.widget(contentStart, () => makeMarker(prefix), { side: -1 }),
    )
  }

  // Walk inline children. For each contiguous run of identical marks, emit
  // an opener at the start and a closer at the end.
  let active: Mark[] = []
  let cursor = contentStart

  const emit = (currentMarks: readonly Mark[], pos: number) => {
    // Close marks that are no longer present (in reverse for nesting).
    for (let i = active.length - 1; i >= 0; i--) {
      if (!currentMarks.some((m) => m.eq(active[i]))) {
        const closer = closeMarker(active[i])
        if (closer) {
          decos.push(
            Decoration.widget(pos, () => makeMarker(closer), { side: -1 }),
          )
        }
        active.splice(i, 1)
      }
    }
    // Open marks that are new.
    for (const m of currentMarks) {
      if (!active.some((am) => am.eq(m))) {
        const opener = openMarker(m)
        if (opener) {
          decos.push(
            Decoration.widget(pos, () => makeMarker(opener), { side: 1 }),
          )
        }
        active.push(m)
      }
    }
  }

  parent.forEach((child) => {
    if (child.isText) {
      emit(child.marks, cursor)
    } else {
      // Non-text inline (image, hard_break) — close any open marks first.
      emit([], cursor)
    }
    cursor += child.nodeSize
  })

  // Close any marks still open at end of block.
  emit([], cursor)

  return DecorationSet.create(state.doc, decos)
}

export const syntaxOnCurrentBlock = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          try {
            return decorationsForBlock(state)
          } catch (err) {
            console.error('syntaxOnCurrentBlock decorations error', err)
            return DecorationSet.empty
          }
        },
      },
    }),
)
