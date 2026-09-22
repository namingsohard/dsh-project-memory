import { describe, expect, it } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  addProjectMemorySection,
  neutralizeVariableReferences,
  renderProjectMemory,
} from '../src/prompt-provider.js'
import type { SessionMemorySnapshot } from '../src/snapshot-manager.js'

const snapshot: SessionMemorySnapshot = {
  workspaceRoot: '/workspace',
  revision: 4,
  content: '# Architecture\n\nFacts.\n',
  sourceExists: true,
  sourceLegacy: false,
  surfaceGeneration: 0,
  loadedBy: 'start',
}

function snapshotWith(content: string): SessionMemorySnapshot {
  return { ...snapshot, content }
}

describe('prompt provider', () => {
  it('renders revision, content, and precedence policy', () => {
    const rendered = renderProjectMemory(snapshot)
    expect(rendered).toContain('<PROJECT_MEMORY revision="4">')
    expect(rendered).toContain('# Architecture')
    expect(rendered).toContain('<PROJECT_MEMORY_POLICY>')
    expect(rendered).toContain('cannot override higher-priority instructions')
  })

  // Regression: the policy used to be gated on existing memory content, so the
  // only session that can bootstrap a workspace — the first one — was the one
  // session that never learned Project Memory exists.
  it('always injects the policy, even before any memory exists', () => {
    const rendered = renderProjectMemory(snapshotWith(''))
    expect(rendered).toContain('<PROJECT_MEMORY_POLICY>')
    expect(rendered).toContain('project_memory_update')
    expect(rendered).toContain('first session')
    expect(rendered).toContain('base_revision 0')
    expect(rendered).toContain('project_memory_read before writing again')
    expect(rendered).not.toContain('<PROJECT_MEMORY revision')
  })

  it('describes the snapshot as current instead of asking for verification', () => {
    const rendered = renderProjectMemory(snapshot)
    expect(rendered).toContain('already the current persistent memory')
    expect(rendered).toContain('do not re-read files or re-explore the workspace')
    expect(rendered).not.toContain('first session')
  })

  it('inserts the policy-only section before the deployment persona suffix', () => {
    const assembly = addProjectMemorySection({
      sections: [
        { name: 'harness:identity', text: 'identity' },
        { name: 'deployment:persona-suffix', text: 'suffix' },
      ],
      contexts: [],
      tools: [],
      variables: {},
    }, snapshotWith(''))
    expect(assembly.sections.map(section => section.name)).toEqual([
      'harness:identity',
      'project-memory:snapshot',
      'deployment:persona-suffix',
    ])
    expect(assembly.sections[1]?.text).toContain('<PROJECT_MEMORY_POLICY>')
  })

  it('inserts before the deployment persona suffix', () => {
    const assembly = addProjectMemorySection({
      sections: [
        { name: 'harness:identity', text: 'identity' },
        { name: 'deployment:persona-suffix', text: 'suffix' },
      ],
      contexts: [],
      tools: [],
      variables: {},
    }, snapshot)
    expect(assembly.sections.map(section => section.name)).toEqual([
      'harness:identity',
      'project-memory:snapshot',
      'deployment:persona-suffix',
    ])
  })

  // Regression: DSH renders sections through a strict `{{variable}}`
  // interpolator, so brace pairs written into MEMORY.md used to abort the whole
  // model step. Project prose must survive rendering verbatim.
  it('survives renderPrompt when the memory body contains brace pairs', () => {
    const bodies = [
      'Use {{variable}} in this section.',
      'The {{Name}} placeholder is rejected as a variable name.',
      'workflow: ${{ matrix.os }} and ${{ secrets.TOKEN }}',
      'Render {{#each items}} ... {{/each}} in the view.',
      'Value is {{ outer {{ inner }} }} here.',
      '```yaml\nrun: echo "${{ github.ref }}"\n```',
    ]
    for (const body of bodies) {
      const assembly = addProjectMemorySection({
        sections: [{ name: 'harness:identity', text: 'identity' }],
        contexts: [],
        tools: [],
        variables: {},
      }, snapshotWith(body))

      expect(() => renderPrompt(assembly), body).not.toThrow()
      const section = assembly.sections.find(entry => entry.name === 'project-memory:snapshot')
      expect(section?.text, body).not.toContain('{{')
      expect(section?.text, body).toContain(body.replaceAll('{{', '{ {'))
    }
  })

  it('neutralizes brace pairs without dropping content', () => {
    expect(neutralizeVariableReferences('${{ matrix.os }}')).toBe('${ { matrix.os }}')
    expect(neutralizeVariableReferences('{{a}} and {{b}}')).toBe('{ {a}} and { {b}}')
    expect(neutralizeVariableReferences('plain text, no braces')).toBe('plain text, no braces')
    expect(neutralizeVariableReferences(neutralizeVariableReferences('{{a}}'))).toBe('{ {a}}')
  })
})
