import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import type { SessionMemorySnapshot } from './snapshot-manager.js';
export declare const PROJECT_MEMORY_SECTION = "project-memory:snapshot";
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
export declare function neutralizeVariableReferences(text: string): string;
/**
 * Render the injected Project Memory section.
 *
 * The policy is unconditional: it is what tells the Agent that Project Memory
 * exists and how to maintain it. Gating it on existing content would leave a
 * workspace with no memory yet — exactly the first session, which is the only
 * session that can bootstrap it — with no way to learn the mechanism at all.
 * The memory block itself appears only when there is content to show.
 */
export declare function renderProjectMemory(snapshot: SessionMemorySnapshot): string;
export declare function addProjectMemorySection(assembly: PromptAssembly, snapshot: SessionMemorySnapshot): PromptAssembly;
//# sourceMappingURL=prompt-provider.d.ts.map