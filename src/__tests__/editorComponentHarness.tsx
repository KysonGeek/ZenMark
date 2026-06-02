// Mount the real <Editor/> React component (Crepe + all its DOM handlers) in
// jsdom so we can exercise the host-level mouse handlers and read-only guards
// the way the running app does. The plugin-level harness (editorHarness.ts)
// deliberately bypasses these handlers; this one keeps them.
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { createRef } from 'react'
import { Editor, type EditorHandle } from '../components/Editor'
import { installEditorPolyfills } from './editorHarness'

export interface SaveCall {
  docId: string
  content: string
}

export interface ComponentHarness {
  container: HTMLDivElement
  host: HTMLDivElement
  prose: HTMLElement
  ref: React.RefObject<EditorHandle | null>
  saves: SaveCall[]
  /** The latest doc markdown observed via onContentUpdate. */
  lastContent: () => string | null
  destroy(): void
}

export async function mountEditorComponent(opts: {
  initialContent: string
  readOnly?: boolean
}): Promise<ComponentHarness> {
  installEditorPolyfills()
  const container = document.createElement('div')
  document.body.appendChild(container)

  const ref = createRef<EditorHandle>()
  const saves: SaveCall[] = []
  let lastContent: string | null = null

  let root!: Root
  await act(async () => {
    root = createRoot(container)
    root.render(
      <Editor
        ref={ref}
        docId="doc-1"
        initialContent={opts.initialContent}
        readOnly={opts.readOnly ?? false}
        onSave={(docId, content) => saves.push({ docId, content })}
        onContentUpdate={(md) => {
          lastContent = md
        }}
      />,
    )
  })

  // crepe.create() resolves asynchronously inside the effect; wait for the
  // ProseMirror surface to appear.
  const host = container.querySelector('.editor-host') as HTMLDivElement
  let prose: HTMLElement | null = null
  for (let i = 0; i < 100 && !prose; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    prose = container.querySelector('.ProseMirror') as HTMLElement | null
  }
  if (!prose) throw new Error('ProseMirror surface never mounted')

  return {
    container,
    host,
    prose,
    ref,
    saves,
    lastContent: () => lastContent,
    destroy() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
