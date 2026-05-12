import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const SAVE_DEBOUNCE_MS = 500

interface Props {
  docId: string
  initialContent: string
  onContentUpdate?: (md: string) => void
  onSave: (docId: string, content: string) => void
}

export interface SourceEditorHandle {
  forceSave: () => void
}

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(
  { docId, initialContent, onContentUpdate, onSave },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const latestRef = useRef(initialContent)
  const onSaveRef = useRef(onSave)
  const onContentUpdateRef = useRef(onContentUpdate)
  onSaveRef.current = onSave
  onContentUpdateRef.current = onContentUpdate

  useImperativeHandle(ref, () => ({
    forceSave: () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      onSaveRef.current(docId, latestRef.current)
    },
  }))

  // Auto-focus the textarea on mount and put cursor at end.
  useEffect(() => {
    if (taRef.current) {
      taRef.current.focus()
      taRef.current.setSelectionRange(initialContent.length, initialContent.length)
    }
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        onSaveRef.current(docId, latestRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <textarea
      ref={taRef}
      className="source-editor"
      defaultValue={initialContent}
      spellCheck={false}
      onChange={(e) => {
        const md = e.target.value
        latestRef.current = md
        onContentUpdateRef.current?.(md)
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          onSaveRef.current(docId, md)
        }, SAVE_DEBOUNCE_MS)
      }}
    />
  )
})
