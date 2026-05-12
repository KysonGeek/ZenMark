import { useEffect, useState } from 'react'

const STORAGE_KEY = 'markra.onboarded'

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const Mod = isMac ? '⌘' : 'Ctrl'
const Shift = isMac ? '⇧' : 'Shift+'

const TIPS: { keys: string; label: string }[] = [
  { keys: `${Mod}N`, label: 'New document' },
  { keys: `${Mod}P`, label: 'Quick open' },
  { keys: `${Mod}K`, label: 'Search sidebar' },
  { keys: `${Mod}/`, label: 'Toggle source view' },
  { keys: `${Shift}${Mod}R`, label: 'Read mode (clean copy)' },
  { keys: `${Shift}${Mod}E`, label: 'Export current doc' },
  { keys: `${Mod}\\`, label: 'Toggle sidebar' },
]

interface Props {
  // Imperative re-open: bumping this forces the card to show again even if
  // the user dismissed it previously. Used by a future "show tips" button.
  forceOpen?: number
}

export function OnboardingCard({ forceOpen }: Props) {
  const [visible, setVisible] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'true'
  })

  useEffect(() => {
    if (forceOpen !== undefined && forceOpen > 0) setVisible(true)
  }, [forceOpen])

  if (!visible) return null

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'true')
    setVisible(false)
  }

  return (
    <div className="onboard-card" role="dialog" aria-label="Welcome tips">
      <div className="onboard-header">
        <span className="onboard-title">Welcome 👋</span>
        <button
          type="button"
          className="onboard-close"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
      <p className="onboard-intro">
        A Typora-style markdown editor that lives entirely in your browser. A
        few shortcuts to get you moving:
      </p>
      <ul className="onboard-tips">
        {TIPS.map((t) => (
          <li key={t.keys}>
            <kbd>{t.keys}</kbd>
            <span>{t.label}</span>
          </li>
        ))}
      </ul>
      <p className="onboard-hint">Tip: drag a <code>.md</code> file onto the window to import.</p>
      <button type="button" className="onboard-cta" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
