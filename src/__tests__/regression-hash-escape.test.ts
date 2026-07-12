import { describe, expect, it } from 'vitest'
import { isInSourceMode } from '../lib/activeSourceBlock'
import { readPersistableMarkdown } from '../lib/readPersistableMarkdown'
import { mountEditor } from './editorHarness'

describe('repro: switch to source mode after # hello Enter', () => {
  it('caret IN heading → type extension → readPersistable yields heading', async () => {
    // Same shape as the existing 'persistable markdown' test on line 83.
    const h = await mountEditor('# Hello\n\nbody')
    h.caretInText('Hello')
    expect(isInSourceMode(h.view.state)).toBe(true)
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Hello')

    const md = readPersistableMarkdown(h.crepe)
    expect(md.trim()).toBe('# Hello\n\nbody')
    expect(md).not.toContain('\\#')
    await h.destroy()
  })

  it('caret at start of heading → readPersistable yields heading', async () => {
    const h = await mountEditor('# Hello\n\nbody')
    h.setCaretInBlock(h.topBlockPos(0))
    expect(isInSourceMode(h.view.state)).toBe(true)
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Hello')

    const md = readPersistableMarkdown(h.crepe)
    expect(md.trim()).toBe('# Hello\n\nbody')
    expect(md).not.toContain('\\#')
    await h.destroy()
  })

  it('caret at end of heading via setCaretInBlock(topBlockPos), then Enter simulated', async () => {
    const h = await mountEditor('# Hello\n\n')
    h.setCaretInBlock(h.topBlockPos(0))
    expect(h.view.state.doc.firstChild?.textContent).toBe('# Hello')

    const md = readPersistableMarkdown(h.crepe)
    expect(md).not.toContain('\\#')
    expect(md).toContain('# Hello')
    await h.destroy()
  })
})