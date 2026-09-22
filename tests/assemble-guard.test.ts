import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { PROJECT_MEMORY_SECTION } from '../src/prompt-provider.js'

interface Harness {
  ctx: Context
  warnings: string[]
  assemble: (agent: unknown, signal?: AbortSignal) => Promise<PromptAssembly>
}

function harness(): Harness {
  const listeners: Array<(assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly>> = []
  const warnings: string[] = []
  const ctx = {
    tools: { register: () => () => undefined },
    systemPrompt: {},
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } },
    on(event: string, handler: never) {
      if (event === 'system-prompt/assemble') listeners.push(handler)
      return () => undefined
    },
  } as unknown as Context

  apply(ctx, {})

  const base: PromptAssembly = {
    sections: [
      { name: 'harness:identity', text: 'identity' },
      { name: 'deployment:persona-suffix', text: 'suffix' },
    ],
    contexts: [],
    tools: [],
    variables: {},
  }
  const listener = listeners[0]
  if (listener === undefined) throw new Error('plugin registered no assembly listener')

  return {
    ctx,
    warnings,
    assemble: (agent, signal) => listener(base, { agent, ...(signal === undefined ? {} : { signal }) }, async () => base),
  }
}

function agentFor(cwd: string | undefined): Agent {
  return {
    session: {
      header: cwd === undefined ? {} : { cwd },
      firstLiveSeq: 0,
      surface: { replaceGeneration: 0 },
    },
  } as unknown as Agent
}

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-guard-'))
  roots.push(root)
  return root
}

async function withMemoryFile(root: string, text: string): Promise<void> {
  await mkdir(join(root, '.agent'), { recursive: true })
  await writeFile(join(root, '.agent', 'MEMORY.md'), text)
}

function sectionNames(assembly: PromptAssembly): string[] {
  return assembly.sections.map(section => section.name)
}

function memorySection(assembly: PromptAssembly) {
  return assembly.sections.find(entry => entry.name === PROJECT_MEMORY_SECTION)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('assembly degradation', () => {
  it('injects a healthy snapshot', async () => {
    const root = await workspace()
    await withMemoryFile(root, '---\nformat: 1\nrevision: 3\n---\n\n# Project\n\nUses pnpm.\n')
    const { assemble } = harness()

    const assembly = await assemble(agentFor(root))
    const section = memorySection(assembly)
    expect(section?.text).toContain('<PROJECT_MEMORY revision="3">')
    expect(sectionNames(assembly)).toEqual([
      'harness:identity',
      PROJECT_MEMORY_SECTION,
      'deployment:persona-suffix',
    ])
  })

  // Regression: a workspace with no memory yet is the first session, and the
  // first session is the only one that can bootstrap the file. It must still
  // receive the policy, or Project Memory is invisible exactly when it matters.
  it('injects the policy with bootstrap guidance on a workspace with no memory', async () => {
    const root = await workspace()
    const { assemble, warnings } = harness()

    const assembly = await assemble(agentFor(root))
    const section = memorySection(assembly)
    expect(sectionNames(assembly)).toEqual([
      'harness:identity',
      PROJECT_MEMORY_SECTION,
      'deployment:persona-suffix',
    ])
    expect(section?.text).toContain('<PROJECT_MEMORY_POLICY>')
    expect(section?.text).toContain('first session')
    expect(section?.text).toContain('project_memory_write')
    expect(section?.text).not.toContain('<PROJECT_MEMORY revision')
    expect(warnings).toEqual([])
  })

  // No snapshot can be produced here, so nothing is injected: the policy text
  // would have to promise a workspace the plugin could not confirm. These stay
  // visible as logged warnings instead.
  it('degrades to no memory when a session has no workspace cwd', async () => {
    const { assemble, warnings } = harness()
    const assembly = await assemble(agentFor(undefined))

    expect(sectionNames(assembly)).toEqual(['harness:identity', 'deployment:persona-suffix'])
    expect(warnings.join('\n')).toContain('skipped memory injection')
  })

  it('degrades to no memory when the workspace does not exist', async () => {
    const root = await workspace()
    const { assemble, warnings } = harness()
    const assembly = await assemble(agentFor(join(root, 'missing')))

    expect(sectionNames(assembly)).not.toContain(PROJECT_MEMORY_SECTION)
    expect(warnings.join('\n')).toContain('skipped memory injection')
  })

  it('degrades to no memory when MEMORY.md metadata is unusable', async () => {
    const root = await workspace()
    await withMemoryFile(root, '---\nformat: 1\nrevision: 1\nrevision: 2\n---\n\nbody\n')
    const { assemble, warnings } = harness()

    const assembly = await assemble(agentFor(root))
    expect(sectionNames(assembly)).not.toContain(PROJECT_MEMORY_SECTION)
    expect(warnings.join('\n')).toContain('Duplicate Project Memory frontmatter key')
  })

  it('degrades to no memory when the format is unsupported', async () => {
    const root = await workspace()
    await withMemoryFile(root, '---\nformat: 2\nrevision: 1\n---\n\nbody\n')
    const { assemble } = harness()

    const assembly = await assemble(agentFor(root))
    expect(sectionNames(assembly)).not.toContain(PROJECT_MEMORY_SECTION)
  })

  it('degrades to no memory when the body exceeds the configured limit', async () => {
    const root = await workspace()
    await withMemoryFile(root, `---\nformat: 1\nrevision: 1\n---\n\n${'x'.repeat(200 * 1024)}\n`)
    const { assemble } = harness()

    const assembly = await assemble(agentFor(root))
    expect(sectionNames(assembly)).not.toContain(PROJECT_MEMORY_SECTION)
  })

  it('degrades to no memory when MEMORY.md is a directory', async () => {
    const root = await workspace()
    await mkdir(join(root, '.agent', 'MEMORY.md'), { recursive: true })
    const { assemble } = harness()

    const assembly = await assemble(agentFor(root))
    expect(sectionNames(assembly)).not.toContain(PROJECT_MEMORY_SECTION)
  })

  it('still propagates an aborted assembly request', async () => {
    const root = await workspace()
    const { assemble } = harness()
    const controller = new AbortController()
    controller.abort(new Error('caller aborted'))

    await expect(assemble(agentFor(root), controller.signal)).rejects.toThrow('caller aborted')
  })

  it('ignores assemblies that belong to no agent', async () => {
    const { assemble } = harness()
    const assembly = await assemble(undefined)

    expect(sectionNames(assembly)).toEqual(['harness:identity', 'deployment:persona-suffix'])
  })
})
