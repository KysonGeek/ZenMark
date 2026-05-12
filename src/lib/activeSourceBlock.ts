// Typora-style "active block source mode": when the cursor enters a textblock
// (paragraph / heading), we replace it with a single plaintext paragraph
// whose content is the markdown source of the original block (e.g. "# foo",
// "**bold** text"). When the cursor leaves, we parse that markdown back into
// a real block node and put it back. This lets users directly edit marker
// characters (#, **, [](url), ![]()) instead of seeing decorative widgets
// they cannot select or modify.
//
// Round-trip pieces (Milkdown 7.x):
//   - serializerCtx provides Serializer = (node) => string
//   - parserCtx provides Parser = (markdown) => doc-node
//   - schemaCtx gives us the schema for constructing the plain paragraph

import {
  parserCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/core'
import type { Node as PMNode, Schema } from '@milkdown/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'

interface ActiveSourceState {
  // Document position pointing at the active block's parent (the same value
  // you'd get from $from.before($from.depth)). null = no block is in source
  // mode right now.
  activePos: number | null
}

const KEY = new PluginKey<ActiveSourceState>('zenmark-active-source')

// We only swap blocks whose direct type is one of these. code_block is
// already its own source view (Crepe CodeMirror NodeView). Tables, image
// blocks, list wrappers, etc. stay rich.
const SUPPORTED_BLOCKS = new Set(['paragraph', 'heading'])

function findActiveBlockPos(state: EditorState): number | null {
  const { $from } = state.selection
  if ($from.depth === 0) return null
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth)
    if (SUPPORTED_BLOCKS.has(node.type.name)) {
      return $from.before(depth)
    }
  }
  return null
}

/// True iff a block is currently rendered as raw markdown source. Editor.tsx
/// reads this to suppress outline updates while the user is mid-typing —
/// otherwise headings flicker out of the outline whenever the cursor enters
/// them (because in source mode the heading is temporarily a paragraph).
export function isInSourceMode(state: EditorState): boolean {
  const ps = KEY.getState(state)
  return ps?.activePos != null
}

/// Force the currently-active source block (if any) back into rendered mode
/// without moving the user's selection elsewhere first. Used on blur and
/// before unmount so we never persist half-typed markdown like `\# foo`.
/// Call this inside crepe.editor.action((ctx) => exitSourceMode(ctx, view)).
export function exitSourceMode(view: EditorView): void {
  const ps = KEY.getState(view.state)
  if (!ps || ps.activePos == null) return
  // Dispatching with KEY meta = { activePos: null } tells our state field
  // to clear; appendTransaction will see prev != next and run the swap-back
  // step (its first branch) to re-render the block.
  const tr = view.state.tr.setMeta(KEY, { activePos: null })
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

export const activeSourceBlock = $prose((ctx) => {
  // Captured by the Plugin's view() hook so plugin state.apply() can ask
  // "is the editor actually focused?" before committing a block to source
  // mode. Without this, a freshly mounted editor's default selection
  // (TextSelection.atStart) makes the first paragraph "active" before the
  // user has even clicked anywhere — so switching documents would render
  // the new file's first line in raw source view.
  let viewRef: EditorView | null = null

  return new Plugin<ActiveSourceState>({
    key: KEY,

    view(view) {
      viewRef = view
      // When the editor loses DOM focus we want any active source block to
      // render back to its rich form. Selection alone won't change on blur,
      // so PM won't run apply() on its own — we dispatch a no-op transaction
      // to force one. The apply() body sees `hasFocus() === false` and
      // clears activePos, which appendTransaction then renders back.
      const onBlur = () => {
        if (!viewRef) return
        if (KEY.getState(viewRef.state)?.activePos == null) return
        viewRef.dispatch(viewRef.state.tr.setMeta('addToHistory', false))
      }
      const onFocus = () => {
        if (!viewRef) return
        // Same trick on focus: nudge plugin.apply() so the block under the
        // caret enters source mode now that we have focus.
        viewRef.dispatch(viewRef.state.tr.setMeta('addToHistory', false))
      }
      view.dom.addEventListener('blur', onBlur, true)
      view.dom.addEventListener('focus', onFocus, true)

      return {
        destroy() {
          view.dom.removeEventListener('blur', onBlur, true)
          view.dom.removeEventListener('focus', onFocus, true)
          if (viewRef === view) viewRef = null
        },
      }
    },

    state: {
      init: () => ({ activePos: null }),
      apply(tr, prev, _oldState, newState) {
        // Explicit override (used by exitSourceMode()).
        const meta = tr.getMeta(KEY) as ActiveSourceState | undefined
        if (meta) return meta
        // Editor not focused → no block should be in source mode. If we
        // were in source mode (e.g. user just clicked outside the editor),
        // clear it so appendTransaction can swap the block back to its
        // rendered form.
        const focused = viewRef?.hasFocus() ?? false
        if (!focused) {
          return prev.activePos == null ? prev : { activePos: null }
        }
        // Otherwise the active block is derived from the new selection's
        // current textblock. Using the *new* state's selection (post-tr)
        // keeps us honest about where the caret ended up after any mapping.
        const nextPos = findActiveBlockPos(newState)
        if (nextPos === prev.activePos) return prev
        return { activePos: nextPos }
      },
    },

    appendTransaction(_trs, oldState, newState) {
      const prevPos = KEY.getState(oldState)?.activePos ?? null
      const nextPos = KEY.getState(newState)?.activePos ?? null

      if (nextPos === prevPos) return null

      const schema = ctx.get(schemaCtx)
      const serializer = ctx.get(serializerCtx)
      const parser = ctx.get(parserCtx)

      let tr: Transaction = newState.tr
      // Swap transactions are housekeeping; don't pollute undo history.
      tr.setMeta('addToHistory', false)

      let workingPrev = prevPos
      let workingNext = nextPos

      // 1) Render the previously-active block (currently a plain paragraph
      //    holding markdown text) back into a rich block.
      if (workingPrev != null) {
        const node = tr.doc.nodeAt(workingPrev)
        // If the node is no longer a paragraph, a commonmark inputRule (e.g.
        // `# ` -> heading, `> ` -> blockquote) has already upgraded it while
        // the user was typing in source mode. Re-parsing its textContent now
        // would lose that upgrade — e.g. a heading whose textContent is
        // "hello" would parse back to a paragraph. Leave the upgraded node
        // alone in that case.
        if (node && node.type.name === 'paragraph') {
          const text = node.textContent
          const rendered = parseLineToBlock(parser, schema, text)
          if (rendered) {
            const before = workingPrev
            const after = workingPrev + node.nodeSize
            const oldSize = node.nodeSize
            tr = tr.replaceWith(before, after, rendered)
            if (workingNext != null && workingNext > before) {
              workingNext += rendered.nodeSize - oldSize
            }
          }
        }
      }

      // 2) Replace the new active block with a plain paragraph that holds
      //    its markdown source.
      if (workingNext != null) {
        const node = tr.doc.nodeAt(workingNext)
        if (node && SUPPORTED_BLOCKS.has(node.type.name)) {
          const md = serializeBlock(serializer, schema, node)
          const sourceParagraph = buildSourceParagraph(schema, md)
          if (sourceParagraph) {
            const before = workingNext
            const after = workingNext + node.nodeSize
            tr = tr.replaceWith(before, after, sourceParagraph)
            // Place caret at end of the source paragraph so typing continues
            // from where the user already was.
            const inside = before + 1 + (sourceParagraph.firstChild?.nodeSize ?? 0)
            const safe = Math.min(inside, tr.doc.content.size)
            tr = tr.setSelection(TextSelection.create(tr.doc, safe))
          }
        }
      }

      // Pin the resolved activePos onto the state so subsequent transactions
      // see the final post-replace position.
      tr = tr.setMeta(KEY, { activePos: workingNext })
      return tr
    },

    props: {
      decorations(state) {
        const ps = KEY.getState(state)
        if (ps?.activePos == null) return null
        const pos = ps.activePos
        const node = state.doc.nodeAt(pos)
        if (!node) return null
        return DecorationSet.create(state.doc, [
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'md-source-line',
          }),
        ])
      },
    },
  })
})

function serializeBlock(
  serializer: (node: PMNode) => string,
  schema: Schema,
  node: PMNode,
): string {
  // Fast path: a plain paragraph whose children are all unmarked text nodes
  // is already in "source-string" form (e.g. it came from splitting a source
  // paragraph at the cursor, leaving raw "# hello" behind). Running it
  // through the serializer would re-escape leading `#`/`*`/etc. into `\#`,
  // which is not what the user typed. Just hand back its textContent.
  if (node.type.name === 'paragraph') {
    let plain = true
    node.content.forEach((child) => {
      if (!plain) return
      if (!child.isText || child.marks.length > 0) plain = false
    })
    if (plain) return node.textContent
  }
  // Commonmark's toMarkdown runners (heading level #, marks **, autolink
  // resource-link heuristics, etc.) rely on the block being inside a doc
  // node when passed to remark-stringify. Handing a bare heading or
  // paragraph in directly loses the block marker (`#`) and most inline
  // marks (`**`, `*`). So wrap it in a single-block doc and trim.
  try {
    const doc = schema.topNodeType.create(null, node)
    return serializer(doc).replace(/\n+$/, '')
  } catch (err) {
    console.error('activeSourceBlock: serialize failed', err)
    return node.textContent
  }
}

function parseLineToBlock(
  parser: (text: string) => PMNode,
  schema: Schema,
  text: string,
): PMNode | null {
  try {
    if (text.trim().length === 0) {
      // Empty source paragraph -> empty paragraph.
      return schema.nodes.paragraph!.create()
    }
    const doc = parser(text)
    return doc.firstChild ?? schema.nodes.paragraph!.create()
  } catch (err) {
    console.error('activeSourceBlock: parse failed', err)
    return null
  }
}

function buildSourceParagraph(schema: Schema, md: string): PMNode | null {
  const paragraph = schema.nodes.paragraph
  if (!paragraph) return null
  const text = md.length > 0 ? schema.text(md) : null
  return paragraph.create(null, text ? [text] : [])
}
