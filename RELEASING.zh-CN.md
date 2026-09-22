# 发布 dsh-project-memory

[English](RELEASING.md) | 简体中文

## 阻断问题：npm 上的名字已被占用

本包**无法以 `dsh-project-memory` 发布**。npm 上这个名字已被一个无关插件占用（2026-08-16 由 `louisxiao` 发布，仓库 `luoyuejun9/dsh-project-memory`）。`pnpm publish` 会直接 403，而且这个名字收不回来。

发布前先二选一：

| 方案 | 名字 | 代价 |
| --- | --- | --- |
| 加 scope（推荐） | `@namingsohard/dsh-project-memory` | 保住描述性的名字；用户要多打 scope。scope 必须与拥有它的 npm 账号或组织一致。 |
| 改名 | 例如 `dsh-workspace-understanding` | 安装命令更短；但失去这个显而易见的名字以及随之而来的搜索流量。 |

DSH 记忆类插件的 npm 生态已经很拥挤（`dsh-agent-memory`、`dsh-workspace-memory`、`nishi-dsh-project-memory`、`dsh-memory-vault`、`@hy-sde-org/dsh-memory` 等等），所以无论名字是否可用，一个更独特的名字也能减少混淆。

**改名要动三个地方，漏掉任何一个都会导致安装失败：**

1. `package.json` → `name`
2. `cordis.patch.yml` → 行里的 `name`（这是 Node 用来解析的包名，必须与包名一致）
3. `README.md`、`README.zh-CN.md`、`INSTALL.md`、`INSTALL.zh-CN.md` 里所有安装命令

## 发什么，以及为什么

DeepSeek Harness 加载插件已构建的入口（`main: ./lib/index.js`），从不构建它。这一条事实决定了整个发布方式：

- **`lib/` 提交进 git。** Git 源安装取的是源码而非产物，且不会自己构建。`.gitignore` 刻意不忽略 `lib/`，所以仓库永远带着可加载的产物——尽管下面说的 pnpm `allowBuilds` 门禁对 Git 依赖仍然适用。
- **`lib/` 也在 `files` 里。** `pnpm pack` / `npm publish` 会包含它，因此 registry 安装和 tarball 安装带的是同一份产物。
- **`prepack` 会构建并做类型检查。** 它防的就是"用陈旧的 `lib/` 发布"；`pnpm pack` 和 `pnpm publish` 都会自动触发。
- **不使用 `prepare` 构建。** `prepare` 在普通 `pnpm install` 时也会跑，那会让贡献者在装依赖时就被迫构建。

结论：**任何改动 `src/` 的提交之前都要先构建。** `prepack` 保护的是发布产物，保护不了 Git 安装——Git 安装读的是你提交的那个 `lib/`。

上游依据：[Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。其中 "Installing from GitHub: the build-script catch" 一节是下面 `prepare` / `allowBuilds` / 预构建产物之间取舍的权威说明。

## 发布前检查

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build          # 改动 src/ 后、提交前必须执行
pnpm pack           # prepack 会重新构建；检查文件清单
```

确认 tarball 里包含 `lib/`、`cordis.patch.yml`、`README.md`、`README.zh-CN.md`、`INSTALL.md`、`INSTALL.zh-CN.md` 和 `LICENSE`，并确认 `package.json` 仍然声明：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

这个字段刻意写成对象形式。字符串值会让 DSH 判定该包不是 bundle（`declares no dsh.bundle`）并回滚安装。

同时确认 `files` 只列出应当发布的内容，且 `.gitignore` 里仍然没有 `lib/` 条目。

## 版本号

`package.json.version` 就是发布版本。改版本号、重新构建，并对同一个 commit 打 tag：

```powershell
git add -A
git commit -m "Release 0.1.0"
git tag v0.1.0
git push origin main --tags
```

先打 tag 再发布，这样 registry 记录的 `gitHead` 在仓库里真实存在。

## 发布到 npm

```powershell
npm login
pnpm publish --dry-run      # 检查：只有 lib/、patch、文档、LICENSE、package.json
pnpm publish
```

`prepack` 会重新构建并做类型检查。裸包默认发布为 public；带 scope 的包需要 `publishConfig.access: "public"` 或 `--access public`，否则会发成 private，别人装不了。

已发布的 `name@version` 是永久的——不能复用，且 `unpublish` 基本只在 72 小时内可行。所以一定要先 dry-run，并且最好在正式发布前先用 tarball 验证一遍安装（`pnpm pack` → `dsh plugin --profile web add ./x.tgz`）。

之后用户这样安装：`dsh plugin --profile web add <发布名>`。

## 只发布到 GitHub

不需要额外步骤：提交 `lib/` 之后仓库就可直接安装。

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory'
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#v0.1.0'
```

在所有对外说明里都要保留 `github:` 前缀。pnpm 接受裸的 `owner/repo`，但 DSH 会在转发前校验 spec，并以 "not a package name the registry accepts" 拒绝这种写法。

**在 README 里如实说明这一步。** pnpm ≥ 10 在用户放行之前不会执行 Git 依赖的安装脚本，所以 Git 安装可能第一次就失败，需要用户在**他自己的** profile 里加：

```yaml
allowBuilds:
  dsh-project-memory: true
```

这等于允许你的代码在他安装时于其机器上执行。不愿给出该授权的用户应该改用 npm 或 tarball，所以这两条路径要在文档里保持醒目。同样出于这个原因，建议引导用户固定 commit（`github:...#<sha>`）。

把 `pnpm pack` 的 tarball 挂到每个 GitHub Release 是"只用 GitHub"的最佳做法：tarball 安装带的是预构建代码、不需要任何构建授权，还能给用户一个带版本号的产物。

## Peer 依赖兼容性

插件的运行时依赖都是 peer，安装时解析到运行中的 DSH 安装已经提供的副本。请让 `devDependencies` 对齐你实际测试的那条 DSH 线，并让 `peerDependencies` 的范围足够宽以容纳在用的版本：npm/pnpm 的 semver **不允许**预发布版本满足一个缺少同 `[major, minor, patch]` 预发布的 range，所以把 caret range 钉在某个候选版上，会静默排除掉同一 minor 的后续 alpha。

把范围逐个写出来在实践中效果很好：

```json
"@deepseek-ai/dsh-tools": "0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2"
```

要对着你实际发布的运行时验证，而不只是对着 `devDependencies`。验证方法见 `REVIEW_AND_SMOKE_TEST.md` 第五节（针对真实 DSH Desktop 运行时的做法）。

**通过 link 开发时要注意模块实例问题。** `link:`/junction 安装会保留 checkout 自己的 `node_modules`，所以即使宿主有自己的副本，插件也会加载它私有的 `@deepseek-ai/*`。把 `devDependencies` 保持在和宿主相同的版本，这个问题就无害。想测试用户实际拿到的东西时，请安装构建好的 tarball。

## 绝不能发布的内容

| 路径 | 原因 |
| --- | --- |
| `node_modules/` | 已被 git 忽略；永远不要发布 |
| `.audit/` | 含本机绝对路径的本地验证脚本；已被 git 忽略且在 `files` 之外 |
| `REVIEW_AND_SMOKE_TEST.md` | 含本机路径与 profile 内部信息；不在 `files` 里，但**在仓库里**——公开仓库前先脱敏 |
| `*.tgz` | 构建产物 |

`files` 是白名单，所以没列出的内容不会进 tarball。git 是另一回事——首次 push 前检查 `git status`，确认没有夹带本地笔记或机器路径。
