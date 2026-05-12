import { describe, expect, it } from 'vitest'
import { filenameFromTitle, readMarkdownFile } from '../lib/ioFile'

describe('filenameFromTitle', () => {
  it('appends .md', () => {
    expect(filenameFromTitle('Hello')).toBe('Hello.md')
  })

  it('replaces filesystem-unsafe characters with -', () => {
    expect(filenameFromTitle('foo/bar:baz?')).toBe('foo-bar-baz-.md')
  })

  it('falls back to "Untitled" for empty/whitespace title', () => {
    expect(filenameFromTitle('')).toBe('Untitled.md')
    expect(filenameFromTitle('   ')).toBe('Untitled.md')
  })
})

describe('readMarkdownFile', () => {
  it('reads File contents as text', async () => {
    const file = new File(['# Hello\n\nworld'], 'x.md', { type: 'text/markdown' })
    expect(await readMarkdownFile(file)).toBe('# Hello\n\nworld')
  })
})
