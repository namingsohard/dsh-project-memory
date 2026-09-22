# dsh-project-memory

Persistent workspace understanding for DeepSeek Harness. The plugin maintains one compact Project Memory at `<workspace>/.agent/MEMORY.md`, gives each live Agent a fixed in-memory snapshot, injects that snapshot into the system prompt, and exposes explicit tools for reading, updating, and refreshing it.

## Compatibility

- DeepSeek Harness: verified against the `0.1.6-alpha.2` line (the runtime shipped with DSH Desktop) and the `0.1.5-rc.2` line
- Node.js: 22 or newer

The plugin uses only cross-line API surface: the `system-prompt/assemble` waterfall, `Context.tools.register`, `defineTool`, and `Agent.session` (`header.cwd`, `firstLiveSeq`, `surface.replaceGeneration`). It deliberately avoids newer-only options, so one build serves both lines:

- Brace pairs in memory prose are rewritten before injection instead of relying on the `interpolate: false` section flag, which exists only from `0.1.6-alpha.2`.
- The assembly listener declares both leading parameters and reads the agent from `context.agent`, which both lines populate.

`devDependencies` track `0.1.6-alpha.2`, so the type checker runs against the current runtime. `peerDependencies` accept both lines explicitly:

```
0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2
```

The range is spelled out rather than given as `^0.1.5-rc.2` on purpose: npm/pnpm semver does not let a prerelease satisfy a range that lacks a prerelease of the same `[major, minor, patch]`, so a caret range pinned to one release candidate silently excludes a later alpha of the same minor.

DSH is still evolving quickly. Peer resolution normally uses the `@deepseek-ai/*` copies the running DSH installation already provides, so the plugin shares module instances with the host instead of loading private duplicates.

## Install

Registry:

```powershell
dsh plugin --profile web add dsh-project-memory
```

Straight from a public GitHub repository (no publishing needed — the repository commits its build output, because DSH never builds a plugin):

```powershell
dsh plugin --profile web add 'github:your-name/dsh-project-memory'
```

The `github:` prefix is required: pnpm would accept a bare `owner/repo`, but DSH's installer validates the spec itself and rejects that form.

DSH Desktop manages its own `desktop` profile and refuses it from the CLI, so install it there through Settings → Plugins instead. Tarball installs, verification, and uninstall instructions are in [INSTALL.md](./INSTALL.md).

The bundle inserts this row:

```yaml
- id: project-memory
  name: dsh-project-memory
```

Verify it landed in the composed profile tree:

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

## Develop locally

```powershell
pnpm install
pnpm build
dsh plugin --profile web add file:D:/path/to/dsh-project-memory-plugin
dsh --profile web --dump-config
```

## Configuration

Override the inserted row in a later Cordis patch when needed:

```yaml
- id: project-memory
  name: dsh-project-memory
  config:
    maxMemoryBytes: 49152
    lockTimeoutMs: 5000
    staleLockMs: 30000
```

## Memory format

The plugin owns a small metadata frontmatter while leaving the body as free structured Markdown:

```markdown
---
format: 1
revision: 3
---

# Architecture

Reusable current project knowledge.
```

An existing Markdown file without frontmatter is accepted as legacy revision 0 and upgraded on its first successful update. Reads do not create `.agent` or `MEMORY.md`; the first effective update does.

Memory prose is injected verbatim, except that a brace pair is rendered as `{ {`. DSH interpolates `{{variable}}` references in prompt sections and rejects unknown or malformed ones, so a project that documents GitHub Actions expressions or template syntax would otherwise fail prompt rendering. Nothing else in the body is rewritten.

## Model tools

- `project_memory_read` reads the latest persistent file and reports whether the caller's snapshot is stale. It does not refresh the snapshot.
- `project_memory_update` accepts `base_revision` plus the complete maintained Markdown body. It writes only when the revision still matches and the normalized body changed. It does not mutate the current snapshot.
- `project_memory_refresh` replaces only the caller's Session snapshot. The next model step receives it.

Updates are serialized across processes with an on-disk lock and use optimistic revision control. On conflict, the tool returns the latest revision and content instead of overwriting another Session's work.

## Snapshot and compaction semantics

A snapshot is keyed by the live Agent, not persisted in the Session log. New and resumed Agents load the latest memory. Ordinary persistent updates leave existing snapshots fixed.

DSH assembles the system prompt before automatic pressure compaction runs in `agent/pre-step`. The plugin therefore detects a committed Session surface replacement through `replaceGeneration` and refreshes at the following prompt-assembly boundary. It does not patch or replace the DSH compaction engine.

The `<PROJECT_MEMORY_POLICY>` block is injected for every assembly that has a resolvable workspace, whether or not memory exists yet — it is what tells the Agent that Project Memory exists and how to maintain it. Only the `<PROJECT_MEMORY revision="N">` content block depends on there being something to show:

- **No `MEMORY.md` yet** (a first session): the policy is injected with bootstrap guidance — treat the empty state as normal, and create the first memory with `project_memory_update` on `base_revision 0` once the workspace has actually been explored.
- **`MEMORY.md` exists**: the policy is injected together with the snapshot content.

Because the snapshot stays fixed, a session that bootstraps memory keeps seeing the bootstrap variant until a refresh or a surface replacement. That guidance therefore also tells the Agent to check `project_memory_read` before writing again, so it does not re-create what the same session already recorded.

## Safety boundaries

The plugin is Host code, so it performs its own workspace checks. It rejects cwd-less calls, non-absolute workspaces, `.agent`/`MEMORY.md` symlinks, non-regular memory files, NUL content, malformed metadata, oversized bodies, and unsafe revisions. Project Memory is trusted as a project-knowledge baseline but is explicitly unable to override higher-priority instructions, permissions, or safety policy.

A rejection never breaks a model step. The prompt listener treats Project Memory as an optional background layer: when the workspace cannot be resolved or the memory file is refused, that assembly simply goes out without a memory section and the plugin logs a warning. The exception is a caller-initiated abort, which keeps propagating.

## Development

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```
