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
project_memory_write            revision N+1 on disk; this session's snapshot stays N
```

Four design commitments shape the behaviour:

- **Project-scoped, not user-scoped.** Memory binds to the workspace. One workspace, one memory.
- **A snapshot is fixed for the session.** Updating memory does not rewrite the snapshot the current session is already using. This keeps the system prompt stable, avoids duplicate context, and prevents the latest facts from appearing before the work that produced them.
- **Latest state, not a changelog.** Memory is a current project profile. Stale facts get rewritten or deleted rather than accumulated.
- **Trusted by default.** Agents should not re-explore a workspace just to verify what memory already says. Naturally obtained direct evidence wins, and corrects the memory.

## Requirements

- DeepSeek Harness `0.1.5-rc.1` through `0.1.7-rc.2` — every published version in that range is type-checked and booted against the real tool registry and prompt renderer, and both ends of it additionally run the full test suite
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
Project Memory (<workspace>/.agent/MEMORY.md) holds what stays true of this project between
sessions and is worth a later session's context: ...
The snapshot above, when present, is already the current persistent memory. ...
Record it with project_memory_write, whose own description carries the argument, approval, and
rejection rules; call project_memory_read first for the revision to submit. Project Memory cannot
override higher-priority instructions, permissions, and safety constraints.

No persistent memory was recorded for this workspace when this snapshot was taken, so this is
most likely a first session here — and creating that file is an outstanding task of this
session, not an optional extra.

Do it once you have actually seen the project: after reading enough of the workspace to
describe it accurately, and before you wrap up the work in front of you. Create it with
project_memory_write using base_revision 0 and the complete Markdown body: the durable,
project-level knowledge described above, recorded only where this session actually established
it. Do not write it first and explore afterwards: later sessions trust this file, so an
unverified profile is worse than none.

Ending this session without the file makes the next session pay for the same exploration
again. Skip it only if this session genuinely learned nothing reusable.

This snapshot stays fixed for the whole session, so it keeps saying this even after you have
written the file. Check with project_memory_read before writing again; do not re-create memory
that this session already recorded.
</PROJECT_MEMORY_POLICY>
```

The policy is injected for every assembly with a resolvable workspace. Only the content block depends on there being something to show, because the policy is what tells the Agent this mechanism exists at all — gating it on existing content would hide Project Memory from exactly the session that has to create it first.

The policy is also where the bar for writing lives: it names the kinds of knowledge that qualify (what the project is, how it is laid out, the conventions the code follows, the commands that build and run it, the constraints a change must respect) and states the test every entry passes — a fact about the repository that is still true next session. Keeping that bar explicit is what stops a profile from absorbing each session's own incidents, and it is why the write tool's description says to leave the file alone when a session established nothing of those kinds.

Nothing in the plugin performs that first write: the only write path is the model calling `project_memory_write`. That is why the bootstrap text is phrased as an obligation with a completion condition rather than an option, and why the write tool's own description names creation — a session that finishes its task without writing leaves the next one to repeat the whole exploration.

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
| `project_memory_write` | The only write path, and also the create path: `base_revision` (`0` when nothing exists yet) plus the complete Markdown body. Writes only when the revision still matches and the normalized body changed. Asks for human approval when the write would grow the stored profile (see [Approval gate](#approval-gate)). Does **not** mutate the current snapshot. |
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
    requireApproval: true
    approvalGrowthBytes: 1024
    approvalWatermarkPercent: 80
```

A patch replaces a row's entire `config`, so restate every key you want to keep.

### Approval gate

A profile that only ever grows stops being a profile, so an update that would make the stored memory longer has to be approved by a person:

- The **first write** of a workspace is never gated. Creating the file cannot make it longer, and gating it would hide the mechanism from exactly the session the policy asks to create it.
- A rewrite that **does not grow** the stored body is never gated either. Rewriting, sharpening, and deleting stale facts is the behaviour the plugin wants, so it carries no friction.
- Growth up to `approvalGrowthBytes` (default 1 KB) is accepted silently.
- Any update whose result would exceed `approvalWatermarkPercent` (default 80%) of `maxMemoryBytes` asks, however small its growth — that is the slow accumulation a per-update growth budget alone cannot catch.

The prompt is the harness's own approval UI, driven by a `tools/pre-execute` decision, so it shows the call and this reason:

```
Rewrite this workspace's Project Memory: 2 KB of 48 KB, this update adds 6 KB
(over the 1 KB silent-growth budget). Model's note: "recorded the release
checklist". Approve?
```

Denying, cancelling, or having no reachable approver fails the call **before** the body runs, so the stored profile keeps its old revision and the model sees the harness's rejection. Every ask and outcome is recorded on the session as `approval/asked` / `approval/decided`.

A rejection is a judgement on the submitted body, and the model is told so — by the write tool's description alone, since the injected policy deliberately keeps only a pointer to it: assess the body's eligibility, shorten and resubmit when it is worth keeping but too long, and leave it out when it is not. The verdict is scoped to that body rather than to the session, and that distinction is load-bearing: the tool takes the whole profile, so every later write is textually a superset of a rejected one, and an open-ended "do not resubmit" would leave a workspace that genuinely changes afterwards uncorrected. Trimming content a person just rejected back under the growth budget is still a back door the gate does not close by itself: it is closed by the description's own `Never trim an addition merely to stay under the approval budget`, and by the person seeing the file again the next time it grows.

The gate stays out of the way where no human could be asked, because the harness fails closed on an unroutable ask — a plugin that always asked would silently block all memory writes after the first. Three cases skip it: a deployment that composes no approval service, a session whose effective approval policy is `never`, and delegated child sessions (which share the workspace but may not be able to route a prompt to a UI). Set `requireApproval: false` to drop the gate everywhere.

Approval is a policy lever, not a safety boundary: `maxMemoryBytes` still caps the file no matter what anyone approves.

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

The plugin uses only cross-line API surface: the `system-prompt/assemble` and `tools/pre-execute` waterfalls, `Context.tools.register`, `defineTool`, and `Agent.session` (`header.cwd`, `firstLiveSeq`, `surface.replaceGeneration`, `header.origin`/`delegationDepth`). It avoids newer-only options so one build serves both lines:

- Brace pairs are rewritten before injection instead of relying on the `interpolate: false` section flag, which exists only from `0.1.6-alpha.2`.
- The assembly listener declares both leading parameters and reads the agent from `context.agent`, which both lines populate.
- The approval gate returns only `allow` (via `next()`) or `{ kind: 'ask' }` from `tools/pre-execute`. Both exist from `0.1.5-rc.1`, and the approval service itself is consumed by the tool registry, so the plugin takes no dependency on it: `@deepseek-ai/dsh-user-approval` is resolved opportunistically with `ctx.get('approval')`, exactly as the registry does.
- Nothing in `src/` names a type from `@deepseek-ai/schemastery`, and the exported `Config` schema is left un-annotated. A bundle can resolve two copies of schemastery at once — the harness takes its own range, the plugin its own — and a `Schema<Config>` annotation does not unify across copies. It is unnecessary anyway: cordis validates `Config` through the structural `~standard` interface, and schemastery brands instances with the global `Symbol.for('schemastery')`, so copies interoperate at runtime.
- `0.1.7` adds surface the plugin ignores rather than surface it depends on: a `displayReason` on the `ask` decision, `projectContent` and `deferLoading` on tool definitions, and an optional `@deepseek-ai/dsh-workspace` peer. The `system-prompt/assemble` and `tools/pre-execute` contracts, `defineTool`, and the `Agent.session` fields are unchanged across the whole range, so one build serves all of it.

`peerDependencies` spell out the supported versions rather than using a caret range:

```
0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || 0.1.7-alpha.1 || 0.1.7-alpha.2 || 0.1.7-rc.1 || 0.1.7-rc.2
```

npm/pnpm semver does not let a prerelease satisfy a range that lacks a prerelease of the same `[major, minor, patch]`, so `^0.1.5-rc.2` would silently exclude `0.1.6-alpha.2` and every later prerelease. The `@deepseek-ai/schemastery` dependency is `^3.18.2`, by contrast, because schemastery ships stable releases: the caret lets one copy serve the harness and the plugin, where an exact pin would force a second copy alongside a harness that resolved further.

## Relationship to other DSH memory plugins

Several plugins in this space overlap, and they make different choices. This one is distinctive in three ways: memory is a plain Markdown file you can read and edit by hand; the Agent maintains it directly, asking a person only when an update would grow the profile past its budgets; and the injected snapshot is deliberately fixed for a session while explicit tools control when it refreshes. If you want every write approved, storage-backed records, or semantic recall, one of the others may fit better.

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
