import { describe, expect, it } from 'vitest'
import { parseMemoryFile, serializeMemoryFile } from '../src/memory-format.js'

describe('Project Memory format', () => {
  it('round-trips canonical memory', () => {
    const serialized = serializeMemoryFile(7, '# Overview\r\n\r\nCurrent facts.  \r\n')
    expect(serialized).toBe('---\nformat: 1\nrevision: 7\n---\n\n# Overview\n\nCurrent facts.\n')
    expect(parseMemoryFile(serialized)).toEqual({
      revision: 7,
      content: '# Overview\n\nCurrent facts.\n',
      legacy: false,
    })
  })

  it('accepts a legacy Markdown body at revision zero', () => {
    expect(parseMemoryFile('# Existing memory\n')).toEqual({
      revision: 0,
      content: '# Existing memory\n',
      legacy: true,
    })
  })

  it('rejects unknown metadata', () => {
    expect(() => parseMemoryFile('---\nformat: 1\nrevision: 1\nowner: agent\n---\n'))
      .toThrow(/Unknown Project Memory frontmatter key/)
  })
})
