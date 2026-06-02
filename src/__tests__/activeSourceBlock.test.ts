import { describe, expect, it } from 'vitest'
import { isInSourceMode } from '../lib/activeSourceBlock'
import { readPersistableMarkdown } from '../lib/readPersistableMarkdown'
import { mountEditor } from './editorHarness'

describe('harness probe', () => {
  it('mounts a Crepe editor and round-trips simple markdown', async () => {
    const h = await mountEditor('# Hello\n\nworld')
    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])
    expect(h.getMarkdown().trim()).toBe('# Hello\n\nworld')
    await h.destroy()
  })

  it('enters source mode on caret-in and renders back on blur', async () => {
    const h = await mountEditor('# Hello\n\nworld')
    h.setCaretInBlock(h.topBlockPos(0))
    expect(isInSourceMode(h.view.state)).toBe(true)
    // In source mode the heading is a plain paragraph holding "# Hello".
    expect(h.blockTypes()[0]).toBe('paragraph')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Hello')
    // Blurring (clicking outside) restores the heading and stays rendered.
    h.blur()
    expect(isInSourceMode(h.view.state)).toBe(false)
    expect(h.blockTypes()[0]).toBe('heading')
    expect(h.getMarkdown().trim()).toBe('# Hello\n\nworld')
    await h.destroy()
  })
})

describe('round-trip safety (cluster 2: escaped leading markers)', () => {
  it('keeps an escaped-hash paragraph a paragraph after click in/out', async () => {
    const h = await mountEditor('\\# foo\n\nsecond')
    // Sanity: it loaded as a paragraph whose visible text is "# foo".
    expect(h.blockTypes()).toEqual(['paragraph', 'paragraph'])
    expect(h.view.state.doc.firstChild?.textContent).toBe('# foo')

    // Click in (enter source mode) then out (blur) without typing anything.
    h.setCaretInBlock(h.topBlockPos(0))
    expect(isInSourceMode(h.view.state)).toBe(true)
    h.blur()

    // It must NOT have silently become a real heading.
    expect(h.blockTypes()).toEqual(['paragraph', 'paragraph'])
    expect(h.getMarkdown().trim()).toBe('\\# foo\n\nsecond')
    await h.destroy()
  })

  it('keeps an escaped-dash paragraph a paragraph after click in/out', async () => {
    const h = await mountEditor('\\- item\n\nsecond')
    expect(h.blockTypes()).toEqual(['paragraph', 'paragraph'])
    expect(h.view.state.doc.firstChild?.textContent).toBe('- item')

    h.setCaretInBlock(h.topBlockPos(0))
    h.blur()

    expect(h.blockTypes()).toEqual(['paragraph', 'paragraph'])
    expect(h.getMarkdown().trim()).toBe('\\- item\n\nsecond')
    await h.destroy()
  })

  it('still lets a real heading round-trip through source mode unharmed', async () => {
    const h = await mountEditor('# Title\n\nbody')
    h.setCaretInBlock(h.topBlockPos(0))
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Title')
    h.blur()
    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])
    expect(h.getMarkdown().trim()).toBe('# Title\n\nbody')
    await h.destroy()
  })

  it('does not show spurious backslashes for a mid-line marker (fast path kept)', async () => {
    const h = await mountEditor('use \\* for emphasis')
    h.setCaretInBlock(h.topBlockPos(0))
    // The source line keeps the clean text the user sees, not "use \* for ...".
    expect(h.view.state.doc.firstChild?.textContent).toBe('use * for emphasis')
    h.blur()
    expect(h.blockTypes()).toEqual(['paragraph'])
    await h.destroy()
  })
})

describe('persistable markdown (cluster 1: serialize after exiting source mode)', () => {
  it('returns rendered heading markdown, not the escaped source form, after typing in source mode', async () => {
    const h = await mountEditor('# Hello\n\nbody')
    h.caretInText('Hello') // enter source mode; caret lands at end of "# Hello"
    expect(isInSourceMode(h.view.state)).toBe(true)
    h.type(' World')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Hello World')

    // Document the bug: serializing the LIVE (source-mode) doc escapes the
    // heading into a literal-text paragraph — this is what flush() used to save.
    expect(h.getMarkdown()).toContain('\\#')

    // The persistable read must first render the block back, then serialize.
    const md = readPersistableMarkdown(h.crepe)
    expect(md.trim()).toBe('# Hello World\n\nbody')
    await h.destroy()
  })

  it('is a no-op-safe read when nothing is in source mode', async () => {
    const h = await mountEditor('# Title\n\nbody')
    expect(readPersistableMarkdown(h.crepe).trim()).toBe('# Title\n\nbody')
    await h.destroy()
  })
})

describe('nested blocks stay rich (cluster 4: blockquote/list source mode)', () => {
  it('does not enter source mode for a paragraph inside a blockquote', async () => {
    const h = await mountEditor('> quote\n\ntail')
    expect(h.blockTypes()[0]).toBe('blockquote')
    h.caretInText('quote')
    expect(h.caretDepth()).toBeGreaterThan(1) // genuinely nested inside the quote
    expect(isInSourceMode(h.view.state)).toBe(false)
    // The blockquote stays rich, not collapsed to a marker-less paragraph.
    expect(h.blockTypes()[0]).toBe('blockquote')
    h.blur()
    expect(h.getMarkdown().trim()).toBe('> quote\n\ntail')
    await h.destroy()
  })

  it('does not enter source mode for a paragraph inside a list item', async () => {
    const h = await mountEditor('- item\n\ntail')
    expect(h.blockTypes()[0]).toBe('bullet_list')
    h.caretInText('item')
    expect(h.caretDepth()).toBeGreaterThan(1)
    expect(isInSourceMode(h.view.state)).toBe(false)
    expect(h.blockTypes()[0]).toBe('bullet_list')
    await h.destroy()
  })

  it('still enters source mode for top-level paragraphs and headings', async () => {
    const h = await mountEditor('hello\n\n# head')
    h.caretInText('hello')
    expect(h.caretDepth()).toBe(1)
    expect(isInSourceMode(h.view.state)).toBe(true)
    h.blur()
    h.focus()
    h.caretInText('head')
    expect(isInSourceMode(h.view.state)).toBe(true)
    await h.destroy()
  })
})

describe('in-place upgrade keeps markers visible (regression for "# " typing)', () => {
  it('re-shows source markers when the active block is upgraded to a heading in place', async () => {
    const h = await mountEditor('hello\n\nbody')
    h.caretInText('hello') // source mode on the paragraph
    expect(isInSourceMode(h.view.state)).toBe(true)
    // Mimic the commonmark heading inputRule: change the active block's type to
    // heading in place (same position) — the plugin must re-enter source mode so
    // the just-created heading shows its editable "# " marker instead of
    // rendering with the marker hidden.
    const pos = h.topBlockPos(0)
    const { schema } = h.view.state
    h.view.dispatch(
      h.view.state.tr.setBlockType(pos + 1, pos + 1, schema.nodes.heading, { level: 1 }),
    )
    expect(isInSourceMode(h.view.state)).toBe(true)
    expect(h.view.state.doc.firstChild?.type.name).toBe('paragraph') // shown as source
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')
    await h.destroy()
  })
})

describe('blur target awareness (cluster 5: focus moving to an editor widget)', () => {
  it('keeps the source block when focus moves to an element inside the editor', async () => {
    const h = await mountEditor('# Hello\n\nbody')
    h.caretInText('Hello')
    expect(isInSourceMode(h.view.state)).toBe(true)
    // Focus moves to a widget that lives inside the editor (e.g. the link
    // tooltip's URL input). The block the user is editing must NOT collapse.
    h.setFocused(false)
    h.fireBlur(h.view.dom)
    expect(isInSourceMode(h.view.state)).toBe(true)
    await h.destroy()
  })

  it('renders the source block back when focus leaves the editor entirely', async () => {
    const h = await mountEditor('# Hello\n\nbody')
    h.caretInText('Hello')
    expect(isInSourceMode(h.view.state)).toBe(true)
    h.setFocused(false)
    h.fireBlur(document.body) // focus left the editor surface
    expect(isInSourceMode(h.view.state)).toBe(false)
    await h.destroy()
  })
})

describe('no block dropped on exit (cluster 3: hardbreak in source line)', () => {
  it('preserves every parsed block when a source line spans multiple blocks', async () => {
    const h = await mountEditor('# A\n\ntail')
    // Enter source mode on the heading; caret lands at end of "# A".
    h.setCaretInBlock(h.topBlockPos(0))
    expect(h.view.state.doc.firstChild?.textContent).toBe('# A')
    // Shift+Enter then a second heading marker: source line becomes "# A\n# B".
    h.insertHardbreak()
    h.type('# B')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# A\n# B')

    // Leaving the block must NOT drop the second heading.
    h.blur()
    const md = h.getMarkdown()
    expect(md).toContain('# A')
    expect(md).toContain('# B')
    // Both headings survive as real blocks (plus the trailing paragraph).
    expect(h.blockTypes().filter((t) => t === 'heading')).toHaveLength(2)
    await h.destroy()
  })
})
