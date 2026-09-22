# dsh-project-memory

English | [简体中文](README.zh-CN.md)

Persistent workspace understanding for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session spends real effort working out what a project is: how it is laid out, which modules matter, what conventions it follows, how it is built and tested. That understanding is expensive to rediscover and does not belong to any single conversation. This plugin keeps one compact Project Memory per workspace at `<workspace>/.agent/MEMORY.md`, gives each live Agent a fixed snapshot of it, injects that snapshot into the system prompt, and exposes explicit tools for reading, updating, and refreshing it.

The result: a later session in the same workspace starts from what earlier sessions already learned instead of exploring from zero again.

## How it works

```
MEMORY.md (revision N)          the persistent, cross-session state
        │
        │  session start / resume / refresh
        ▼
Session snapshot (revision N)   fixed for the life of one live Agent
        │
        ▼
System prompt                   <PROJECT_MEMORY revision="N"> + policy
        │
        ▼
Agent ──► works normally, or uses the snapshot directly as trusted background
        │
        ▼
project_memory_update           revision N+1 on disk; this session's snapshot stays N
```

Four design commitments shape the behaviour:

- **Project-scoped, not user-scoped.** Memory binds to the workspace. One workspace, one memory.
- **A snapshot is fixed for the session.** Updating memory does not rewrite the snapshot the current session is already using. This keeps the system prompt stable, avoids duplicate context, and prevents the latest facts from appearing before the work that produced them.
- **Latest state, not a changelog.** Memory is a current project profile. Stale facts get rewritten or deleted rather than accumulated.
- **Trusted by default.** Agents should not re-explore a workspace just to verify what memory already says. Naturally obtained direct evidence wins, and corrects the memory.

## Requirements

- DeepSeek Harness `0.1.5-rc.1` through `0.1.6-alpha.2` (verified against the `0.1.6-alpha.2` runtime shipped with DSH Desktop, and against `0.1.5-rc.2`)
- Node.js 22 or newer

## Install

**Not yet published to npm.** Install directly from this repository:

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory'
```

The `github:` prefix is required — pnpm would accept a bare `owner/repo`, but DSH validates the spec itself and rejects that form. Pin a commit if you want the code to stay put:

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#<sha>'
```

This repository commits its compiled `lib/`, so the install needs no build step, and the package declares **no install-time lifecycle script** — pnpm's build-script gate does not apply, and a plain `add` should just work.

If pnpm does report a blocked build script (for example because your profile allows scripts only for explicitly listed packages), copy the exact package key it prints into the **profile's** `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-project-memory: true
```

Treat that allowance as permission for the package's code to run on your machine at install time, outside any sandbox the agent runs in. If you would rather not grant it, use the prebuilt tarball below instead — it installs the same code with no build permission at all.

### Prebuilt tarball (no build permission)

Each [release](https://github.com/namingsohard/dsh-project-memory/releases) attaches the packaged tarball that `pnpm pack` produces:

```powershell
dsh plugin --profile web add D:/downloads/dsh-project-memory-0.1.0.tgz
```

Tarball installs carry prebuilt code, need no `allowBuilds` entry, and give you a versioned artifact. They are also the closest thing to what a registry install would deliver.

**DSH Desktop users:** the `desktop` profile is owned by the Electron app and the CLI refuses to touch it, so install through Settings → Plugins rather than the command line.

Then **restart DSH**. The plugin has no hot-reload root configured by default, so a running process keeps the module it already loaded.

Verify the layer landed in the composed profile tree:

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

Expect:

```yaml
- id: project-memory
  name: dsh-project-memory
```

Tarball installs, local development, and uninstall steps are in [INSTALL.md](INSTALL.md).

## What you get

### First session in a workspace

There is no memory file yet, so the Agent receives the policy plus bootstrap guidance that states creating the file is an open task for this session:

```
<PROJECT_MEMORY_POLICY>
Project Memory (<workspace>/.agent/MEMORY.md) caches reusable, project-level knowledge ...
The snapshot above, when present, is already the current persistent memory. ...
Record new knowledge with project_memory_update: ...

No persistent memory was recorded for this workspace when this snapshot was taken, so this is
most likely a first session here — and creating that file is an outstanding task of this
session, not an optional extra.

Do it once you have actually seen the project: after reading enough of the workspace to
describe it accurately, and before you wrap up the work in front of you. Create it with
project_memory_update using base_revision 0 and the complete Markdown body — what the project
is, how it is organized, the conventions it follows, and how it is built and run. Do not write
it first and explore afterwards: later sessions trust this file, so an unverified profile is
worse than none.

Ending this session without the file makes the next session pay for the same exploration
again. Skip it only if this session genuinely learned nothing reusable.

This snapshot stays fixed for the whole session, so it keeps saying this even after you have
written the file. Check with project_memory_read before writing again; do not re-create memory
that this session already recorded.
</PROJECT_MEMORY_POLICY>
```

The policy is injected for every assembly with a resolvable workspace. Only the content block depends on there being something to show, because the policy is what tells the Agent this mechanism exists at all — gating it on existing content would hide Project Memory from exactly the session that has to create it first.

Nothing in the plugin performs that first write: the only write path is the model calling `project_memory_update`. That is why the bootstrap text is phrased as an obligation with a completion condition rather than an option, and why the update tool's own description names creation — a session that finishes its task without writing leaves the next one to repeat the whole exploration.

### Later sessions

```
<PROJECT_MEMORY revision="3">
# Architecture
...
</PROJECT_MEMORY>

<PROJECT_MEMORY_POLICY>
...
</PROJECT_MEMORY_POLICY>
```

## Model tools

| Tool | Purpose |
| --- | --- |
| `project_memory_read` | Reads the latest persistent file and reports whether the caller's snapshot is stale. Does **not** refresh the snapshot. |
| `project_memory_update` | The only write path, and also the create path: `base_revision` (`0` when nothing exists yet) plus the complete Markdown body. Writes only when the revision still matches and the normalized body changed. Does **not** mutate the current snapshot. |
| `project_memory_refresh` | Replaces only the caller's Session snapshot. The next model step receives it. |

Updates are serialized across processes with an on-disk lock and use optimistic revision control. On conflict the tool returns the latest revision and content instead of overwriting another session's work, so two sessions writing at once cannot silently lose knowledge.

## Configuration

Override the inserted row in the profile's `cordis.patch.yml`:

```yaml
- id: project-memory
  name: dsh-project-memory
  config:
    maxMemoryBytes: 49152
    lockTimeoutMs: 5000
    staleLockMs: 30000
```

A patch replaces a row's entire `config`, so restate every key you want to keep.

## Memory format

The plugin owns a small frontmatter while leaving the body as free structured Markdown. Sections are chosen by the Agent to fit the project; there is no fixed schema.

```markdown
---
format: 1
revision: 3
---

# Architecture

Reusable current project knowledge.
```

- An existing Markdown file **without** frontmatter is accepted as legacy revision 0 and upgraded on its first successful update, so adopting the plugin does not require rewriting an existing memory file.
- Reads never create `.agent` or `MEMORY.md`; the first effective update does.
- Prose is injected verbatim, except that a brace pair is rendered as `{ {`. DSH interpolates `{{variable}}` references in prompt sections and rejects unknown or malformed ones, so a project documenting GitHub Actions expressions or template syntax would otherwise break prompt rendering. Nothing else is rewritten.

## Safety boundaries

The plugin runs as Host code and performs its own workspace checks. It rejects cwd-less calls, non-absolute workspaces, `.agent`/`MEMORY.md` symlinks, non-regular memory files, NUL content, malformed metadata, oversized bodies, and unsafe revisions.

A rejection never breaks a model step. The prompt listener treats Project Memory as an optional background layer: when the workspace cannot be resolved or the memory file is refused, that assembly goes out without a memory section and the plugin logs a warning. A caller-initiated abort still propagates.

Project Memory is a trusted project-knowledge baseline, but it cannot override higher-priority instructions, permissions, or safety policy.

## Compatibility notes

The plugin uses only cross-line API surface: the `system-prompt/assemble` waterfall, `Context.tools.register`, `defineTool`, and `Agent.session` (`header.cwd`, `firstLiveSeq`, `surface.replaceGeneration`). It avoids newer-only options so one build serves both lines:

- Brace pairs are rewritten before injection instead of relying on the `interpolate: false` section flag, which exists only from `0.1.6-alpha.2`.
- The assembly listener declares both leading parameters and reads the agent from `context.agent`, which both lines populate.

`peerDependencies` spell out the supported versions rather than using a caret range:

```
0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2
```

npm/pnpm semver does not let a prerelease satisfy a range that lacks a prerelease of the same `[major, minor, patch]`, so `^0.1.5-rc.2` would silently exclude `0.1.6-alpha.2`.

## Relationship to other DSH memory plugins

Several plugins in this space overlap, and they make different choices. This one is distinctive in three ways: memory is a plain Markdown file you can read and edit by hand; the Agent maintains it directly rather than routing proposals through human approval; and the injected snapshot is deliberately fixed for a session while explicit tools control when it refreshes. If you want approval-gated writes, storage-backed records, or semantic recall, one of the others may fit better.

## Development

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

`lib/` is committed on purpose: DSH loads a plugin's built entry and never builds it, so the repository has to carry loadable output. Run `pnpm build` before committing changes to `src/`. `prepack` rebuilds and typechecks automatically for registry and tarball installs.

The release checklist and the original design notes are maintainer notes and are not published with the source.

## License

MIT
