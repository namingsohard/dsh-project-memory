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

// Regression: `project_memory_update` is also the create path, but its
// model-visible description only spoke of replacing and preserving an existing
// body. A model holding an empty workspace found no tool telling it that this is
// the tool that creates the file, so the first revision never got written.
describe('tool contract', () => {
  it('registers all three tools', () => {
    expect([...registered().keys()].sort()).toEqual([
      'project_memory_read',
      'project_memory_refresh',
      'project_memory_update',
    ])
  })

  it('names creation in the update description', () => {
    const description = registered().get('project_memory_update')?.description ?? ''
    expect(description).toContain('only write path')
    expect(description).toContain('creates the file as well as maintaining it')
    expect(description).toContain('0 when no memory exists yet')
  })

  it('keeps the anti-changelog and snapshot rules in the update description', () => {
    const description = registered().get('project_memory_update')?.description ?? ''
    expect(description).toContain('not a changelog')
    expect(description).toContain('does not change this session')
  })

  it('tells the model base_revision 0 creates the first revision', () => {
    const description = property('project_memory_update', 'base_revision')?.description
    expect(description).toContain('0')
    expect(description).toContain('creates')
  })

  it('asks for the whole body rather than a patch', () => {
    const description = property('project_memory_update', 'content')?.description
    expect(description).toContain('whole profile, not a patch')
    expect(description).toContain('without revision frontmatter')
  })
})
