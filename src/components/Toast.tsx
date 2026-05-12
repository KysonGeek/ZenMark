import { useEffect } from 'react'

interface Props {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
  // Auto-dismiss after this many ms. The countdown is owned by the toast so
  // re-rendering it (e.g. on prop change) resets the timer naturally.
  durationMs?: number
}

export function Toast({ message, actionLabel, onAction, onDismiss, durationMs = 5000 }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(id)
  }, [durationMs, onDismiss])

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-msg">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onAction()
            onDismiss()
          }}
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}
