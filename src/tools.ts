import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ProjectMemoryError } from './errors.js'
import type { ProjectMemoryStore } from './memory-store.js'
import type { SnapshotManager } from './snapshot-manager.js'

function requireAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) {
    throw new ProjectMemoryError('AGENT_REQUIRED', 'Project Memory tools can only be called by a live agent.')
  }
  return exec.agent
}

function text(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const nullableInteger = {
  oneOf: [
    { type: 'integer' as const },
    { type: 'null' as const },
  ],
} as const

export function registerMemoryTools(
  ctx: Context,
  store: ProjectMemoryStore,
  snapshots: SnapshotManager,
): void {
  ctx.tools.register(defineTool({
    name: 'project_memory_read',
    description: 'Read the latest persistent Project Memory from the current workspace without changing this session\'s fixed snapshot. Use before updating or when checking whether another session changed memory.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          persistent_revision: { type: 'integer' },
          snapshot_revision: nullableInteger,
          is_snapshot_stale: { type: 'boolean' },
          exists: { type: 'boolean' },
          legacy: { type: 'boolean' },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => text(value),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      const memory = await snapshots.readPersistent(agent, exec.signal)
      const snapshot = snapshots.get(agent)
      return {
        persistent_revision: memory.revision,
        snapshot_revision: snapshot?.revision ?? null,
        is_snapshot_stale: snapshot === undefined || snapshot.revision !== memory.revision,
        exists: memory.exists,
        legacy: memory.legacy,
        content: memory.content,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_update',
    description: 'The only write path for this workspace\'s persistent Project Memory: it creates the file as well as maintaining it. Submit base_revision from the latest project_memory_read (0 when no memory exists yet) plus the complete Markdown body — the current project profile, not a changelog or a session summary. Preserve what is still useful, rewrite or delete what is stale, stay concise. Updating persistent memory does not change this session\'s snapshot.',
    parameters: {
      base_revision: {
        type: 'integer',
        required: true,
        description: 'Revision returned by the latest project_memory_read call; use 0 when this workspace has no Project Memory yet, which is how the first write creates it.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Complete Markdown body to write — the whole profile, not a patch or a single section, and without revision frontmatter.',
      },
      reason: {
        type: 'string',
        description: 'Short explanation for diagnostics; not stored in MEMORY.md.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['updated', 'unchanged', 'conflict'] },
          previous_revision: { type: 'integer' },
          persistent_revision: { type: 'integer' },
          snapshot_revision: nullableInteger,
          content: { type: 'string' },
        },
      },
      render: (_args, value) => text(value),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspaceRoot = agent.session.header.cwd
      if (workspaceRoot === undefined) {
        throw new ProjectMemoryError('WORKSPACE_REQUIRED', 'Project Memory tools require a session workspace cwd.')
      }
      const result = await store.update(workspaceRoot, {
        baseRevision: args.base_revision,
        content: args.content,
        ...(args.reason === undefined ? {} : { reason: args.reason }),
      }, exec.signal)
      return {
        status: result.status,
        previous_revision: result.previousRevision,
        persistent_revision: result.memory.revision,
        snapshot_revision: snapshots.get(agent)?.revision ?? null,
        content: result.memory.content,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_refresh',
    description: 'Replace this session\'s fixed Project Memory snapshot with the latest persistent memory. The refreshed snapshot is used by the next model step.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          previous_revision: nullableInteger,
          snapshot_revision: { type: 'integer' },
          changed: { type: 'boolean' },
          content: { type: 'string' },
        },
      },
      render: (_args, value) => text(value),
    },
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      const previous = snapshots.get(agent)
      const snapshot = await snapshots.refresh(agent, exec.signal)
      return {
        previous_revision: previous?.revision ?? null,
        snapshot_revision: snapshot.revision,
        changed: previous === undefined || previous.revision !== snapshot.revision || previous.content !== snapshot.content,
        content: snapshot.content,
      }
    },
  }))
}
