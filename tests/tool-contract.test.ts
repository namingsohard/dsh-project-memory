import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.js'
import { ProjectMemoryStore } from '../src/memory-store.js'
import { SnapshotManager } from '../src/snapshot-manager.js'
import { registerMemoryTools } from '../src/tools.js'

interface PropertySchema {
  type?: string
  description?: string
}

interface ToolDef {
  name: string
  description: string
  parameters: { properties?: Record<string, PropertySchema> }
}

function property(name: string, key: string): PropertySchema | undefined {
  return registered().get(name)?.parameters.properties?.[key]
}

function registered(): Map<string, ToolDef> {
  const tools = new Map<string, ToolDef>()
  const ctx = {
    tools: {
      register: (def: ToolDef) => {
        tools.set(def.name, def)
        return () => undefined
      },
    },
  } as unknown as Context
  const store = new ProjectMemoryStore(DEFAULT_CONFIG)
  registerMemoryTools(ctx, store, new SnapshotManager(store))
  return tools
}

// Regression: `project_memory_write` is also the create path, but its
// model-visible description only spoke of replacing and preserving an existing
// body. A model holding an empty workspace found no tool telling it that this is
// the tool that creates the file, so the first revision never got written.
describe('tool contract', () => {
  it('registers all three tools', () => {
    expect([...registered().keys()].sort()).toEqual([
      'project_memory_read',
      'project_memory_refresh',
      'project_memory_write',
    ])
  })

  it('names creation in the update description', () => {
    const description = registered().get('project_memory_write')?.description ?? ''
    expect(description).toContain('only write path')
    expect(description).toContain('the tool that creates it')
    expect(description).toContain('base_revision 0 writes a workspace\'s first revision')
  })

  // Regression: the description used to invite an update whenever a session had
  // learned anything at all, which is how a current profile turns into an
  // append-only log. The bar and the "otherwise leave it alone" clause are the
  // constraint that keeps a session from writing on every pass.
  it('states when the write tool is worth calling', () => {
    const description = registered().get('project_memory_write')?.description ?? ''
    expect(description).toContain('Call it only when the session established durable, project-level knowledge')
    expect(description).toContain('otherwise leave the file alone')
  })

  it('keeps the current-profile and snapshot rules in the update description', () => {
    const description = registered().get('project_memory_write')?.description ?? ''
    expect(description).toContain('one current page with stale entries rewritten or deleted')
    expect(description).toContain('does not change this session')
  })

  it('tells the model base_revision 0 creates the first revision', () => {
    const description = property('project_memory_write', 'base_revision')?.description
    expect(description).toContain('0')
    expect(description).toContain('creates')
  })

  // The gate can hold a growing write for approval, and the description is where
  // the model decides how to react. It lives here rather than in the injected
  // policy on purpose: the policy is already in context on every request, so a
  // second copy of the same paragraph is paid for in every session's prompt.
  it('tells the model what a rejected write means', () => {
    const description = registered().get('project_memory_write')?.description ?? ''
    expect(description).toContain('unfit for retention or overly lengthy')
    expect(description).toContain('shorten and resubmit')
  })

  // Regression: the rejection instruction used to end in "otherwise, do not
  // rework for resubmission" — no object, no time bound. The tool takes the
  // whole body, so every later write is textually a superset of a rejected one,
  // and an unbounded clause reads as a ban on the rest of the session: a
  // workspace that genuinely changes after a rejection (a new directory, a
  // renamed command) never got its correction written. The verdict is now named
  // as one on the submitted body, in the same sentence that carries the
  // back-door rule the open-ended clause had been holding up.
  it('bounds a rejection to the body it judged', () => {
    const description = registered().get('project_memory_write')?.description ?? ''
    expect(description).toContain('That verdict is on the body you submitted, not on this session')
    expect(description).toContain('a new fact that qualifies still gets written')
    expect(description).toContain('Never trim an addition merely to stay under the approval budget')
    expect(description).not.toContain('do not rework for resubmission')
  })

  it('asks for the whole body rather than a patch', () => {
    const description = property('project_memory_write', 'content')?.description
    expect(description).toContain('the whole profile as it should read now')
    expect(description).toContain('without revision frontmatter')
  })
})
