import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.js'
import { ProjectMemoryStore } from '../src/memory-store.js'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ProjectMemoryStore', () => {
  it('does not create .agent on read', async () => {
    const root = await workspace()
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    await expect(store.read(root)).resolves.toMatchObject({ revision: 0, exists: false, content: '' })
    await expect(readFile(join(root, '.agent', 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes canonically and increments only on an effective change', async () => {
    const root = await workspace()
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    const first = await store.update(root, { baseRevision: 0, content: '# Facts\n' })
    expect(first.status).toBe('updated')
    expect(first.memory.revision).toBe(1)

    const second = await store.update(root, { baseRevision: 1, content: '# Facts\r\n\r\n' })
    expect(second.status).toBe('unchanged')
    expect(second.memory.revision).toBe(1)
    expect(await readFile(join(root, '.agent', 'MEMORY.md'), 'utf8'))
      .toBe('---\nformat: 1\nrevision: 1\n---\n\n# Facts\n')
  })

  it('upgrades a legacy file on first update', async () => {
    const root = await workspace()
    await mkdir(join(root, '.agent'))
    await writeFile(join(root, '.agent', 'MEMORY.md'), '# Legacy\n')
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    const result = await store.update(root, { baseRevision: 0, content: '# Legacy\n' })
    expect(result.status).toBe('updated')
    expect(result.memory.revision).toBe(1)
    expect(result.memory.legacy).toBe(false)
  })

  it('serializes concurrent writers with revision conflicts', async () => {
    const root = await workspace()
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    const results = await Promise.all([
      store.update(root, { baseRevision: 0, content: '# Writer A\n' }),
      store.update(root, { baseRevision: 0, content: '# Writer B\n' }),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['conflict', 'updated'])
    expect((await store.read(root)).revision).toBe(1)
  })

  it('rejects an escaping .agent symlink when the platform permits creating one', async () => {
    const root = await workspace()
    const outside = await workspace()
    const { symlink } = await import('node:fs/promises')
    try {
      await symlink(outside, join(root, '.agent'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES'].includes(String(error.code))) return
      throw error
    }
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    await expect(store.read(root)).rejects.toThrow(/must not be a symbolic link/)
  })
})
