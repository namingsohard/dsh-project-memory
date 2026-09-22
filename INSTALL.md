# Installing dsh-project-memory

English | [简体中文](INSTALL.zh-CN.md)

This plugin is a DeepSeek Harness **bundle**: it ships a `cordis.patch.yml` that the DSH loader applies as a profile layer. Installation therefore means "make this package resolvable inside a DSH profile", not "copy files somewhere".

One prerequisite matters for every path below: **DeepSeek Harness never builds a plugin.** It loads the built entry declared in `package.json` (`main: ./lib/index.js`). This repository commits `lib/`, so both the GitHub and npm paths work without a local build step.

## Which profile?

| Your DSH | Profile | How to install |
| --- | --- | --- |
| DSH Desktop (Electron app) | `desktop` | **Desktop GUI only** — Settings → Plugins |
| `dsh web` / `dsh headless` / other CLI profiles | `web`, `headless`, ... | `dsh plugin --profile <name> add <spec>` |

The `dsh` CLI deliberately refuses the `desktop` profile:

```
error: profile "desktop" is managed exclusively by the Electron application
```

That guard exists because the Electron app owns that profile's lifecycle. Use its plugin manager UI instead.

## Option A — from this GitHub repository (current)

The package is **not published to npm yet**, so this is the path that works today:

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory'
```

Pin a tag or commit:

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#v0.1.0'
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#<sha>'
```

The full URL form is equivalent (`https://github.com/namingsohard/dsh-project-memory`, or with `.git`).

**Always write the `github:` prefix.** pnpm itself accepts a bare `owner/repo` and defaults it to GitHub, but DSH's installer validates the spec first with a narrower grammar and rejects the bare form:

```
plugin-manager: not a package name the registry accepts: namingsohard/dsh-project-memory
```

A bare two-segment spec only matches DSH's hosted-repository rule when it starts with `http://` or `https://`.

**A Git install fetches sources, not built artifacts.** This repository commits its compiled `lib/`, so the code that loads is the code that was reviewed. It also declares **no install-time lifecycle script** (`prepack` runs only on pack/publish), so pnpm's build-script gate should not trigger and a plain `add` should succeed.

If pnpm does report a blocked build script — for example because your profile allows scripts only for explicitly listed packages — copy the exact package key it printed into the **profile's** `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-project-memory: true
```

Then re-run the `add`. Treat that allowance as **permission for the package's code to execute on your machine at install time**, outside any sandbox the agent runs in. Pin a commit (`#<sha>`) so a later push cannot silently change what runs, and only allow sources you trust.

If you would rather not ask for that permission at all, use the tarball path (Option C) — it installs prebuilt code and needs no allowance.

Git must also be available on the installing machine, since pnpm fetches Git sources through it.

## Option B — from the npm registry (after publishing)

Once published, this becomes the simplest path, because a registry install carries prebuilt code and needs no build permission:

```powershell
dsh plugin --profile web add <published-name>
dsh --profile web --dump-config
```

A wrong name here fails at `pnpm view` with `ERR_PNPM_FETCH_404`. Note that `dsh-project-memory` itself is already taken on npm by an unrelated plugin, so the name to publish under differs from the repository name.

The package's `dsh.bundle.patch` field points at the bundled `cordis.patch.yml`, so installation both adds the dependency and registers the profile layer.

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#v0.1.0'
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#97edff6'
```

The full URL form is equivalent (`https://github.com/namingsohard/dsh-project-memory`, or with `.git`), and needs no quoting.

**Always write the `github:` prefix.** pnpm itself accepts a bare `owner/repo` and defaults it to GitHub, but DSH's installer validates the spec first with a narrower grammar and rejects the bare form:

```
plugin-manager: not a package name the registry accepts: namingsohard/dsh-project-memory
```

A bare two-segment spec only matches DSH's hosted-repository rule when it starts with `http://` or `https://`, so `https://github.com/...` is accepted while `owner/repo` is not. The [official publish guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) is the authority for these rules.

## Option C — from a tarball

Useful for trying a release without publishing, or for a private build:

```powershell
# from a GitHub Release asset or a local `pnpm pack` output
dsh plugin --profile web add D:/downloads/dsh-project-memory-0.1.0.tgz
```

## Option D — DSH Desktop (GUI)

The desktop profile is managed by the Electron app, so install through its UI:

1. Open Settings → Plugins.
2. Add the spec shown in Option A (`github:namingsohard/dsh-project-memory`), or an absolute path to a local checkout.
3. Restart DSH Desktop.

For local development against a checkout, a `link:`-style entry makes the built output live: rebuild with `pnpm build` and restart the app, with no reinstall in between.

## After installing

Verify the plugin row reached the composed profile tree:

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

Expect:

```yaml
- id: project-memory
  name: dsh-project-memory
```

Then **restart DSH** (or reload the profile). The plugin has no hot-reload root configured by default, so a running process keeps the previously loaded module.

To confirm it is actually active, open a session in any workspace and ask:

```
Do you know about Project Memory, and does this workspace have one yet?
```

A working install answers without reading files, and mentions `.agent/MEMORY.md`. On a workspace with no memory yet, it should also say this is likely the first session and that it will create the file after exploring.

## Uninstalling

```powershell
dsh plugin --profile web remove dsh-project-memory
```

Or remove it through the Desktop plugin manager. Your `<workspace>/.agent/MEMORY.md` files are project data and are **not** touched by uninstalling.

## Peer dependencies

The plugin declares `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/cordis` as peers. A profile install normally resolves them to the copies the running DSH installation already provides, which is what you want — one shared module instance. Install into a clean environment where those packages are absent, and the plugin would need its own copies, risking two instances of the same service.
