import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorStateCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/core'
import { insertImageInputRule, remarkPreserveEmptyLinePlugin } from '@milkdown/preset-commonmark'
import { Selection } from '@milkdown/prose/state'
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
  // Fires when the scroll position moves into a different h1-h3 region.
  // -1 means no heading is currently considered active (e.g. doc has none,
  // or the user has scrolled above the first one).
  onActiveHeadingChange?: (index: number) => void
  // Read-only mode for the "Read" view (drag-select & copy without picking up
  // markdown markers). Toggled live on the existing Crepe instance — no
  // remount needed.
  readOnly?: boolean
}

// Imperative handle exposed to the parent so the outline panel can drive the
// editor without needing access to Crepe internals.
export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void
  // Force a save right now (exit source mode + flush dirty content). Used by
  // the ⌘S shortcut so users get explicit save feedback even though the editor
  // already autosaves on blur / block change.
  forceSave: () => void
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
  { docId, initialContent, onContentUpdate, onSave, onActiveHeadingChange, readOnly = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const latestRef = useRef(initialContent)    // most recent serialized markdown (may still be "dirty")
  const savedRef = useRef(initialContent)     // last markdown actually persisted
  const blockIdRef = useRef<number | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  // Updated each time useEffect re-binds. Lets the imperative handle reach
  // the *current* flush closure without leaking it out of the effect.
  const flushRef = useRef<() => void>(() => {})
  const onSaveRef = useRef(onSave)
  const onContentUpdateRef = useRef(onContentUpdate)
  const onActiveHeadingChangeRef = useRef(onActiveHeadingChange)
  const readOnlyRef = useRef(readOnly)
  onSaveRef.current = onSave
  onContentUpdateRef.current = onContentUpdate
  onActiveHeadingChangeRef.current = onActiveHeadingChange
  readOnlyRef.current = readOnly

  useImperativeHandle(ref, () => ({
    scrollToHeading: (headingIndex) => {
      const crepe = crepeRef.current
      if (!crepe) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (!view) return
        // Match parseOutline: count only h1-h3 so jump indices line up with
        // the outline panel (h4-h6 are ignored there).
        let i = 0
        let targetPos = -1
        view.state.doc.descendants((node, pos) => {
          if (targetPos >= 0) return false
          if (node.type.name === 'heading' && (node.attrs.level ?? 0) <= 3) {
            if (i === headingIndex) {
              targetPos = pos
              return false
            }
            i++
          }
          return true
        })
        if (targetPos < 0) return
        // Scroll without moving the selection — moving the caret into the
        // heading would trigger activeSourceBlock and replace the rendered
        // heading with its raw markdown text.
        const dom = view.nodeDOM(targetPos) as HTMLElement | null
        dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    forceSave: () => flushRef.current(),
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

    // Clicking the blank area below the markdown content appends an empty
    // paragraph at the end (if the last line isn't already empty) and moves
    // the cursor there — a common affordance in note-taking editors.
    // Listen on editor-root (host's parent) so clicks on its padding area
    // below the editor are also captured.
    const editorRoot = host.parentElement
    const onHostClick = (event: MouseEvent) => {
      const crepe = crepeRef.current
      if (!crepe) return
      const proseMirror = host.querySelector('.ProseMirror') as HTMLElement | null
      if (!proseMirror) return
      // .ProseMirror fills the entire editor area, so we check against the
      // last visible block child instead of the container itself.
      const lastBlock = proseMirror.lastElementChild as HTMLElement | null
      if (!lastBlock) return
      const lastRect = lastBlock.getBoundingClientRect()
      if (event.clientY <= lastRect.bottom) return

      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (!view) return
        const { doc, schema } = view.state
        const lastNode = doc.lastChild
        if (!lastNode) return
        // If the last node is already an empty paragraph, just move the
        // cursor there instead of adding a redundant blank line.
        if (lastNode.type.name === 'paragraph' && lastNode.childCount === 0) {
          const endPos = doc.content.size
          view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(endPos))))
          view.focus()
          return
        }
        // Append an empty paragraph at the end and place the cursor inside it.
        const paragraph = schema.nodes.paragraph.create()
        const tr = view.state.tr.insert(doc.content.size, paragraph)
        tr.setSelection(Selection.near(tr.doc.resolve(tr.doc.content.size)))
        view.dispatch(tr)
        view.focus()
      })
    }
    editorRoot?.addEventListener('click', onHostClick)

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
    flushRef.current = flush

    // Track the most recently clicked code-block copy button so the
     // CodeMirror feature's onCopy callback (which only receives the copied
     // text) can swap its label to "Copied" as visual confirmation.
    let lastCopyButton: HTMLButtonElement | null = null
    const trackCopyButton = (event: Event) => {
      const btn = (event.target as HTMLElement | null)?.closest?.('.copy-button')
      if (btn) lastCopyButton = btn as HTMLButtonElement
    }
    host.addEventListener('click', trackCopyButton, true)

    const crepe = new Crepe({
      root: hostRef.current,
      defaultValue: initialContent,
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          onCopy: () => {
            const btn = lastCopyButton
            if (!btn) return
            const textNode = Array.from(btn.childNodes).find(
              (n) => n.nodeType === Node.TEXT_NODE,
            ) as Text | null
            if (!textNode) return
            textNode.data = 'Copied!'
            window.setTimeout(() => {
              if (textNode.isConnected) textNode.data = 'Copy'
            }, 2000)
          },
        },
      },
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
    // Walk up to the nearest scrollable ancestor so we can listen for scroll
    // and compute which heading is currently "active" (i.e. last one whose
    // top edge has passed the threshold near the viewport top).
    let scroller: HTMLElement | null = host.parentElement
    while (scroller && scroller !== document.body) {
      const oy = getComputedStyle(scroller).overflowY
      if (oy === 'auto' || oy === 'scroll') break
      scroller = scroller.parentElement
    }
    let lastActiveIdx = -2
    let scrollRaf = 0
    const updateActiveHeading = () => {
      scrollRaf = 0
      const cb = onActiveHeadingChangeRef.current
      if (!cb || !scroller) return
      const headings = host.querySelectorAll<HTMLElement>(
        '.milkdown h1, .milkdown h2, .milkdown h3',
      )
      if (headings.length === 0) {
        if (lastActiveIdx !== -1) {
          lastActiveIdx = -1
          cb(-1)
        }
        return
      }
      const threshold = scroller.getBoundingClientRect().top + 96
      let idx = -1
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= threshold) idx = i
        else break
      }
      // Before scrolling past the first heading, treat the first as active so
      // the outline always reflects "where you are" rather than blanking out.
      if (idx < 0) idx = 0
      if (idx !== lastActiveIdx) {
        lastActiveIdx = idx
        cb(idx)
      }
    }
    const scheduleActiveHeadingUpdate = () => {
      if (scrollRaf) return
      scrollRaf = requestAnimationFrame(updateActiveHeading)
    }
    scroller?.addEventListener('scroll', scheduleActiveHeadingUpdate, { passive: true })

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
        // Apply the initial readonly state — the dedicated useEffect below
        // also calls setReadonly but it runs *before* create() resolves on
        // first mount, so the call is a no-op until the editor exists.
        crepe.setReadonly(readOnlyRef.current)
        // After mount, run once so the outline gets an initial active item.
        scheduleActiveHeadingUpdate()
      })
      .catch((err) => {
        console.error('Crepe failed to mount', err)
      })
    // Also recompute after edits — adding/removing headings shifts which one
    // contains the cursor's region.
    crepe.on((listener) => {
      listener.markdownUpdated(() => {
        scheduleActiveHeadingUpdate()
      })
    })
    return () => {
      // Flush any pending edits synchronously so doc switches and unmounts
      // don't drop the last keystrokes.
      flush()
      host.removeEventListener('mousedown', onHostMouseDown, true)
      host.removeEventListener('click', onHostMouseDown, true)
      host.removeEventListener('click', trackCopyButton, true)
      editorRoot?.removeEventListener('click', onHostClick)
      window.removeEventListener('keydown', updateModKeyClass)
      window.removeEventListener('keyup', updateModKeyClass)
      window.removeEventListener('blur', clearModKeyClass)
      scroller?.removeEventListener('scroll', scheduleActiveHeadingUpdate)
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
      crepeRef.current = null
      crepe.destroy().catch(() => {
        // ignore destroy errors during unmount
      })
    }
    // initialContent + docId are captured intentionally on mount; doc switches
    // remount this component via React `key`. Crepe has no setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle Crepe's readonly state without remounting the editor. Safe to call
  // before .create() resolves — Crepe's setReadonly is internally guarded.
  // After flipping editable, dispatch a no-op transaction so activeSourceBlock
  // re-runs apply() and renders any currently-active source paragraph back to
  // its rich form (its new editable-guard short-circuits to activePos=null).
  // Without the nudge, toggling read mode via shortcut while the editor is
  // focused would leave a heading frozen as "# foo" plaintext.
  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe) return
    crepe.setReadonly(readOnly)
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta('addToHistory', false))
      })
    } catch {
      // editor not yet created — initial readonly state is applied inside
      // create().then() above, so this is safe to ignore.
    }
  }, [readOnly])

  return <div ref={hostRef} className="editor-host" data-readonly={readOnly ? 'true' : undefined} />
})

