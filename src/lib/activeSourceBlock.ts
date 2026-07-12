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
import { Fragment } from '@milkdown/prose/model'
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
  // Set by the Enter handler on the transaction meta to tell
  // appendTransaction the doc is already in its final shape (rendered prefix
  // + plain source remainder at activePos) — no swap needed.
  sourced?: boolean
}

const KEY = new PluginKey<ActiveSourceState>('zenmark-active-source')

// We only swap blocks whose direct type is one of these. code_block is
// already its own source view (Crepe CodeMirror NodeView). Tables, image
// blocks, list wrappers, etc. stay rich.
const SUPPORTED_BLOCKS = new Set(['paragraph', 'heading'])

function findActiveBlockPos(state: EditorState): number | null {
  const { $from } = state.selection
  // Only promote a textblock to source mode when the caret sits DIRECTLY under
  // the doc root (depth 1). A paragraph/heading nested deeper lives inside a
  // wrapper — blockquote, list item, table cell — whose marker (`>`, `-`, `1.`)
  // a flat source paragraph cannot represent; collapsing it to marker-less text
  // would hide the marker and (for table cells) break IME composition. Leave all
  // such nested content rich.
  if ($from.depth !== 1) return null
  const block = $from.node(1)
  return SUPPORTED_BLOCKS.has(block.type.name) ? $from.before(1) : null
}

/// True iff a block is currently rendered as raw markdown source. Editor.tsx
/// reads this to suppress outline updates while the user is mid-typing —
/// otherwise headings flicker out of the outline whenever the cursor enters
/// them (because in source mode the heading is temporarily a paragraph).
export function isInSourceMode(state: EditorState): boolean {
  const ps = KEY.getState(state)
  return ps?.activePos != null
}

/// Document position of the block currently rendered as raw markdown source,
/// or null if no such block is active. Exposed for callers (e.g.
/// readPersistableMarkdown) that need to know which block to re-render back
/// into rich form before serializing — without dispatching a tr (and so
/// without disturbing ProseMirror's auto selection-remap churn).
export function getActiveSourcePos(state: EditorState): number | null {
  return KEY.getState(state)?.activePos ?? null
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
      const onBlur = (event: FocusEvent) => {
        if (!viewRef) return
        if (KEY.getState(viewRef.state)?.activePos == null) return
        // Ignore blurs where focus moves to a widget that is still part of the
        // editor — the link tooltip's URL input, an image-block caption, etc.
        // (Crepe mounts these as siblings/descendants of .ProseMirror.) The user
        // is still editing this block; collapsing its raw source out from under
        // them mid-edit would be jarring. Only render back when focus truly
        // leaves the editor surface.
        const root = viewRef.dom.closest('.milkdown') ?? viewRef.dom.parentElement
        const next = event.relatedTarget as Node | null
        if (root && next && root.contains(next)) return
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
        // Read-only view: never swap into source mode. Otherwise a user who
        // drags to select text would see headings/paragraphs collapse into
        // raw markdown ("# foo", "**bold**"), and the clipboard would copy
        // those marker characters along with the visible text.
        if (viewRef && !viewRef.editable) {
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

    appendTransaction(trs, oldState, newState) {
      const prevPos = KEY.getState(oldState)?.activePos ?? null
      const nextPos = KEY.getState(newState)?.activePos ?? null

      // The Enter handler already left the doc in its final shape (rendered
      // prefix + plain source remainder) — swapping would only re-serialize
      // the remainder (escaping a leading marker into "\#…") and move the
      // caret away from the split point.
      if (trs.some((tr) => (tr.getMeta(KEY) as ActiveSourceState | undefined)?.sourced)) {
        return null
      }

      // Undo/redo restores doc regions exactly as they were when recorded,
      // and recorded edits happen in source mode — so when history moves the
      // caret into a block, that block already holds raw source text.
      // Re-serializing it (step 2 below) would double-escape it
      // ("# hello" → "\# hello"). Step 1 must still run: the previously
      // active block was NOT restored by the undo and still needs rendering
      // back to rich form.
      const fromHistory = trs.some((tr) => tr.getMeta('history$'))

      // An inputRule can upgrade the active block in place without moving it:
      // typing "# " on a line turns the source paragraph into a heading at the
      // same position, consuming the `#` markers and rendering the heading.
      // The caret is still inside it, so for consistency with clicking an
      // existing heading (which shows the `#`) we re-enter source mode to bring
      // the markers back. The position-change guard below would otherwise bail.
      const activeNode = nextPos == null ? null : newState.doc.nodeAt(nextPos)
      const upgradedInPlace =
        nextPos != null &&
        nextPos === prevPos &&
        activeNode != null &&
        activeNode.type.name !== 'paragraph' &&
        SUPPORTED_BLOCKS.has(activeNode.type.name)

      if (nextPos === prevPos && !upgradedInPlace) return null

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
          // The source line can hold a hardbreak (Shift+Enter), so its text may
          // span multiple markdown blocks (e.g. "# A\n# B"). Render ALL of them
          // back, not just the first, or the trailing blocks would be silently
          // dropped from the document.
          const rendered = parseLineToBlocks(parser, schema, text)
          if (rendered && rendered.childCount > 0) {
            const before = workingPrev
            const after = workingPrev + node.nodeSize
            const oldSize = node.nodeSize
            tr = tr.replaceWith(before, after, rendered)
            if (workingNext != null && workingNext > before) {
              workingNext += rendered.size - oldSize
            }
          }
        }
      }

      // 2) Replace the new active block with a plain paragraph that holds
      //    its markdown source.
      if (workingNext != null && !fromHistory) {
        const node = tr.doc.nodeAt(workingNext)
        if (node && SUPPORTED_BLOCKS.has(node.type.name)) {
          let md = serializeBlock(serializer, schema, node)
          // An empty heading serializes to just its marker run ("#") with no
          // trailing space, so the caret would land at "#" and the next
          // keystroke would make "#x" — which re-parses as a paragraph, not a
          // heading. Keep the space so an empty heading stays a heading as the
          // user types (this is the just-typed-"# " in-place upgrade case).
          if (node.type.name === 'heading' && /^#{1,6}$/.test(md)) md += ' '
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
      // A source line is plain text, so Enter must split it at the caret like
      // a text editor would. Left to Milkdown, Enter is fed to the input
      // rules as rule-confirming input: with the caret right after the "#"
      // in "# hello", the heading rule fires, swallows the marker, and keeps
      // the rest (" hello", leading space intact) as heading content — which
      // serializes to "# &#x20;hello". This plugin is registered before the
      // input-rules plugin, so returning true here preempts that.
      //
      // The whole split — render the prefix rich, keep the remainder as a new
      // source line — happens in this ONE recorded transaction, rather than a
      // plain splitBlock followed by appendTransaction swaps. The swaps are
      // unrecorded (addToHistory: false) whole-block replaces, and mapping a
      // recorded split's inverse through them lands in deleted ranges, so the
      // undo step gets dropped — Cmd+Z appeared to do nothing. One
      // self-contained transaction undoes/redoes cleanly.
      handleKeyDown(view, event) {
        if (event.key !== 'Enter') return false
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
        const ps = KEY.getState(view.state)
        if (ps?.activePos == null) return false
        const { selection } = view.state
        if (!selection.empty) return false
        const { $from } = selection
        if ($from.depth !== 1 || $from.before(1) !== ps.activePos) return false
        const block = $from.parent
        if (block.type.name !== 'paragraph') return false

        // Hardbreaks count 1 toward parentOffset but '' toward textContent,
        // so slice via textBetween with '\n' as their text.
        const offset = $from.parentOffset
        const before = block.textBetween(0, offset, undefined, '\n')
        const after = block.textBetween(offset, block.content.size, undefined, '\n')

        // At end of line, a marker-only line means the user is confirming an
        // input rule ("```" → code block, "$$" → math, "-" → list…). Defer to
        // Milkdown's enter-confirms-input-rules plugin for those.
        if (after.length === 0 && RULE_CONFIRM_RE.test(before)) return false

        const schema = ctx.get(schemaCtx)
        const parser = ctx.get(parserCtx)
        const rendered = parseLineToBlocks(parser, schema, before)
        if (!rendered || rendered.childCount === 0) return false
        const remainder = buildSourceParagraph(schema, after)
        if (!remainder) return false

        const pos = ps.activePos
        let tr = view.state.tr.replaceWith(
          pos,
          pos + block.nodeSize,
          rendered.append(Fragment.from(remainder)),
        )
        const remainderPos = pos + rendered.size
        tr = tr.setSelection(TextSelection.create(tr.doc, remainderPos + 1))
        tr = tr.setMeta(KEY, { activePos: remainderPos, sourced: true })
        view.dispatch(tr.scrollIntoView())
        return true
      },

      decorations(state) {
        const ps = KEY.getState(state)
        if (ps?.activePos == null) return null
        const pos = ps.activePos
        const node = state.doc.nodeAt(pos)
        if (!node) return null
        // Keep the source line occupying the same vertical box as the block it
        // replaced. A rendered heading carries a large font-size / line-height /
        // margin-top that a plain source paragraph lacks, so without this the
        // block collapses and the text visibly jumps up on entering edit mode —
        // most noticeably on the first line, where the heading's margin-top is
        // the entire gap from the top of the editor. The leading `#`-run of the
        // source text gives us the heading level; an unescaped ATX marker can
        // only come from a real heading because the serializer escapes a literal
        // leading `#` in paragraph text as `\#`.
        let cls = 'md-source-line'
        const heading = /^(#{1,6})\s/.exec(node.textContent)
        if (heading) cls += ` md-source-heading md-source-h${heading[1].length}`
        return DecorationSet.create(state.doc, [
          Decoration.node(pos, pos + node.nodeSize, {
            class: cls,
          }),
        ])
      },
    },
  })
})

// Lines that Milkdown's input rules would consume when Enter appends its
// virtual "\n": bare heading markers, blockquote/list markers, code fences
// (with optional info string), math fences, thematic breaks, table pipes.
// Enter at the end of such a line is a deliberate rule confirmation and is
// left to Milkdown; everything else is a plain text-editor line split.
const RULE_CONFIRM_RE =
  /^ {0,3}(#{1,6}|>|[-+*]|\d{1,9}[.)]|(?:`{3,}|~{3,})[^`\s]*|\$\$|[-_*](?:[ \t]*[-_*]){2,}|\|.*)[ \t]*$/

// Leading patterns that commonmark would promote a plain paragraph into a
// different block type on re-parse (heading, blockquote, bullet/ordered list,
// thematic break, fenced code). Used to keep serializeBlock's raw fast path
// from emitting text that round-trips to the wrong node type.
const BLOCK_MARKER_RE =
  /^ {0,3}(#{1,6}(\s|$)|>|[-+*](\s|$)|\d{1,9}[.)](\s|$)|[-_*]([ \t]*[-_*]){2,}[ \t]*$|`{3,}|~{3,})/

function startsWithBlockMarker(text: string): boolean {
  return BLOCK_MARKER_RE.test(text.split('\n', 1)[0])
}

function serializeBlock(
  serializer: (node: PMNode) => string,
  schema: Schema,
  node: PMNode,
): string {
  // Fast path: a plain paragraph whose children are all unmarked text nodes is
  // already in "source-string" form, so hand back its textContent instead of
  // re-escaping mid-line markers the user typed verbatim (e.g. "use * for a
  // bullet" must not be shown as "use \* for a bullet").
  //
  // EXCEPT when the text *leads* with a block-level marker (#, -, >, 1., ---,
  // ```): returning it raw would make parseLineToBlock re-parse the paragraph
  // into a heading/list/quote/etc. on swap-out, silently changing a genuine
  // paragraph's type (a paragraph holding the literal text "# foo", e.g. loaded
  // from the escaped markdown "\# foo", would become a real H1). In that case
  // fall through to the escaping serializer so the source ("\# foo") faithfully
  // round-trips back to a paragraph.
  if (node.type.name === 'paragraph') {
    let plain = true
    node.content.forEach((child) => {
      if (!plain) return
      if (!child.isText || child.marks.length > 0) plain = false
    })
    if (plain && !startsWithBlockMarker(node.textContent)) return node.textContent
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

/// Render a source-line back into its rich-block Fragment by parsing it as
/// markdown. Exposed so callers that need a *snapshot* of the rendered doc
/// (e.g. readPersistableMarkdown) can build the Fragment without dispatching
/// a transaction into the live editor.
export function parseLineToBlocks(
  parser: (text: string) => PMNode,
  schema: Schema,
  text: string,
): Fragment | null {
  try {
    if (text.trim().length === 0) {
      // Empty source paragraph -> empty paragraph.
      return Fragment.from(schema.nodes.paragraph!.create())
    }
    const doc = parser(text)
    // Return every parsed block, not just the first — the source text may be a
    // multi-block construct (hardbreak-joined headings, blank-line-separated
    // paragraphs, etc.).
    return doc.content.childCount > 0
      ? doc.content
      : Fragment.from(schema.nodes.paragraph!.create())
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
