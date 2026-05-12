import { describe, expect, it } from 'vitest'
import { deriveTitle } from '../lib/deriveTitle'

describe('deriveTitle', () => {
  it('returns "Untitled" for empty content', () => {
    expect(deriveTitle('')).toBe('Untitled')
  })

  it('returns "Untitled" for whitespace-only content', () => {
    expect(deriveTitle('   \n\n  ')).toBe('Untitled')
  })

  it('uses the first H1 line', () => {
    expect(deriveTitle('# Hello world\n\nbody')).toBe('Hello world')
  })

  it('finds first H1 even if preceded by other content', () => {
    expect(deriveTitle('some text\n\n# Real Title\n\nmore')).toBe('Real Title')
  })

  it('ignores H2/H3 if no H1', () => {
    expect(deriveTitle('## Not a title\n\nbody')).toBe('Untitled')
  })

  it('trims trailing #s and whitespace', () => {
    expect(deriveTitle('# Title ###  ')).toBe('Title')
  })

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(120)
    expect(deriveTitle('# ' + long).length).toBe(80)
  })

  it('falls back to first non-empty line when no H1 and asked nicely', () => {
    // Not part of this iteration — explicitly: no fallback. H1 only.
    expect(deriveTitle('just a paragraph')).toBe('Untitled')
  })
})
