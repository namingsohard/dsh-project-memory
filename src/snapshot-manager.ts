import type { Agent } from '@deepseek-ai/dsh-agent'
import { ProjectMemoryError } from './errors.js'
import type { PersistentMemory, ProjectMemoryStore } from './memory-store.js'

export type SnapshotLoadReason = 'start' | 'resume' | 'explicit-refresh' | 'surface-replacement'

export interface SessionMemorySnapshot {
  workspaceRoot: string
  revision: number
  content: string
  sourceExists: boolean
  sourceLegacy: boolean
  surfaceGeneration: number
  loadedBy: SnapshotLoadReason
}

function workspaceOf(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) {
    throw new ProjectMemoryError('WORKSPACE_REQUIRED', 'Project Memory tools require a session workspace cwd.')
  }
  return cwd
}

function snapshotFrom(
  memory: PersistentMemory,
  surfaceGeneration: number,
  loadedBy: SnapshotLoadReason,
): SessionMemorySnapshot {
  return {
    workspaceRoot: memory.workspaceRoot,
    revision: memory.revision,
    content: memory.content,
    sourceExists: memory.exists,
    sourceLegacy: memory.legacy,
    surfaceGeneration,
    loadedBy,
  }
}

export class SnapshotManager {
  private readonly snapshots = new WeakMap<Agent, SessionMemorySnapshot>()
  private readonly loads = new WeakMap<Agent, Promise<SessionMemorySnapshot>>()
  readonly store: ProjectMemoryStore

  constructor(store: ProjectMemoryStore) {
    this.store = store
  }

  get(agent: Agent): SessionMemorySnapshot | undefined {
    return this.snapshots.get(agent)
  }

  async ensure(agent: Agent, signal?: AbortSignal): Promise<SessionMemorySnapshot> {
    const current = this.snapshots.get(agent)
    const surfaceGeneration = agent.session.surface.replaceGeneration
    if (current !== undefined && current.surfaceGeneration === surfaceGeneration) return current
    const reason: SnapshotLoadReason = current !== undefined
      ? 'surface-replacement'
      : agent.session.firstLiveSeq > 0 ? 'resume' : 'start'
    return this.enqueueLoad(agent, reason, signal)
  }

  async refresh(agent: Agent, signal?: AbortSignal): Promise<SessionMemorySnapshot> {
    return this.enqueueLoad(agent, 'explicit-refresh', signal)
  }

  async readPersistent(agent: Agent, signal?: AbortSignal): Promise<PersistentMemory> {
    return this.store.read(workspaceOf(agent), signal)
  }

  private enqueueLoad(
    agent: Agent,
    loadedBy: SnapshotLoadReason,
    signal?: AbortSignal,
  ): Promise<SessionMemorySnapshot> {
    const prior = this.loads.get(agent)
    const task = (prior === undefined ? Promise.resolve() : prior.catch(() => undefined))
      .then(async () => {
        signal?.throwIfAborted()
        const memory = await this.store.read(workspaceOf(agent), signal)
        const snapshot = snapshotFrom(memory, agent.session.surface.replaceGeneration, loadedBy)
        this.snapshots.set(agent, snapshot)
        return snapshot
      })
    this.loads.set(agent, task)
    void task.finally(() => {
      if (this.loads.get(agent) === task) this.loads.delete(agent)
    }).catch(() => undefined)
    return task
  }
}
