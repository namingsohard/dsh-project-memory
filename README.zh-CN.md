# dsh-project-memory

[English](README.md) | 简体中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供跨会话的**持久工作区认知**。

一个会话为了搞清楚项目是什么，要付出真实的探索成本：目录怎么组织、哪些模块重要、遵循什么约定、怎么构建和测试。这些认知重新发现一次很贵，而且它不属于任何一次对话。本插件为每个工作区维护一份紧凑的 Project Memory，存放在 `<workspace>/.agent/MEMORY.md`；给每个活跃 Agent 一份固定快照，注入 system prompt；并提供显式工具来读取、更新和刷新它。

效果是：同一工作区的后续会话，直接从之前会话已经沉淀的认知起步，而不是从零再探索一遍。

## 工作方式

```
MEMORY.md (revision N)          持久状态，跨会话
        │
        │  会话启动 / 恢复 / 刷新
        ▼
Session snapshot (revision N)   在一个 Agent 的生命周期内固定
        │
        ▼
System prompt                   <PROJECT_MEMORY revision="N"> + policy
        │
        ▼
Agent ──► 正常工作，或直接把这个快照当作可信背景使用
        │
        ▼
project_memory_update           磁盘上变成 revision N+1；本会话快照仍是 N
```

四条设计承诺决定了它的行为：

- **按项目隔离，不按用户。** 记忆绑定工作区。一个工作区对应一份记忆。
- **会话内快照固定。** 更新记忆不会重写当前会话已经在用的快照。这样 system prompt 保持稳定、避免上下文重复，也不会让"最新事实"出现在产生它的工作之前。
- **保存当前状态，不是变更日志。** 记忆是当前的项目画像；旧事实被改写或删除，而不是不断堆积。
- **默认可信。** Agent 不应为了验证记忆里已有的内容而重复探索工作区。当前任务中自然获得的直接证据优先，并用来修正记忆。

## 环境要求

- DeepSeek Harness `0.1.5-rc.1` 至 `0.1.6-alpha.2`（已在 DSH Desktop 自带的 `0.1.6-alpha.2` 运行时的实测通过，也在 `0.1.5-rc.2` 线上通过）
- Node.js 22 或更高

## 安装

**尚未发布到 npm。** 直接从本仓库安装：

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory'
```

`github:` 前缀是必需的——pnpm 本身接受裸的 `owner/repo`，但 DSH 会先用自己的校验器检查 spec，并拒绝那种写法。想锁定代码就固定 commit：

```powershell
dsh plugin --profile web add 'github:namingsohard/dsh-project-memory#<sha>'
```

本仓库提交了编译后的 `lib/`，所以安装不需要任何构建步骤；而且本包**没有声明任何安装期生命周期脚本**——pnpm 的构建脚本门禁不适用，直接 `add` 就应该成功。

如果 pnpm 确实报了被拦下的构建脚本（例如你的 profile 只允许显式列出的包执行脚本），把它打印出的确切包键抄进**该 profile 的** `pnpm-workspace.yaml` 后重跑：

```yaml
allowBuilds:
  dsh-project-memory: true
```

这个授权等于允许该包的代码在安装时于你的机器上执行，且不在 agent 运行的任何沙箱之内。如果你不想给出这个授权，用下面的预构建 tarball——同样是这份代码，但完全不需要构建授权。

### 预构建 tarball（无需构建授权）

每个 [Release](https://github.com/namingsohard/dsh-project-memory/releases) 都会附带 `pnpm pack` 打出的压缩包：

```powershell
dsh plugin --profile web add D:/downloads/dsh-project-memory-0.1.0.tgz
```

tarball 安装带的是预构建代码，不需要 `allowBuilds` 条目，还能拿到带版本号的产物。它也是最接近 registry 安装体验的方式。

**DSH Desktop 用户注意：** `desktop` profile 归 Electron 应用所有，CLI 明确拒绝操作它，所以请用 设置 → 插件 界面安装，而不是命令行。

安装后**重启 DSH**。插件默认没有配置模块级热重载，运行中的进程会继续使用已经加载的模块。

确认配置层已进入合成后的 profile 树：

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

应当看到：

```yaml
- id: project-memory
  name: dsh-project-memory
```

tarball 安装、本地开发安装和卸载步骤见 [INSTALL.md](INSTALL.md)。

## 实际效果

### 工作区的第一个会话

此时还没有记忆文件，Agent 会收到 policy 加上首次会话引导——它把"创建这个文件"写成本会话的一项未完成任务，而不是可选项：

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

只要工作区可解析，policy 每个 assembly 都会注入。只有内容块取决于是否真有东西可展示——因为 policy 本身就是"告诉 Agent 这套机制存在"的唯一途径，若把它和内容绑在一起，恰恰会让最需要创建第一份记忆的那个会话完全看不到 Project Memory。

插件自己不会执行这第一次写入：唯一的写路径是模型调用 `project_memory_update`。所以 bootstrap 文案写成了"带完成条件的义务"而非"可选建议"，`project_memory_update` 的 description 也明确把创建职责写进去——会话做完了手头任务却没写记忆，下一个会话就得把探索重走一遍。

### 后续会话

```
<PROJECT_MEMORY revision="3">
# Architecture
...
</PROJECT_MEMORY>

<PROJECT_MEMORY_POLICY>
...
</PROJECT_MEMORY_POLICY>
```

## 模型工具

| 工具 | 用途 |
| --- | --- |
| `project_memory_read` | 读取最新持久文件，并报告调用方的快照是否已过期。**不会**刷新快照。 |
| `project_memory_update` | 唯一的写入路径，同时也是创建路径：`base_revision`（尚无记忆时填 `0`）+ 完整 Markdown 正文。仅当 revision 仍然匹配、且规范化后的正文确有变化时才写入。**不会**修改当前快照。 |
| `project_memory_refresh` | 只替换调用方的 Session 快照。下一个模型步就会用上它。 |

更新通过磁盘锁跨进程串行化，并使用乐观 revision 控制。发生冲突时工具返回最新 revision 和内容，而不是覆盖另一个会话的工作——两个会话同时写入不会静默丢失认知。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖插入的行：

```yaml
- id: project-memory
  name: dsh-project-memory
  config:
    maxMemoryBytes: 49152
    lockTimeoutMs: 5000
    staleLockMs: 30000
```

patch 会整体替换一行的 `config`，所以要保留的键必须全部重述。

## 记忆格式

插件只占一小段 frontmatter，正文是自由的结构化 Markdown。章节由 Agent 按项目特征自行组织，没有固定 schema。

```markdown
---
format: 1
revision: 3
---

# Architecture

当前有效的、可复用的项目认知。
```

- 已存在但**没有** frontmatter 的 Markdown 文件会被当作 legacy revision 0 接受，并在第一次成功更新时升级——采用本插件不需要重写已有的记忆文件。
- 读取永远不会创建 `.agent` 或 `MEMORY.md`；第一次有效更新才会。
- 正文原样注入，只有一处例外：花括号对被渲染为 `{ {`。DSH 会对 prompt 段落做 `{{variable}}` 插值，遇到未知或畸形引用会直接报错，因此记录 GitHub Actions 表达式或模板语法的项目否则会打断 prompt 渲染。除此之外不改写任何内容。

## 安全边界

插件以 Host 代码运行，自己做工作区检查。它会拒绝：没有 cwd 的调用、非绝对路径的工作区、`.agent`/`MEMORY.md` 符号链接、非常规记忆文件、含 NUL 的内容、畸形元数据、超长正文，以及不安全的 revision。

拒绝永远不会打断模型步。注入监听器把 Project Memory 当作可选的后台层：工作区无法解析或记忆文件被拒时，该次 assembly 直接不带记忆段落发出，插件记一条 warning。调用方主动 abort 仍然继续传播。

Project Memory 是可信的项目认知基线，但**不能**覆盖更高优先级的指令、权限或安全策略。

## 兼容性说明

插件只使用跨版本存在的 API：`system-prompt/assemble` waterfall、`Context.tools.register`、`defineTool`，以及 `Agent.session`（`header.cwd`、`firstLiveSeq`、`surface.replaceGeneration`）。它刻意避开仅新版本才有的选项，因此一份构建同时服务两条线：

- 花括号对在注入前被改写，而不是依赖 `interpolate: false` 段落标志——后者只有 `0.1.6-alpha.2` 起才存在。
- 注入监听器声明了前两个参数，并从 `context.agent` 取 agent，两条线都会填充它。

`peerDependencies` 逐个列出支持版本，而不是用 caret range：

```
0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2
```

npm/pnpm 的 semver 不允许预发布版本满足一个缺少同 `[major, minor, patch]` 预发布的 range，所以 `^0.1.5-rc.2` 会静默排除掉 `0.1.6-alpha.2`。

## 与其他 DSH 记忆插件的关系

这个领域已有若干插件，彼此取向不同。本插件的差异点有三个：记忆是一份可以手工阅读和编辑的普通 Markdown 文件；由 Agent 直接维护，而不是让提案走人工审批；注入的快照在一个会话内刻意保持固定，何时刷新由显式工具控制。如果你需要审批门禁的写入、基于存储域的记录，或语义召回，其他插件可能更合适。

## 开发

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

`lib/` 是刻意提交进仓库的：DSH 只加载插件已构建的入口、从不构建它，所以仓库必须自带可加载的产物。改动 `src/` 后提交前务必跑 `pnpm build`。发布到 registry 或用 tarball 分发时，`prepack` 会自动重新构建并做类型检查。

发布清单和最初的设计说明属于维护者笔记，不随源码发布。

## 许可证

MIT
