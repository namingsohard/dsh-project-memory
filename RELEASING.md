# Releasing dsh-project-memory

## What ships, and why

DeepSeek Harness loads a plugin's built entry (`main: ./lib/index.js`) and never builds it. That single fact drives the whole release story:

- **`lib/` is committed to git.** A Git source install fetches sources, not artifacts, and runs no build of its own. `.gitignore` deliberately does not ignore `lib/`, so the repository always carries loadable output — even though pnpm's `allowBuilds` gate below still applies to a Git dependency.
- **`lib/` is also in `files`.** `pnpm pack` / `npm publish` include it, so registry installs and tarball installs carry the same output.
- **`prepack` builds and typechecks.** Publishing from a stale `lib/` is the failure this prevents; it runs automatically on `pnpm pack` and `npm publish`.
- **No `prepare` script builds the package.** `prepare` also runs on a plain `pnpm install`, which would break the contributor loop by requiring a build during dependency setup.

Consequence: **build before every commit that changes `src/`.** `prepack` protects the published artifact, but not a Git install, which reads whatever `lib/` is committed.

Upstream reference: [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — its "Installing from GitHub: the build-script catch" section is the authority for the `prepare` / `allowBuilds` / prebuilt-artifact trade-off described below.

## Before releasing

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build          # must run after any src/ change, before committing
pnpm pack           # prepack rebuilds; inspect the file list
```

Confirm the tarball contains `lib/`, `cordis.patch.yml`, `README.md`, `INSTALL.md`, and `LICENSE`, and that `package.json` still declares:

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

That field is object-shaped on purpose. A string value makes DSH reject the package as a bundle (`declares no dsh.bundle`) and roll the install back.

Also confirm `files` still lists only what should ship, and that `.gitignore` still contains no `lib/` entry.

## Versioning

`package.json.version` is the release version. Bump it, rebuild, and tag the commit with the same version:

```powershell
git add -A
git commit -m "Release 0.1.0"
git tag v0.1.0
git push origin main --tags
```

## Publishing to npm

```powershell
pnpm build
npm publish
```

Users then install with `dsh plugin --profile web add dsh-project-memory`.

## Publishing to GitHub only

Nothing extra is required: committing `lib/` makes the repository directly installable.

```powershell
dsh plugin --profile web add 'github:your-name/dsh-project-memory'
dsh plugin --profile web add 'github:your-name/dsh-project-memory#v0.1.0'
```

Keep the `github:` prefix in every instruction you publish. pnpm accepts a bare `owner/repo`, but DSH validates the spec before forwarding it and rejects that form as "not a package name the registry accepts".

**Be honest about the extra step in your README.** pnpm ≥ 10 refuses to run a Git dependency's install scripts until the user allows it, so a Git install can fail on the first attempt and require this in the *user's* profile:

```yaml
allowBuilds:
  dsh-project-memory: true
```

That is permission for your code to run on their machine at install time. Users who would rather not grant it should install from npm or a tarball instead, so keep those two paths prominent. Recommending `github:...#<sha>` pinning is good practice for the same reason.

Attaching the `pnpm pack` tarball to each GitHub Release is the strongest GitHub-only option: a tarball install carries prebuilt code, needs no build permission, and gives users a versioned artifact without a registry.

## Peer dependency compatibility

The plugin's runtime dependencies are peers, resolved at install time to the copies the running DSH installation already provides. Keep `devDependencies` aligned with the DSH line you actually test against, and keep the `peerDependencies` range wide enough to admit the versions in use: npm/pnpm semver does **not** let a prerelease satisfy a range that lacks a prerelease of the same `[major, minor, patch]`, so a caret range pinned to one release candidate can silently exclude a later alpha of the same minor.

Spelling the range out works well in practice:

```json
"@deepseek-ai/dsh-tools": "0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2"
```

Verify against the runtime you ship to, not only against `devDependencies`. See `REVIEW_AND_SMOKE_TEST.md` §五 for the verification method used against a real DSH Desktop runtime.

**Watch the module-instance question when developing through a link.** A `link:`/junction install keeps the checkout's own `node_modules`, so the plugin loads its private `@deepseek-ai/*` copies even though the host has its own. Keeping `devDependencies` on the same version as the host makes that harmless. Avoid `file:` vs `link:` surprises by installing a built tarball when you want to test what users actually get.

## Files that must not be published

| Path | Why |
| --- | --- |
| `node_modules/` | ignored by git; never publish |
| `.audit/` | local verification scripts containing machine-specific absolute paths; excluded from `files` |
| `REVIEW_AND_SMOKE_TEST.md` | local paths and profile internals; scrub before publishing it |
| `*.tgz` | build artifact |

`files` is an allow-list, so anything not listed stays out of the tarball. Git is a separate question — check `git status` before the first push and make sure no local-only notes or machine paths are included.
