import { randomUUID } from 'node:crypto'
import { open, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises'
import type { Config } from './config.js'
import { isNodeError, ProjectMemoryError } from './errors.js'
import { MEMORY_FORMAT_VERSION, normalizeMemoryContent, parseMemoryFile, serializeMemoryFile } from './memory-format.js'
import { assertSafeMemoryFile, resolveMemoryPaths, type MemoryPaths } from './path-policy.js'

export interface PersistentMemory {
  workspaceRoot: string
  revision: number
  content: string
  exists: boolean
  legacy: boolean
  format: typeof MEMORY_FORMAT_VERSION
}

export interface MemoryUpdateRequest {
  baseRevision: number
  content: string
  reason?: string
}

export type MemoryUpdateResult =
  | { status: 'updated'; previousRevision: number; memory: PersistentMemory }
  | { status: 'unchanged'; previousRevision: number; memory: PersistentMemory }
  | { status: 'conflict'; previousRevision: number; memory: PersistentMemory }

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Operation aborted.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
  })
}

export class ProjectMemoryStore {
  readonly config: Config

  constructor(config: Config) {
    this.config = config
  }

  async read(workspaceRoot: string, signal?: AbortSignal): Promise<PersistentMemory> {
    throwIfAborted(signal)
    const paths = await resolveMemoryPaths(workspaceRoot, false)
    throwIfAborted(signal)
    if (paths === undefined) {
      return {
        workspaceRoot: await resolveWorkspaceRootForMissingAgentDirectory(workspaceRoot),
        revision: 0,
        content: '',
        exists: false,
        legacy: false,
        format: MEMORY_FORMAT_VERSION,
      }
    }
    return this.readAt(paths, signal)
  }

  async update(
    workspaceRoot: string,
    request: MemoryUpdateRequest,
    signal?: AbortSignal,
  ): Promise<MemoryUpdateResult> {
    if (!Number.isSafeInteger(request.baseRevision) || request.baseRevision < 0) {
      throw new ProjectMemoryError('INVALID_REVISION', 'baseRevision must be a non-negative safe integer.')
    }
    const content = normalizeMemoryContent(request.content)
    this.assertContentSize(content)
    const paths = await resolveMemoryPaths(workspaceRoot, true)
    if (paths === undefined) throw new Error('unreachable: createAgentDirectory must return paths')

    return this.withLock(paths, signal, async () => {
      const current = await this.readAt(paths, signal)
      if (request.baseRevision !== current.revision) {
        return { status: 'conflict', previousRevision: current.revision, memory: current }
      }
      if (content === current.content && !current.legacy) {
        return { status: 'unchanged', previousRevision: current.revision, memory: current }
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw new ProjectMemoryError('REVISION_EXHAUSTED', 'Project Memory revision cannot be incremented safely.')
      }

      const nextRevision = current.revision + 1
      await this.writeAtomic(paths, serializeMemoryFile(nextRevision, content), signal)
      return {
        status: 'updated',
        previousRevision: current.revision,
        memory: {
          workspaceRoot: paths.workspaceRoot,
          revision: nextRevision,
          content,
          exists: true,
          legacy: false,
          format: MEMORY_FORMAT_VERSION,
        },
      }
    })
  }

  private async readAt(paths: MemoryPaths, signal?: AbortSignal): Promise<PersistentMemory> {
    throwIfAborted(signal)
    const exists = await assertSafeMemoryFile(paths)
    if (!exists) {
      return {
        workspaceRoot: paths.workspaceRoot,
        revision: 0,
        content: '',
        exists: false,
        legacy: false,
        format: MEMORY_FORMAT_VERSION,
      }
    }

    const fileStat = await stat(paths.memoryFile)
    if (fileStat.size > this.config.maxMemoryBytes + 1024) {
      throw new ProjectMemoryError(
        'MEMORY_TOO_LARGE',
        `.agent/MEMORY.md is ${fileStat.size} bytes; the configured body limit is ${this.config.maxMemoryBytes} bytes.`,
      )
    }
    const parsed = parseMemoryFile(await readFile(paths.memoryFile, 'utf8'))
    this.assertContentSize(parsed.content)
    throwIfAborted(signal)
    return {
      workspaceRoot: paths.workspaceRoot,
      revision: parsed.revision,
      content: parsed.content,
      exists: true,
      legacy: parsed.legacy,
      format: MEMORY_FORMAT_VERSION,
    }
  }

  private assertContentSize(content: string): void {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > this.config.maxMemoryBytes) {
      throw new ProjectMemoryError(
        'MEMORY_TOO_LARGE',
        `Project Memory body is ${bytes} UTF-8 bytes; limit is ${this.config.maxMemoryBytes} bytes.`,
      )
    }
  }

  private async withLock<T>(
    paths: MemoryPaths,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now()
    let delay = 15
    while (true) {
      throwIfAborted(signal)
      try {
        const { mkdir } = await import('node:fs/promises')
        await mkdir(paths.lockDirectory)
        break
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error
        await this.recoverStaleLock(paths)
        if (Date.now() - started >= this.config.lockTimeoutMs) {
          throw new ProjectMemoryError('LOCK_TIMEOUT', 'Timed out waiting for the Project Memory write lock.')
        }
        await wait(delay, signal)
        delay = Math.min(delay * 2, 200)
      }
    }

    try {
      return await operation()
    } finally {
      try {
        await rmdir(paths.lockDirectory)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }
  }

  private async recoverStaleLock(paths: MemoryPaths): Promise<void> {
    try {
      const lockStat = await stat(paths.lockDirectory)
      if (Date.now() - lockStat.mtimeMs <= this.config.staleLockMs) return
      await rmdir(paths.lockDirectory)
    } catch (error) {
      if (!isNodeError(error, 'ENOENT') && !isNodeError(error, 'ENOTEMPTY')) throw error
    }
  }

  private async writeAtomic(paths: MemoryPaths, serialized: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const temporary = `${paths.memoryFile}.${process.pid}.${randomUUID()}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      throwIfAborted(signal)
      await rename(temporary, paths.memoryFile)
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}

async function resolveWorkspaceRootForMissingAgentDirectory(workspaceRoot: string): Promise<string> {
  const { resolveWorkspaceRoot } = await import('./path-policy.js')
  return resolveWorkspaceRoot(workspaceRoot)
}
