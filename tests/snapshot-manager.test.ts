import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.js'
import { ProjectMemoryStore } from '../src/memory-store.js'
import { SnapshotManager } from '../src/snapshot-manager.js'

const roots: string[] = []

async function makeAgent(): Promise<{ agent: Agent; generation: { value: number }; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-agent-'))
  roots.push(root)
  const generation = { value: 0 }
  const session = {
    header: { cwd: root },
    firstLiveSeq: 0,
    surface: {
      get replaceGeneration() { return generation.value },
    },
  }
  return { agent: { session } as unknown as Agent, generation, root }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('SnapshotManager', () => {
  it('keeps a snapshot fixed across persistent updates until refresh', async () => {
    const { agent, root } = await makeAgent()
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    await store.update(root, { baseRevision: 0, content: '# Revision one\n' })
    const snapshots = new SnapshotManager(store)
    expect((await snapshots.ensure(agent)).revision).toBe(1)

    await store.update(root, { baseRevision: 1, content: '# Revision two\n' })
    expect((await snapshots.ensure(agent)).revision).toBe(1)
    expect((await snapshots.refresh(agent)).revision).toBe(2)
  })

  it('refreshes at the next assembly boundary after a surface replacement', async () => {
    const { agent, generation, root } = await makeAgent()
    const store = new ProjectMemoryStore(DEFAULT_CONFIG)
    await store.update(root, { baseRevision: 0, content: '# Revision one\n' })
    const snapshots = new SnapshotManager(store)
    await snapshots.ensure(agent)
    await store.update(root, { baseRevision: 1, content: '# Revision two\n' })

    generation.value += 1
    const refreshed = await snapshots.ensure(agent)
    expect(refreshed.revision).toBe(2)
    expect(refreshed.loadedBy).toBe('surface-replacement')
  })
})
