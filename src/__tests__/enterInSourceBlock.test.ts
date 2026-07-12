import { describe, expect, it } from 'vitest'
import { redo, undo } from '@milkdown/prose/history'
import { readPersistableMarkdown } from '../lib/readPersistableMarkdown'
import { mountEditor, TextSelection } from './editorHarness'

// Regression: with "# hello" in source mode and the caret right after the
// "#", Enter used to be consumed by Milkdown's enter-confirms-input-rules
// plugin — the heading rule swallowed the "#" and kept " hello" (leading
// space intact) as heading content, which persisted as "# &#x20;hello".
// Mid-line Enter in a source block must instead split the line at the caret.
describe('Enter inside an active source block', () => {
  it('caret after "#" in "# hello" splits the line instead of eating the marker', async () => {
    const h = await mountEditor('# hello')
    h.caretInText('hello')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')

    // Caret right after the "#": block start + 1 (into the paragraph) + 1 char.
    const pos = h.topBlockPos(0) + 2
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, pos)))

    expect(h.pressEnter()).toBe(true)

    // The "#" left behind renders back as an empty heading; the remainder
    // (" hello") is the new active source line under the caret.
    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])
    expect(h.view.state.doc.child(1).textContent).toBe(' hello')
    // Caret sits at the start of the remainder line, like a text editor.
    expect(h.view.state.selection.$from.parentOffset).toBe(0)
    expect(h.view.state.selection.$from.parent.textContent).toBe(' hello')

    const md = readPersistableMarkdown(h.crepe)
    expect(md).not.toContain('&#x20;')
    expect(md.trim()).toBe('#\n\nhello')
    await h.destroy()
  })

  it('the split is one undo step: Cmd+Z restores the source line and caret', async () => {
    const h = await mountEditor('# hello')
    h.caretInText('hello')
    const pos = h.topBlockPos(0) + 2
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, pos)))

    expect(h.pressEnter()).toBe(true)
    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])

    expect(undo(h.view.state, h.view.dispatch)).toBe(true)
    expect(h.blockTypes()).toEqual(['paragraph'])
    // Restored source text must NOT get re-escaped to "\# hello".
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')
    expect(h.view.state.selection.$from.parentOffset).toBe(1)
    expect(readPersistableMarkdown(h.crepe).trim()).toBe('# hello')

    expect(redo(h.view.state, h.view.dispatch)).toBe(true)
    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])
    expect(h.view.state.doc.child(1).textContent).toBe(' hello')
    expect(readPersistableMarkdown(h.crepe).trim()).toBe('#\n\nhello')
    await h.destroy()
  })

  it('undo of plain typing in source mode still works', async () => {
    const h = await mountEditor('# hello')
    h.caretInText('hello')
    h.type('XYZ')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# helloXYZ')

    expect(undo(h.view.state, h.view.dispatch)).toBe(true)
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')
    await h.destroy()
  })

  it('caret mid-word splits into heading + source remainder', async () => {
    const h = await mountEditor('# hello')
    // Entering source mode parks the caret at end of line; move it after "# hel".
    h.caretInText('hello')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')
    const pos = h.topBlockPos(0) + 1 + '# hel'.length
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, pos)))

    expect(h.pressEnter()).toBe(true)

    expect(h.blockTypes()).toEqual(['heading', 'paragraph'])
    expect(h.view.state.doc.child(0).textContent).toBe('hel')
    expect(h.view.state.doc.child(1).textContent).toBe('lo')

    const md = readPersistableMarkdown(h.crepe)
    expect(md.trim()).toBe('# hel\n\nlo')
    await h.destroy()
  })

  it('caret at end of line still defers to Milkdown (heading + empty paragraph)', async () => {
    const h = await mountEditor('# hello')
    // Entering source mode already parks the caret at end of line.
    h.caretInText('hello')
    expect(h.view.state.doc.firstChild?.textContent).toBe('# hello')

    expect(h.pressEnter()).toBe(true)

    expect(h.blockTypes()[0]).toBe('heading')
    expect(h.view.state.doc.child(0).textContent).toBe('hello')

    const md = readPersistableMarkdown(h.crepe)
    expect(md).toContain('# hello')
    expect(md).not.toContain('&#x20;')
    await h.destroy()
  })
})
