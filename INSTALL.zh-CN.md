# 安装 dsh-project-memory

[English](INSTALL.md) | 简体中文

本插件是一个 DeepSeek Harness **bundle**：它附带一个 `cordis.patch.yml`，由 DSH 加载器作为 profile 的一层配置应用。所以"安装"的含义是"让这个包在某个 DSH profile 里可被解析"，而不是"把文件拷到某个地方"。

下面每条路径都有一个共同前提：**DeepSeek Harness 从不构建插件。** 它只加载 `package.json` 里声明的构建产物入口（`main: ./lib/index.js`）。本仓库提交了 `lib/`，所以 GitHub 和 npm 两条路都不需要本地构建。

## 该装到哪个 profile

| 你的 DSH | profile | 安装方式 |
| --- | --- | --- |
| DSH Desktop（Electron 应用） | `desktop` | **只能走 GUI**：设置 → 插件 |
| `dsh web` / `dsh headless` / 其他 CLI profile | `web`、`headless` 等 | `dsh plugin --profile <名称> add <spec>` |

`dsh` CLI 明确拒绝操作 `desktop` profile：

```
error: profile "desktop" is managed exclusively by the Electron application
```

这个守卫存在的原因是该 profile 的生命周期归 Electron 应用所有。请改用它的插件管理界面。

## 方案 A —— 从本 GitHub 仓库安装（当前可用）

本包**尚未发布到 npm**，所以这是目前唯一能用的路径：

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory'
```

固定 tag 或 commit：

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#v0.1.0'
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#<sha>'
```

全 URL 形式等价（`https://github.com/namingsohard/dsh-project-memory`，或带 `.git`）。

**务必写 `github:` 前缀。** pnpm 本身接受裸的 `owner/repo` 并默认当作 GitHub，但 DSH 的安装器会先用更严格的语法校验 spec，并拒绝裸形式：

```
plugin-manager: not a package name the registry accepts: namingsohard/dsh-project-memory
```

裸的双段 spec 只有在以 `http://` 或 `https://` 开头时才会命中 DSH 的托管仓库规则。

**Git 安装取的是源码，不是构建产物。** 本仓库提交了编译后的 `lib/`，所以你加载的就是被审查过的代码。本包也**没有声明安装期生命周期脚本**（`prepack` 只在 pack/publish 时运行），所以 pnpm 的构建脚本门禁不会触发，直接 `add` 应当成功。

如果 pnpm 确实报了被拦下的构建脚本——例如你的 profile 只允许显式列出的包执行脚本——把它打印出的确切包键抄进**该 profile 的** `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-project-memory: true
```

然后重跑 `add`。请把这个授权看作**允许该包代码在安装时于你的机器上执行**，且不在 agent 运行的任何沙箱之内。建议固定 commit（`#<sha>`），让后续推送无法悄悄改变实际运行的内容，并且只对你信任的来源放开。

如果你不想给出这个授权，就走 tarball（方案 C）——它装的是预构建代码，不需要任何授权。

另外，安装机器需要有 Git，因为 pnpm 通过它获取 Git 源。

## 方案 B —— 从 npm registry 安装（发布之后）

发布之后这会成为最省心的路径，因为 registry 安装带的是预构建代码，不需要任何构建授权：

```powershell
dsh plugin --profile web add <发布名>
dsh --profile web --dump-config
```

名字写错会在这里失败：`pnpm view` 报 `ERR_PNPM_FETCH_404`。本包能用的发布名在 [RELEASING.md](RELEASING.md) 里决定——`dsh-project-memory` 这个名字已经被 npm 上一个无关的插件占用了。

包的 `dsh.bundle.patch` 字段指向随包附带的 `cordis.patch.yml`，所以安装会同时添加依赖并注册配置层。

## 方案 C —— 从 tarball 安装

适合在未发布时试用某个版本，或用于私有构建：

```powershell
# 来自 GitHub Release 资产，或本地 pnpm pack 的产物
dsh plugin --profile web add D:/downloads/dsh-project-memory-0.1.0.tgz
```

## 方案 D —— DSH Desktop（GUI）

desktop profile 归 Electron 应用管理，请通过界面安装：

1. 打开 设置 → 插件。
2. 填入方案 A 里的 spec（`github:namingsohard/dsh-project-memory`），或本地 checkout 的绝对路径。
3. 重启 DSH Desktop。

本地开发时用 `link:` 形式的条目可以让构建产物即时生效：`pnpm build` 后重启应用即可，中间不需要重装。

## 安装之后

确认插件行进入了合成后的 profile 树：

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

应当看到：

```yaml
- id: project-memory
  name: dsh-project-memory
```

然后**重启 DSH**（或重载该 profile）。插件默认没有配置热重载根，运行中的进程会继续使用之前加载的模块。

要确认它真的生效了，在任意工作区开一个会话问：

```
你知道 Project Memory 吗？当前这个工作区有吗？
```

安装正常的话，它不读任何文件就能回答，并提到 `.agent/MEMORY.md`。如果该工作区还没有记忆文件，它还应该说明这很可能是第一个会话，并会在探索之后创建该文件。

## 卸载

```powershell
dsh plugin --profile web remove dsh-project-memory
```

也可以在 Desktop 的插件管理器里移除。你的 `<workspace>/.agent/MEMORY.md` 属于项目数据，卸载**不会**动它们。

## Peer 依赖

插件把 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools` 和 `@deepseek-ai/cordis` 声明为 peer。profile 安装通常会把它们解析到运行中的 DSH 安装已经提供的副本上，这正是你想要的——共享同一个模块实例。如果装进一个这些包都不存在的干净环境，插件就需要自己的副本，可能导致同一个服务出现两个实例。
