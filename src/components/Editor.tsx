import { Crepe } from '@milkdown/crepe'
import { editorStateCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/core'
import { insertImageInputRule, remarkPreserveEmptyLinePlugin } from '@milkdown/preset-commonmark'
import { TextSelection } from '@milkdown/prose/state'
import type { Selection } from '@milkdown/prose/state'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { activeSourceBlock, exitSourceMode, isInSourceMode } from '../lib/activeSourceBlock'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import '../styles/editor-overrides.css'

interface Props {
  docId: string                  // re-mounts Crepe on change (via React `key`)
  initialContent: string
  onContentUpdate?: (md: string) => void   // fires on every change — lets parent keep latest content for mode switches
  onSave: (docId: string, content: string) => void
}

// Imperative handle exposed to the parent so the outline panel can drive the
// editor without needing access to Crepe internals.
export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void
}

// Returns an identifier that stays the same while the cursor stays inside
// the same textblock and changes when it moves to a different one. The doc
// position of the block's parent node is stable under edits that don't
// restructure earlier blocks, so it works as a block identity.
function blockIdFromSelection(sel: Selection): number | null {
  const { $from } = sel
  if ($from.depth === 0) return null
  return $from.before($from.depth)
}

// Cmd/Ctrl/Alt + click on a link mark opens the URL. Without a modifier we
// keep ProseMirror's default behaviour (place the caret) so users can still
// edit link text. We detect the link mark on the click target's resolved
// position rather than walking the DOM, so anchors inside images, code, etc.
// all work uniformly.
// (Implementation moved into the host element listener inside useEffect so
// it runs in the capture phase, ahead of Crepe's link tooltip handler.)

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { docId, initialContent, onContentUpdate, onSave },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const latestRef = useRef(initialContent)    // most recent serialized markdown (may still be "dirty")
  const savedRef = useRef(initialContent)     // last markdown actually persisted
  const blockIdRef = useRef<number | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const onSaveRef = useRef(onSave)
  const onContentUpdateRef = useRef(onContentUpdate)
  onSaveRef.current = onSave
  onContentUpdateRef.current = onContentUpdate

  useImperativeHandle(ref, () => ({
    scrollToHeading: (headingIndex) => {
      const crepe = crepeRef.current
      if (!crepe) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (!view) return
        let i = 0
        let targetPos = -1
        view.state.doc.descendants((node, pos) => {
          if (targetPos >= 0) return false
          if (node.type.name === 'heading') {
            if (i === headingIndex) {
              targetPos = pos
              return false
            }
            i++
          }
          return true
        })
        if (targetPos < 0) return
        // Place the cursor at the start of the heading's text content.
        const { tr } = view.state
        const sel = TextSelection.create(view.state.doc, targetPos + 1)
        view.dispatch(tr.setSelection(sel).scrollIntoView())
        view.focus()
      })
    },
  }))

  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current

    // Cmd/Ctrl/Alt + click on an <a> opens the URL in a new tab. We listen on
    // the host element at the capture phase so we preempt Crepe's own link
    // tooltip / edit handler (which otherwise swallows the click and places
    // the caret in edit mode).
    const onHostMouseDown = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey || event.altKey)) return
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      window.open(href, '_blank', 'noopener,noreferrer')
    }
    host.addEventListener('mousedown', onHostMouseDown, true)
    host.addEventListener('click', onHostMouseDown, true)

    // Toggle a class on the host whenever a modifier is held so CSS can flip
    // <a> elements to a pointer cursor (matching native cmd-click affordance).
    const updateModKeyClass = (event: KeyboardEvent) => {
      const active = event.metaKey || event.ctrlKey || event.altKey
      host.classList.toggle('mod-key-down', active)
    }
    const clearModKeyClass = () => host.classList.remove('mod-key-down')
    window.addEventListener('keydown', updateModKeyClass)
    window.addEventListener('keyup', updateModKeyClass)
    window.addEventListener('blur', clearModKeyClass)
    // Force any active source-mode block back into rendered form before we
    // read `latestRef` for persistence; otherwise we'd save e.g. "\# foo"
    // (paragraph text with # escaped) instead of a real heading.
    const renderActiveBlock = () => {
      const crepe = crepeRef.current
      if (!crepe) return
      try {
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          if (!view) return
          if (isInSourceMode(view.state)) {
            exitSourceMode(view)
          }
        })
      } catch {
        // Editor may not be mounted yet during early unmount; ignore.
      }
    }

    const flush = () => {
      renderActiveBlock()
      if (latestRef.current !== savedRef.current) {
        savedRef.current = latestRef.current
        onSaveRef.current(docId, latestRef.current)
      }
    }

    const crepe = new Crepe({
      root: hostRef.current,
      defaultValue: initialContent,
    })
    crepeRef.current = crepe
    // Force resource-style links on serialization. Without this, mdast-util-to-
    // markdown promotes `[url](url)` into autolink form `<url>`, which is why
    // pasted URLs came back wrapped in angle brackets.
    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        resourceLink: true,
      }))
    })
    // Register the "active block source mode" plugin before create(). It
    // swaps the cursor's textblock to raw markdown text so users can edit
    // marker characters (#, **, [](), ![]()) directly.
    crepe.editor.use(activeSourceBlock)
    // Crepe's bundled inputRules omit insertImageInputRule, so `![](url)` stays
    // as plain text and the serializer escapes `!`, `[`, `]`, `(`, `:` on save.
    // Adding it here makes the closing `)` upgrade the text into an image node.
    crepe.editor.use(insertImageInputRule)
    crepe.on((listener) => {
      // Keep latestRef and parent in sync on every change, but do NOT save
      // here — while the cursor stays on the current line the serializer
      // escapes half-typed syntax like `![](`. We defer persistence until
      // the cursor leaves the block (e.g. user presses Enter) so that any
      // InputRule (image, link, etc.) has a chance to upgrade plain text
      // into real nodes first.
      listener.markdownUpdated((ctx, md) => {
        latestRef.current = md
        // While a block is in source mode, the serialized markdown contains
        // the user's half-finished raw text (e.g. paragraph "# foo"), which
        // would temporarily drop a heading from the outline and store
        // escape-laden text. Skip propagation; the next swap-out will fire
        // markdownUpdated again with the rendered content.
        try {
          const state = ctx.get(editorStateCtx)
          if (isInSourceMode(state)) return
        } catch {
          // ignore, fall through and propagate
        }
        onContentUpdateRef.current?.(md)
      })
      listener.selectionUpdated((_ctx, selection) => {
        const nextId = blockIdFromSelection(selection)
        if (blockIdRef.current === null) {
          blockIdRef.current = nextId
          return
        }
        if (nextId !== blockIdRef.current) {
          blockIdRef.current = nextId
          flush()
        }
      })
      listener.blur(() => {
        flush()
      })
    })
    crepe
      .create()
      .then(() => {
        // The paragraph runner in preset-commonmark emits `<br />` for empty
        // paragraphs when `remarkPreserveEmptyLinePlugin`'s options slice is
        // registered (`paragraph.ts:shouldPreserveEmptyLine`). Removing the
        // slice flips that check to `false` so pressing Enter no longer
        // injects `<br />` into serialized markdown.
        crepe.editor.action((ctx) => {
          try {
            ctx.remove(remarkPreserveEmptyLinePlugin.id)
          } catch {
            // slice already absent — safe to ignore
          }
        })
      })
      .catch((err) => {
        console.error('Crepe failed to mount', err)
      })
    return () => {
      // Flush any pending edits synchronously so doc switches and unmounts
      // don't drop the last keystrokes.
      flush()
      host.removeEventListener('mousedown', onHostMouseDown, true)
      host.removeEventListener('click', onHostMouseDown, true)
      window.removeEventListener('keydown', updateModKeyClass)
      window.removeEventListener('keyup', updateModKeyClass)
      window.removeEventListener('blur', clearModKeyClass)
      crepeRef.current = null
      crepe.destroy().catch(() => {
        // ignore destroy errors during unmount
      })
    }
    // initialContent + docId are captured intentionally on mount; doc switches
    // remount this component via React `key`. Crepe has no setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="editor-host" />
})

