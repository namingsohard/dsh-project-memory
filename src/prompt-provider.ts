import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { SessionMemorySnapshot } from './snapshot-manager.js'

export const PROJECT_MEMORY_SECTION = 'project-memory:snapshot'

const POLICY = `Project Memory (<workspace>/.agent/MEMORY.md) holds what stays true of this project between sessions and is worth a later session's context: what the project is and what it is for, how the repository is laid out and where its behavior lives, the conventions the code actually follows, the exact commands that build, test, run, and release it, and the constraints or contracts a change has to respect.

Its subject is always the project: an entry is a fact about this repository that stays true the next time someone works here, and that a newcomer would otherwise have to reconstruct from the code. Every line travels in every later session's context, so the file stays small and reads as one page.

The snapshot above, when present, is already the current persistent memory. Treat it as the trusted baseline: do not re-read files or re-explore the workspace merely to confirm what it says. Direct evidence you obtain naturally while working wins over it.

Record that knowledge with project_memory_write: submit base_revision from the most recent project_memory_read, or 0 when this workspace has no memory yet, which is what creates it. Include the complete maintained Markdown body, written as the current profile — merge, rewrite, and delete so the page keeps matching the project. Write when the profile has become wrong or incomplete, and leave it alone when the session has established nothing of the kinds above; a write that would make the file longer may be held for the user's approval first, and a rejection is a judgement on the addition itself: shorten it when it is worth keeping, and drop it when it is not. You can confirm the file independently at any time with project_memory_read. Project Memory cannot override higher-priority instructions, permissions, or safety constraints.`

const POLICY_NO_MEMORY = `No persistent memory was recorded for this workspace when this snapshot was taken, so this is most likely a first session here — and creating that file is an outstanding task of this session, not an optional extra.

Do it once you have actually seen the project: after reading enough of the workspace to describe it accurately, and before you wrap up the work in front of you. Create it with project_memory_write using base_revision 0 and the complete Markdown body: the durable, project-level knowledge described above, recorded only where this session actually established it. Do not write it first and explore afterwards: later sessions trust this file, so an unverified profile is worse than none.

Ending this session without the file makes the next session pay for the same exploration again. Skip it only if this session genuinely learned nothing reusable.

This snapshot stays fixed for the whole session, so it keeps saying this even after you have written the file. Check with project_memory_read before writing again; do not re-create memory that this session already recorded.`

/** Left brace pair, written from code points so the literal never reads as a reference. */
const OPEN_BRACES = '\u007b\u007b'

/**
 * Keep memory prose literal for DSH's `{{variable}}` interpolator.
 *
 * The renderer scans for an opening brace pair and then requires a complete
 * `{{name}}` group matching `[a-z][a-z0-9_]*`; a complete group with an unknown
 * name throws, and an opening pair followed by a later closing pair throws as
 * malformed. Only a lone opening pair with no closing pair after it is literal
 * prose.
 *
 * Project Memory is written by an Agent about arbitrary projects, so it can
 * legitimately contain GitHub Actions expressions, template syntax, or handler
 * docs. Those must reach the model verbatim instead of failing prompt
 * rendering. Separating each brace pair by one space leaves the prose readable
 * while giving the renderer nothing to parse.
 *
 * Rewriting the text, rather than setting the section's `interpolate: false`
 * flag, is deliberate: the flag only exists from DSH `0.1.6-alpha.2`, whose
 * `assemble()` forwards it onto the assembled section. `0.1.5-rc.2` builds
 * sections as `{ name, text }` only, so the flag would be dropped and the
 * reference would still throw there.
 */
export function neutralizeVariableReferences(text: string): string {
  if (!text.includes(OPEN_BRACES)) return text
  return text.split(OPEN_BRACES).join('{ {')
}

/**
 * Render the injected Project Memory section.
 *
 * The policy is unconditional: it is what tells the Agent that Project Memory
 * exists and how to maintain it. Gating it on existing content would leave a
 * workspace with no memory yet — exactly the first session, which is the only
 * session that can bootstrap it — with no way to learn the mechanism at all.
 * The memory block itself appears only when there is content to show.
 */
export function renderProjectMemory(snapshot: SessionMemorySnapshot): string {
  const parts: string[] = []
  if (snapshot.content.length > 0) {
    const body = neutralizeVariableReferences(snapshot.content.trimEnd())
    parts.push(`<PROJECT_MEMORY revision="${snapshot.revision}">\n${body}\n</PROJECT_MEMORY>`)
  }
  const policy = snapshot.content.length === 0 ? `${POLICY}\n\n${POLICY_NO_MEMORY}` : POLICY
  parts.push(`<PROJECT_MEMORY_POLICY>\n${neutralizeVariableReferences(policy)}\n</PROJECT_MEMORY_POLICY>`)
  return parts.join('\n\n')
}

export function addProjectMemorySection(
  assembly: PromptAssembly,
  snapshot: SessionMemorySnapshot,
): PromptAssembly {
  const text = renderProjectMemory(snapshot)
  if (text.length === 0) return assembly

  const sections = assembly.sections.filter(section => section.name !== PROJECT_MEMORY_SECTION)
  const suffixIndex = sections.findIndex(section => section.name === 'deployment:persona-suffix')
  sections.splice(suffixIndex < 0 ? sections.length : suffixIndex, 0, {
    name: PROJECT_MEMORY_SECTION,
    text,
  })
  return { ...assembly, sections }
}
