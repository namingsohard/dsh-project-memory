import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  approvalChannelAsks,
  approvalReason,
  assessMemoryUpdate,
  isChildSession,
  MEMORY_WRITE_TOOL,
  preflightSkip,
} from '../src/approval-gate.js'
import { DEFAULT_CONFIG, type Config } from '../src/config.js'
import { apply } from '../src/index.js'
import { serializeMemoryFile } from '../src/memory-format.js'

const config: Config = { ...DEFAULT_CONFIG }

/** The exact byte count `assessGrowth` compares against: floor(48 KiB * 80%). */
const WATERMARK_BYTES = Math.floor(config.maxMemoryBytes * config.approvalWatermarkPercent / 100)

/** A body whose normalized UTF-8 length is exactly `bytes`. */
function bodyOf(bytes: number): string {
  return `${'x'.repeat(Math.max(bytes - 1, 0))}\n`
}

function agentFor(header: { cwd?: string; origin?: 'subagent'; delegationDepth?: number } = {}): Agent {
  return {
    session: {
      header: {
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
        ...(header.origin === undefined ? {} : { origin: header.origin }),
        ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
      },
      firstLiveSeq: 0,
      surface: { replaceGeneration: 0 },
    },
  } as unknown as Agent
}

function assess(overrides: Partial<Parameters<typeof assessMemoryUpdate>[0]> = {}) {
  return assessMemoryUpdate({
    config,
    agent: agentFor({ cwd: 'C:/workspace' }),
    channelAsks: true,
    storedContent: bodyOf(2 * 1024),
    nextContent: bodyOf(2.5 * 1024),
    note: undefined,
    ...overrides,
  })
}

// The gate exists because a profile that only ever grows stops being a profile.
// Each branch below is one of the promises the plugin's README makes, so the
// names mirror the prose rather than the implementation.
describe('approval gate assessment', () => {
  it('never gates the write that creates the profile', () => {
    expect(assess({ storedContent: undefined })).toEqual({ kind: 'allow', cause: 'first-write' })
  })

  it('never gates a rewrite that does not grow the profile', () => {
    expect(assess({ storedContent: bodyOf(8 * 1024), nextContent: bodyOf(4 * 1024) }))
      .toEqual({ kind: 'allow', cause: 'not-growing' })
  })

  it('treats an identical body as no growth', () => {
    expect(assess({ storedContent: bodyOf(3 * 1024), nextContent: bodyOf(3 * 1024) }))
      .toEqual({ kind: 'allow', cause: 'not-growing' })
  })

  it('compares normalized bodies, not raw arguments', () => {
    // CRLF would count as extra bytes if the gate measured the raw argument;
    // `normalizeMemoryContent` is what the store actually writes.
    const stored = bodyOf(2 * 1024)
    expect(assess({ storedContent: stored, nextContent: stored.replace(/\n$/, '\r\n') }))
      .toEqual({ kind: 'allow', cause: 'not-growing' })
  })

  it('lets growth within both budgets through', () => {
    expect(assess({ storedContent: bodyOf(2 * 1024), nextContent: bodyOf(2 * 1024 + 512) }))
      .toEqual({ kind: 'allow', cause: 'within-budget' })
  })

  it('lets growth up to the growth budget through', () => {
    expect(assess({
      storedContent: bodyOf(2 * 1024),
      nextContent: bodyOf(2 * 1024 + config.approvalGrowthBytes),
    })).toEqual({ kind: 'allow', cause: 'within-budget' })
  })

  it('asks when growth exceeds the growth budget', () => {
    const verdict = assess({
      storedContent: bodyOf(2 * 1024),
      nextContent: bodyOf(2 * 1024 + config.approvalGrowthBytes + 1),
    })
    expect(verdict.kind).toBe('ask')
    expect(verdict.kind === 'ask' ? verdict.reason : '').toContain('over the 1 KB silent-growth budget')
  })

  it('asks when a small growth crosses the watermark', () => {
    const verdict = assess({ storedContent: bodyOf(WATERMARK_BYTES - 100), nextContent: bodyOf(WATERMARK_BYTES + 1) })
    expect(verdict.kind).toBe('ask')
    expect(verdict.kind === 'ask' ? verdict.reason : '').toContain('past the 80% watermark')
  })

  it('does not ask when the result lands exactly on the watermark', () => {
    expect(assess({ storedContent: bodyOf(WATERMARK_BYTES - 100), nextContent: bodyOf(WATERMARK_BYTES) }))
      .toEqual({ kind: 'allow', cause: 'within-budget' })
  })

  it('names both triggers when both fire', () => {
    const verdict = assess({
      storedContent: bodyOf(WATERMARK_BYTES),
      nextContent: bodyOf(WATERMARK_BYTES + 8 * 1024),
    })
    expect(verdict.kind === 'ask' ? verdict.reason : '')
      .toContain('silent-growth budget and past the 80% watermark')
  })

  it('does not gate an unmeasurable body, because the tool owns content rejection', () => {
    expect(assess({ nextContent: 'has a \0 nul byte' })).toEqual({ kind: 'allow', cause: 'undecidable' })
  })

  it('honours the disable switch before it reads anything', () => {
    expect(assess({
      config: { ...config, requireApproval: false },
      storedContent: bodyOf(2 * 1024),
      nextContent: bodyOf(40 * 1024),
    })).toEqual({ kind: 'allow', cause: 'approval-disabled' })
  })

  it('never gates agentless calls', () => {
    expect(preflightSkip(config, undefined, true)).toBe('no-agent')
  })

  it('never gates child sessions, whose asks may not be routable', () => {
    const origin = agentFor({ cwd: 'C:/workspace', origin: 'subagent' })
    const depth = agentFor({ cwd: 'C:/workspace', delegationDepth: 1 })
    expect(isChildSession(origin)).toBe(true)
    expect(isChildSession(depth)).toBe(true)
    expect(isChildSession(agentFor({ cwd: 'C:/workspace' }))).toBe(false)
    expect(assess({
      agent: origin,
      storedContent: bodyOf(2 * 1024),
      nextContent: bodyOf(40 * 1024),
    })).toEqual({ kind: 'allow', cause: 'child-session' })
  })
})

describe('approval channel probe', () => {
  function hostWith(service: unknown) {
    return { get: (name: string) => (name === 'approval' ? service : undefined) }
  }

  it('asks when the composed channel reports the ask policy', () => {
    expect(approvalChannelAsks(hostWith({ effectivePolicy: () => 'ask' }), agentFor())).toBe(true)
  })

  it('stays out of the way when the session policy is never', () => {
    expect(approvalChannelAsks(hostWith({ effectivePolicy: () => 'never' }), agentFor())).toBe(false)
  })

  it('stays out of the way when no approval service is composed', () => {
    expect(approvalChannelAsks(hostWith(undefined), agentFor())).toBe(false)
    expect(approvalChannelAsks(hostWith(null), agentFor())).toBe(false)
  })

  it('assumes an unknown implementation can ask', () => {
    expect(approvalChannelAsks(hostWith({}), agentFor())).toBe(true)
    expect(approvalChannelAsks(hostWith({ effectivePolicy: () => { throw new Error('boom') } }), agentFor())).toBe(true)
  })
})

describe('approval reason', () => {
  it('carries the sizes a person needs to decide', () => {
    const reason = approvalReason({
      currentBytes: 2 * 1024,
      nextBytes: 4 * 1024,
      growth: 2 * 1024,
      limitBytes: 48 * 1024,
      budgetBytes: 1024,
      watermarkPercent: 80,
      overGrowthBudget: true,
      overWatermark: false,
      note: undefined,
    })
    expect(reason).toBe('Rewrite this workspace\'s Project Memory: 2 KB of 48 KB, this update adds 2 KB (over the 1 KB silent-growth budget). Approve?')
  })

  it('quotes the model note as a claim inside the sentence', () => {
    const reason = approvalReason({
      currentBytes: 1024,
      nextBytes: 3 * 1024,
      growth: 2 * 1024,
      limitBytes: 48 * 1024,
      budgetBytes: 1024,
      watermarkPercent: 80,
      overGrowthBudget: true,
      overWatermark: false,
      note: 'line one\nline two "quoted"',
    })
    expect(reason).toContain('Model\'s note: "line one line two \'quoted\'".')
    expect(reason).not.toContain('\n')
    expect(reason.endsWith('Approve?')).toBe(true)
  })

  it('truncates a note long enough to bury the decision', () => {
    const reason = approvalReason({
      currentBytes: 1024,
      nextBytes: 3 * 1024,
      growth: 2 * 1024,
      limitBytes: 48 * 1024,
      budgetBytes: 1024,
      watermarkPercent: 80,
      overGrowthBudget: true,
      overWatermark: false,
      note: 'y'.repeat(300),
    })
    expect(reason).toContain(`"${'y'.repeat(157)}..."`)
  })

  it('drops an empty note instead of printing empty quotes', () => {
    const reason = approvalReason({
      currentBytes: 1024,
      nextBytes: 3 * 1024,
      growth: 2 * 1024,
      limitBytes: 48 * 1024,
      budgetBytes: 1024,
      watermarkPercent: 80,
      overGrowthBudget: true,
      overWatermark: false,
      note: '   \n  ',
    })
    expect(reason).not.toContain('Model\'s note')
  })
})

// ---- the listener as the harness drives it -------------------------------
interface Harness {
  run: (exec: Record<string, unknown>) => Promise<{ decision: PreToolDecision; dispatched: boolean }>
  warnings: string[]
}

function harness(options: { config?: Partial<Config>; approval?: unknown } = {}): Harness {
  const listeners = new Map<string, Array<(exec: unknown, next: () => Promise<unknown>) => Promise<unknown>>>()
  const warnings: string[] = []
  const services = new Map<string, unknown>()
  if ('approval' in options) services.set('approval', options.approval)

  const ctx = {
    tools: { register: () => () => undefined },
    systemPrompt: {},
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } },
    get: (name: string) => services.get(name),
    on(event: string, handler: never) {
      const list = listeners.get(event) ?? []
      list.push(handler as never)
      listeners.set(event, list)
      return () => undefined
    },
  } as unknown as Context

  apply(ctx, options.config ?? {})

  const listener = listeners.get('tools/pre-execute')?.[0]
  if (listener === undefined) throw new Error('plugin registered no pre-execute listener')

  return {
    warnings,
    async run(exec) {
      let dispatched = false
      const decision = await listener(exec, async () => {
        dispatched = true
        return { kind: 'allow' }
      }) as PreToolDecision
      return { decision, dispatched }
    },
  }
}

function execFor(name: string, args: unknown, agent: Agent): Record<string, unknown> {
  return {
    callId: 'c1',
    rootCallId: 'c1',
    name,
    arguments: args,
    agent,
    token: Symbol('token'),
    signal: new AbortController().signal,
  }
}

const roots: string[] = []

async function emptyWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-approval-'))
  roots.push(root)
  return root
}

async function workspaceWithMemory(body: string): Promise<string> {
  const root = await emptyWorkspace()
  await mkdir(join(root, '.agent'), { recursive: true })
  await writeFile(join(root, '.agent', 'MEMORY.md'), serializeMemoryFile(1, body))
  return root
}

const askChannel = { effectivePolicy: () => 'ask' }

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('pre-execute listener', () => {
  it('leaves every other tool call untouched', async () => {
    const { run } = harness({ approval: askChannel })
    const result = await run(execFor('project_memory_read', {}, agentFor({ cwd: 'C:/workspace' })))
    expect(result.dispatched).toBe(true)
  })

  it('lets the first write through without asking', async () => {
    const root = await emptyWorkspace()
    const { run } = harness({ approval: askChannel })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 0, content: bodyOf(40 * 1024) }, agentFor({ cwd: root })))
    expect(result.dispatched).toBe(true)
  })

  it('lets a shrinking rewrite through without asking', async () => {
    const root = await workspaceWithMemory(bodyOf(8 * 1024))
    const { run } = harness({ approval: askChannel })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(4 * 1024) }, agentFor({ cwd: root })))
    expect(result.dispatched).toBe(true)
  })

  it('asks before a growing rewrite, and does not dispatch it', async () => {
    const root = await workspaceWithMemory(bodyOf(2 * 1024))
    const { run } = harness({ approval: askChannel })
    const result = await run(execFor(MEMORY_WRITE_TOOL, {
      base_revision: 1,
      content: bodyOf(8 * 1024),
      reason: 'recorded the release checklist',
    }, agentFor({ cwd: root })))

    expect(result.dispatched).toBe(false)
    expect(result.decision).toEqual({
      kind: 'ask',
      reason: expect.stringContaining('this update adds 6 KB'),
    })
    expect(result.decision.kind === 'ask' ? result.decision.reason : '')
      .toContain('Model\'s note: "recorded the release checklist".')
  })

  it('does not gate a child session that would otherwise ask', async () => {
    const root = await workspaceWithMemory(bodyOf(2 * 1024))
    const { run } = harness({ approval: askChannel })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(40 * 1024) }, agentFor({ cwd: root, origin: 'subagent' })))
    expect(result.dispatched).toBe(true)
  })

  it('does not gate when the plugin config disables approval', async () => {
    const root = await workspaceWithMemory(bodyOf(2 * 1024))
    const { run } = harness({ approval: askChannel, config: { requireApproval: false } })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(40 * 1024) }, agentFor({ cwd: root })))
    expect(result.dispatched).toBe(true)
  })

  it('does not gate when the session policy is never', async () => {
    const root = await workspaceWithMemory(bodyOf(2 * 1024))
    const { run } = harness({ approval: { effectivePolicy: () => 'never' } })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(40 * 1024) }, agentFor({ cwd: root })))
    expect(result.dispatched).toBe(true)
  })

  it('does not gate when no approval service is composed', async () => {
    const root = await workspaceWithMemory(bodyOf(2 * 1024))
    const { run } = harness()
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(40 * 1024) }, agentFor({ cwd: root })))
    expect(result.dispatched).toBe(true)
  })

  it('degrades to dispatching when the stored profile cannot be read', async () => {
    const root = await emptyWorkspace()
    await mkdir(join(root, '.agent', 'MEMORY.md'), { recursive: true })
    const { run, warnings } = harness({ approval: askChannel })
    const result = await run(execFor(MEMORY_WRITE_TOOL, { base_revision: 1, content: bodyOf(40 * 1024) }, agentFor({ cwd: root })))

    expect(result.dispatched).toBe(true)
    expect(warnings.join('\n')).toContain('skipping approval gate')
  })
})
