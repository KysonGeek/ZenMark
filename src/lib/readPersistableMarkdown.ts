import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, serializerCtx } from '@milkdown/core'
import { exitSourceMode, isInSourceMode } from './activeSourceBlock'

// Synchronously compute the markdown that should be persisted for the current
// editor state.
//
// Why this exists: while a block is in "active source mode" it is rendered as a
// plain paragraph holding raw markdown (e.g. the text "# foo"), and serializing
// the document in that state escapes the leading marker into "\# foo" — a
// literal-text paragraph, not a heading. The previous save path read a debounced
// `markdownUpdated` cache, which (a) could still hold that escaped source form
// and (b) is never refreshed by the source→rich swap-back (those transactions
// are addToHistory:false, which the listener skips). So we must render any
// active source block back to its rich form and re-serialize right here, rather
// than trust the cache. This also captures keystrokes typed within the listener
// debounce window that the cache hasn't flushed yet.
export function readPersistableMarkdown(crepe: Crepe): string {
  let md = ''
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (isInSourceMode(view.state)) exitSourceMode(view)
    const serializer = ctx.get(serializerCtx)
    md = serializer(view.state.doc)
  })
  return md
}
