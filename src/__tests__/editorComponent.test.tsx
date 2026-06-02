import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountEditorComponent } from './editorComponentHarness'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('component harness probe', () => {
  it('mounts the Editor component and renders a ProseMirror surface', async () => {
    const h = await mountEditorComponent({ initialContent: '# Hi\n\nbody' })
    expect(h.prose).toBeTruthy()
    expect(h.prose.querySelector('h1')?.textContent).toBe('Hi')
    h.destroy()
  })
})

describe('mod-click on a link (cluster 6)', () => {
  it('opens the URL exactly once for a single modifier-click', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const h = await mountEditorComponent({
      initialContent: '[example](https://example.com)',
    })
    const anchor = h.prose.querySelector('a') as HTMLAnchorElement
    expect(anchor).toBeTruthy()

    // A real mod-click dispatches mousedown then a synthesized click.
    anchor.dispatchEvent(
      new MouseEvent('mousedown', { metaKey: true, bubbles: true, cancelable: true }),
    )
    anchor.dispatchEvent(
      new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true }),
    )

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', expect.any(String))
    h.destroy()
  })

  it('still opens once when the link is activated by click alone', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const h = await mountEditorComponent({
      initialContent: '[example](https://example.com)',
    })
    const anchor = h.prose.querySelector('a') as HTMLAnchorElement
    anchor.dispatchEvent(
      new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true }),
    )
    expect(open).toHaveBeenCalledTimes(1)
    h.destroy()
  })
})

describe('click below content (cluster 7: read-only mutation)', () => {
  // jsdom getBoundingClientRect returns zeros, so any positive clientY counts as
  // "below the last block", triggering the append-empty-paragraph affordance.
  const clickBelow = (el: HTMLElement) =>
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 100 }),
    )

  it('does not mutate the document in read-only mode', async () => {
    const h = await mountEditorComponent({ initialContent: '# Hi\n\nbody', readOnly: true })
    const before = h.prose.childElementCount
    clickBelow(h.container)
    expect(h.prose.childElementCount).toBe(before)
    expect(h.saves).toHaveLength(0)
    h.destroy()
  })

  it('appends a trailing paragraph in edit mode (affordance still works)', async () => {
    const h = await mountEditorComponent({ initialContent: '# Hi\n\nbody', readOnly: false })
    const before = h.prose.childElementCount
    clickBelow(h.container)
    expect(h.prose.childElementCount).toBe(before + 1)
    h.destroy()
  })
})
