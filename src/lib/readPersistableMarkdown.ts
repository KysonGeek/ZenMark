import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/core'
import { getActiveSourcePos, parseLineToBlocks } from './activeSourceBlock'

// Synchronously compute the markdown that should be persisted for the current
// editor state.
//
// Why this exists: while a block is in "active source mode" it is rendered as a
// plain paragraph holding raw markdown (e.g. the text "# foo"), and serializing
// the live document in that state escapes the leading marker into "\# foo" —
// a literal-text paragraph, not a heading. The previous implementation called
// exitSourceMode() (which dispatches a `setMeta(KEY, {activePos:null})`) and
// then serialized; but appending the swap-back triggers ProseMirror's
// selection re-mapping for the very next dispatch, and apply() — seeing the
// caret still in the restored heading — re-enters source mode for the same
// block, swapping it back to the escaped source form. The result was that
// `readPersistableMarkdown` returned "\# foo" whenever the source-mode block
// was the LAST (or only) top-level block of the doc (no sibling block grabbed
// the caret).
//
// Fix: do NOT touch the live view at all. Pull the current state, and if a
// source-mode block is active, build a *transient* tr on a clone of the doc
// (never dispatched) that re-parses the source paragraph's textContent back
// into rich blocks via the same `parseLineToBlocks` the plugin uses in
// production, then serialize that cloned doc directly. The user's view state,
// caret, and source-mode block are all left untouched.
export function readPersistableMarkdown(crepe: Crepe): string {
  let md = ''
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const state = view.state
    const serializer = ctx.get(serializerCtx)
    const pos = getActiveSourcePos(state)
    if (pos == null) {
      md = serializer(state.doc)
      return
    }
    const targetNode = state.doc.nodeAt(pos)
    if (!targetNode || targetNode.type.name !== 'paragraph') {
      md = serializer(state.doc)
      return
    }
    const parser = ctx.get(parserCtx)
    const schema = ctx.get(schemaCtx)
    const fragment = parseLineToBlocks(parser, schema, targetNode.textContent)
    if (!fragment || fragment.childCount === 0) {
      md = serializer(state.doc)
      return
    }
    // Build a transient transaction (NOT dispatched — never mutate the live
    // view) that swaps the source-mode paragraph back into rich form, then
    // serialize the resulting doc.
    const tr = state.tr.replaceWith(pos, pos + targetNode.nodeSize, fragment)
    md = serializer(tr.doc)
  })
  return md
}