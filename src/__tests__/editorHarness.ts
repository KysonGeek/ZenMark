// Test harness: mount a real Crepe editor with the activeSourceBlock plugin in
// jsdom so we can drive the source-mode swap logic the way production does.
//
// jsdom lacks a few browser APIs Crepe/ProseMirror touch; we polyfill the
// minimum here rather than in global setup so the non-editor tests stay clean.
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, serializerCtx } from '@milkdown/core'
import type { EditorView } from '@milkdown/prose/view'
import { TextSelection } from '@milkdown/prose/state'
import type { Node as PMNode } from '@milkdown/prose/model'
import { activeSourceBlock } from '../lib/activeSourceBlock'

export function installEditorPolyfills() {
  const g = globalThis as Record<string, unknown>
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (typeof g.matchMedia === 'undefined' && typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
  // prosemirror-virtual-cursor (bundled by Crepe) measures the caret via
  // Range.getClientRects on a timer after every selection change; jsdom has
  // neither Range rect method, so without these the timer throws an uncaught
  // exception that aborts the test. Return a zero rect — we never assert layout.
  const zeroRect = () => ({
    x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0,
    toJSON() { return {} },
  })
  if (typeof Range !== 'undefined') {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = function () {
        return Object.assign([zeroRect()], { item: (i: number) => (i === 0 ? zeroRect() : null) }) as unknown as DOMRectList
      }
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = function () {
        return zeroRect() as DOMRect
      }
    }
  }
}

export interface EditorHarness {
  crepe: Crepe
  view: EditorView
  /** Serialize the whole document to markdown via the same serializer prod uses. */
  getMarkdown(): string
  /** The node types of the top-level document children, in order. */
  blockTypes(): string[]
  /** Put the caret inside the textblock at the given document position. */
  setCaretInBlock(pos: number): void
  /** Put the caret inside whichever (possibly nested) text node holds `substr`. */
  caretInText(substr: string): void
  /** Resolved depth of the current selection anchor (0 = doc root). */
  caretDepth(): number
  /** Insert a hardbreak node at the current selection (mimics Shift+Enter). */
  insertHardbreak(): void
  /** Run the plugins' handleKeyDown chain for a plain Enter keypress. */
  pressEnter(): boolean
  /** Insert literal text at the current selection (no input rules fire). */
  type(text: string): void
  /** Find the doc position of the Nth top-level block (0-based). */
  topBlockPos(index: number): number
  /** Mark the editor focused (default) so caret moves enter source mode. */
  focus(): void
  /** Simulate clicking outside: blur + render active source block back. */
  blur(): void
  /** Set the focused flag without dispatching (to stage a raw blur event). */
  setFocused(value: boolean): void
  /** Dispatch a real 'blur' FocusEvent on the editor DOM with a relatedTarget. */
  fireBlur(relatedTarget: EventTarget | null): void
  destroy(): Promise<void>
}

export async function mountEditor(initialMarkdown: string): Promise<EditorHarness> {
  installEditorPolyfills()
  const root = document.createElement('div')
  document.body.appendChild(root)

  const crepe = new Crepe({ root, defaultValue: initialMarkdown })
  crepe.editor.use(activeSourceBlock)
  await crepe.create()

  let view!: EditorView
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })

  // jsdom doesn't move document.activeElement on programmatic focus reliably,
  // and the plugin gates source mode on view.hasFocus() (root.activeElement ===
  // view.dom). Drive that invariant with an explicit flag so tests can simulate
  // focus/blur the way production does. Default focused so caret moves enter
  // source mode; blur() flips it false and renders blocks back (as onBlur does).
  let focused = true
  Object.defineProperty(view, 'hasFocus', { value: () => focused, configurable: true })

  const getMarkdown = () => {
    let md = ''
    crepe.editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx)
      md = serializer(view.state.doc)
    })
    return md
  }

  const blockTypes = () => {
    const types: string[] = []
    view.state.doc.forEach((n) => types.push(n.type.name))
    return types
  }

  const topBlockPos = (index: number) => {
    let pos = 0
    let i = 0
    let found = -1
    view.state.doc.forEach((_node, offset) => {
      if (i === index) found = offset
      i++
    })
    if (found < 0) throw new Error(`no top-level block at index ${index}`)
    pos = found
    return pos
  }

  const setCaretInBlock = (pos: number) => {
    const inside = pos + 1
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, Math.min(inside, view.state.doc.content.size)),
    )
    view.dispatch(tr)
  }

  const caretInText = (substr: string) => {
    let target = -1
    view.state.doc.descendants((node, pos) => {
      if (target >= 0) return false
      if (node.isText && node.text && node.text.includes(substr)) {
        target = pos + node.text.indexOf(substr) + 1
        return false
      }
      return true
    })
    if (target < 0) throw new Error(`no text node containing "${substr}"`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)))
  }

  const caretDepth = () => view.state.selection.$from.depth

  const insertHardbreak = () => {
    const hb = view.state.schema.nodes.hardbreak ?? view.state.schema.nodes.hard_break
    if (!hb) throw new Error('schema has no hardbreak node')
    view.dispatch(view.state.tr.replaceSelectionWith(hb.create(), false))
  }

  const type = (text: string) => {
    view.dispatch(view.state.tr.insertText(text))
  }

  // Route Enter through the same handleKeyDown chain the browser uses, so
  // whichever plugin claims it first (activeSourceBlock, Milkdown's
  // enter-confirms-input-rules plugin, keymaps) behaves as in production.
  const pressEnter = () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
  }

  return {
    crepe,
    view,
    getMarkdown,
    blockTypes,
    setCaretInBlock,
    caretInText,
    caretDepth,
    insertHardbreak,
    pressEnter,
    type,
    topBlockPos,
    focus: () => {
      focused = true
    },
    // Simulate the user clicking outside the editor: drop focus, then nudge the
    // plugin (matching activeSourceBlock's onBlur no-op dispatch) so any active
    // source block renders back to its rich form and stays rendered.
    blur: () => {
      focused = false
      view.dispatch(view.state.tr.setMeta('addToHistory', false))
    },
    setFocused: (value: boolean) => {
      focused = value
    },
    // Fire the real DOM 'blur' event the plugin listens for, with a chosen
    // relatedTarget (where focus is moving to). Lets us exercise the plugin's
    // own onBlur handler instead of the harness shortcut above.
    fireBlur: (relatedTarget: EventTarget | null) => {
      view.dom.dispatchEvent(new FocusEvent('blur', { relatedTarget: relatedTarget as Element | null }))
    },
    async destroy() {
      // Crepe's list-item-block NodeView schedules a selection dispatch via
      // requestAnimationFrame on mount (components/list-item-block:220). If we
      // destroy before that frame fires, the dispatch lands in a torn-down
      // context and throws contextNotFound. Await a frame (and a macrotask) so
      // any such deferred work runs while the editor is still alive.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await new Promise((r) => setTimeout(r, 0))
      await crepe.destroy()
      root.remove()
    },
  }
}

export { TextSelection }
export type { PMNode }
