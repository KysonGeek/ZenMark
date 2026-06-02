import { describe, expect, it } from 'vitest'
// @ts-expect-error node:fs is runtime-only here — this project has no @types/node
import { readFileSync } from 'node:fs'

declare const process: { cwd(): string }

// CSS rendering/cascade can't be exercised in jsdom (and vitest disables CSS
// imports), so these tests read the stylesheet and guard the specific
// declarations that fix the source-heading color/weight flash: source headings
// must visually match their rendered counterparts so entering edit mode only
// reveals the `#` markers (editor-overrides.css documents this intent).
const css: string = readFileSync(
  `${process.cwd()}/src/styles/editor-overrides.css`,
  'utf8',
)

function ruleBody(selectorFragment: string): string {
  const at = css.indexOf(selectorFragment)
  if (at < 0) throw new Error(`selector not found: ${selectorFragment}`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('source heading styling (cluster 8: color/weight parity)', () => {
  it('gives source h1/h2/h3 the full text color so they do not flash muted', () => {
    for (const level of ['h1', 'h2', 'h3']) {
      const body = ruleBody(`.md-source-line.md-source-${level}`)
      expect(body).toMatch(/color:\s*var\(--text\)/)
    }
  })

  it('does not over-bold source h6 (rendered h6 is 600, not 700)', () => {
    const body = ruleBody('.md-source-line.md-source-h6')
    expect(body).not.toMatch(/font-weight:\s*700/)
  })
})
