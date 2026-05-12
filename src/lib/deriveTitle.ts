const MAX_TITLE_LEN = 80

export function deriveTitle(content: string): string {
  const lines = content.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith('# ')) continue
    if (line.startsWith('## ')) continue
    const stripped = line.slice(2).replace(/#+\s*$/, '').trim()
    if (stripped.length === 0) continue
    return stripped.length > MAX_TITLE_LEN
      ? stripped.slice(0, MAX_TITLE_LEN)
      : stripped
  }
  return 'Untitled'
}
