# Project Memory 插件审查报告与烟测手册

> **这是一份历史审计记录**，不是当前状态的说明。文中 C1–C4 均为**已修复**的问题（见下表），保留它们是为了记录每处缺陷的根因与验证方式；文中的 `M*`/`L*` 条目是当时未处理的观察项。当前行为以 [README.md](README.md) 为准。

审查对象：本仓库（V1，`package.json` version `0.1.0`）
审查方式：静态阅读全部 `src/`，对照 `PROJECT_NOTEBOOK.md` 规格，对照**已安装的真实 DSH 运行时**（DSH Desktop 自带的 `@deepseek-ai/*`，版本 `0.1.6-alpha.2`）与插件本地依赖（当时为 `0.1.5-rc.2`），并实际运行插件构建产物。

已独立复核通过的项目：

| 复核项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | 通过 |
| 单元测试 | `pnpm test` | 5 文件 / 27 测试全部通过 |
| 构建 | `pnpm build` | 通过 |
| 打包 | `pnpm pack` | 通过，包含 `lib`、`cordis.patch.yml`、`README.md`、`LICENSE` |
| 构建产物运行（0.1.5-rc.2 依赖） | 自定义 harness（真实 `dsh-tools` / `dsh-system-prompt`） | 16/16 通过 |
| 构建产物运行（0.1.6-alpha.2 Desktop 运行时） | 见 §五 | 13/13 通过 |
| C2/C3/C4 专项 | `.audit/c2-c3-verify.mjs` | 40/40 通过 |

结论：**实现与设计规格基本一致，C1–C4 已修复。** 剩余问题（§二、§三）不阻断安装与烟测。兼容性结论见 §五。

### 修复状态

| 编号 | 问题 | 状态 |
| --- | --- | --- |
| C1 | `dsh.bundle` 声明格式错误，`dsh plugin add` 必然回滚 | **已由用户修复**（`package.json` 现为 `{"bundle":{"patch":"./cordis.patch.yml"}}`） |
| C2 | MEMORY.md 中的 `{{...}}` 导致整个模型步中断 | **已修复**，见 §C2 修复说明 |
| C3 | memory 读取/格式错误中断整个模型步 | **已修复**，见 §C3 修复说明 |
| C4 | 首次会话完全看不到 Project Memory（policy 被内容门控） | **已修复**，见 §C4 修复说明 |

---

## 一、致命问题（已修复）

### C1. `package.json` 的 `dsh.bundle` 声明格式错误 —— `dsh plugin add` 必然失败并回滚（已修复）

> **状态：已由用户修复。** 以下保留原始分析与复现证据，供后续版本参考。

`package.json:52-54`（修复前）：

```json
"dsh": { "bundle": "./cordis.patch.yml" }
```

DSH 要求的格式是 **对象**，字段为 `patch`：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

依据（真实运行时代码）：

- `@deepseek-ai/dsh-app-boot/lib/index.js:919`：`JSON.parse(...).dsh?.bundle?.patch`，`undefined` 时抛
  `dsh: profile bundle "..." declares no dsh.bundle in its package.json`（`:920`）。
- `@deepseek-ai/dsh-plugin-manager/lib/index.js:32` `bundleManifest()` 直接返回 `undefined`；
  `:928` 抛 `ManagementFailure("not-bundle")`，`:931` 调 `restoreFiles()` **把 `package.json` 和 `pnpm-lock.yaml` 回滚**。
- 已发布的官方 bundle 全部使用对象形式：`dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-experimental-agent-team-profile` 的 `dsh` 字段均为 `{"bundle":{"patch":"./cordis.patch.yml"}}`。

我用脚本按加载器的真实判断逻辑复现（`.audit/bundle-manifest-check.mjs`）：

```
plugin package.json dsh field: {"bundle":"./cordis.patch.yml"}
  dsh.bundle.patch      = undefined
[plugin-manager installBundle]
  -> THROWS ManagementFailure("not-bundle"); 回滚 package.json + pnpm-lock.yaml
shipped bundle dsh-base: dsh = {"bundle":{"patch":"./cordis.patch.yml"}}
```

后果：当时的安装命令 `dsh plugin --profile web add file:<插件目录>` **不会装上任何东西**，而且看起来像“安装成功后又消失了”。这是当前唯一真正的安装阻断点——比 `@deepseek-ai/dsh@0.1.5-rc.2` 的 peer 解析问题更靠前，因为即使 CLI 能跑也用不了。

修法：改 `package.json`（同时建议给 `cordis.patch.yml` 加上用途注释）。

### C2. `MEMORY.md` 内容出现 `{{...}}` 会抛错，直接打断整个模型步（已修复）

> **状态：已修复。** 修复方式与验证见下。

原始报错（真实运行时）：

```
Error: unknown prompt variable "{{variable}}" in section "project-memory:snapshot"; registered variables: (none)
```

复现脚本：`.audit/runtime-harness2.mjs` 第 A 项（对插件注入后的 assembly 调用真实的 `renderPrompt`）。

触发条件极其常见：MEMORY.md 里写 `{{variable}}`、`{{name}}`、GitHub Actions 的 `${{ ... }}`、Vue/Handlebars 模板说明等，都会被当成变量引用。

调用链与后果（真实运行时）：

- `@deepseek-ai/dsh-agent-loop/lib/index.js:888` `await this.loopCtx.systemPrompt.assemble(...)` → 抛出；
- `:935` `preStep()` 抛出，`:989` `this.throwError(error)` 上报 `agent/error`，`:871` `catch (_error) {}` 收敛；
- 结果：**该 turn 无法进入任何一步**，用户看到一轮报错，模型完全没有机会看到提示词或调用工具。也就是说，一个 MEMORY.md 里的模板语法能让整个 session 卡死，且用户几乎无法自行定位原因。

修法（任一，建议 1+2）：

1. 在 `renderProjectMemory()` 里对正文做转义：把 `{{` 处理成不会触发插值的形式（注意 DSH 的规则：单独的 `{{` 无后续 `}}` 时是字面量，替换后的值不再被扫描）；
2. `src/index.ts:24-31` 的 waterfall 监听器整体加 `try/catch`：出错时记日志并返回 `transformed`（无 memory 的原始 assembly），让当步仍能正常进行；
3. 在 `normalizeMemoryContent()`/`update` 里把 `{{` 判定为需要转义的输入并给出明确提示。

#### C2 实际修复

采用方案 1（而不是方案 3，也不依赖 `interpolate: false`）。`src/prompt-provider.ts` 新增 `neutralizeVariableReferences()`，在 `renderProjectMemory()` 里对正文调用：每个开括号对 `{{` 变成 `{ {`。

写法是先按**码点**构造开括号对再查找：

```ts
const OPEN_BRACES = '\u007b\u007b'
```

这样源码本身不含字面量 `{{`，不会让读者误以为这里存在变量引用。

**为什么不用 `interpolate: false`**：这是 DSH `0.1.6-alpha.2` 才有的字段。它的 `assemble()` 会转发该字段（`dsh-system-prompt/lib/index.js:343`），而 `0.1.5-rc.2` 的 `assemble()` 只构造 `{ name, text }`（同文件 `:337-340`），标志会被丢弃、引用仍会抛错。改写文本是两条线都成立的写法，这也正是 §七 兼容性结论的一部分。

验证（`.audit/c2-c3-verify.mjs`，10 种花括号形态，每种都过真实 `renderPrompt`）：

| 形态 | 结果 |
| --- | --- |
| `{{variable}}` | 注入为 `{ {variable}}`，渲染通过 |
| `{{Name}}`（大写，DSH 视为非法变量名） | 通过 |
| `${{ matrix.os }}` / `${{ secrets.TOKEN }}` | 通过 |
| `{{my-var}}`（含连字符） | 通过 |
| `{{ outer {{ inner }} }}` | 通过 |
| `{{#each items}} ... {{/each}}` | 通过 |
| `{{a}}{{b}}` 相邻 | 通过 |
| 只有 `}}` | 通过 |
| 末尾孤立 `{{` | 通过 |
| 代码块内 `${{ github.ref }}` | 通过 |

同时确认：不带花括号的正文**完全不被改写**（避免过度修正），且改写是幂等的。

### C3. 任何 memory 读取/格式错误都会打断整个模型步（已修复）

同一调用链（`assemble` → `renderPrompt` 之前）意味着下列任意一种情况都会让整个 turn 失败，而不是“本次不注入 memory”：

- MEMORY.md 有重复 frontmatter 键 → `INVALID_FORMAT: Duplicate Project Memory frontmatter key: revision`（已复现，`.audit/runtime-harness2.mjs` 第 F 项）；
- `format` 不是 `1` → `UNSUPPORTED_FORMAT`；
- 文件超过 `maxMemoryBytes + 1024` → `MEMORY_TOO_LARGE`（已复现，第 E 项）；
- cwd 缺失 → `WORKSPACE_REQUIRED`（已复现，`runtime-harness.mjs`）；
- `.agent` 是符号链接 → `SYMLINK_DENIED`。

这些都是**合理的拒绝**（安全上是对的），但注入路径上“拒绝 = 整个 session 不能工作”是过重的惩罚。

#### C3 实际修复

`src/index.ts` 的 waterfall 监听器把 `snapshots.ensure()` + 注入包进 `try/catch`：失败时用 `ctx.logger.warn` 记录原因，并返回 `next()` 的原始 assembly（本次不注入 memory）。**调用方主动 abort 仍然继续抛出**，不吞掉别人的控制流：

```ts
} catch (error) {
  if (assembleContext.signal?.aborted === true) throw error
  ctx.logger?.warn('project-memory: skipped memory injection for this assembly: %s', ...)
  return transformed
}
```

验证（`.audit/c2-c3-verify.mjs` + `tests/assemble-guard.test.ts`）：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 工作区目录不存在 | 抛错，turn 失败 | 降级：不注入、记 warn，会话继续 |
| session 无 cwd | 抛错，turn 失败 | 降级 |
| 重复 frontmatter 键 | 抛错，turn 失败 | 降级（warn 含具体原因） |
| `format: 2` | 抛错，turn 失败 | 降级 |
| 正文超过上限 | 抛错，turn 失败 | 降级 |
| `.agent` 是符号链接 | 抛错，turn 失败 | 降级 |
| `.agent/MEMORY.md` 是目录 | 抛错，turn 失败 | 降级 |
| 调用方 abort | 传播 | **仍然传播**（未被吞掉） |
| 正常 memory | 注入 | 注入（无过度修正） |

### C4. 首次会话完全看不到 Project Memory（policy 被“有内容”门控）—— 已修复

**现象**（用户实测）：在全新工作区开启第一个 session，system prompt 里**完全没有**任何 Project Memory 相关文本，模型不知道要去查 `.agent/MEMORY.md`，也不知道没有记忆时应该由自己创建第一份。

**根因**：`renderProjectMemory()` 开头是 `if (snapshot.content.length === 0) return ''`，于是 `addProjectMemorySection()` 在 `text.length === 0` 时直接跳过注入。**policy 文本被“是否有记忆内容”门控了**——而全新工作区必然命中这条路径。这直接违背 `PROJECT_NOTEBOOK.md:268-278` 的设计：那里是 `<PROJECT_MEMORY>` 与 `<PROJECT_MEMORY_POLICY>` **两个**块，policy 描述的是“如何维护记忆”，本来就不该依赖内容存在。

复现（修复前）：

```
--- no MEMORY.md (fresh workspace) ---
""
--- with MEMORY.md ---
"<PROJECT_MEMORY revision=\"1\">\n# P\n\nFacts.\n</PROJECT_MEMORY>\n\n<PROJECT_MEMORY_POLICY>\n..."
```

讽刺之处：**唯一能 bootstrap 这个工作区的会话（第一个），恰恰是唯一学不到这套机制的会话。**

**修复**（`src/prompt-provider.ts`）：

1. policy 改为**无条件注入**；只有 `<PROJECT_MEMORY revision="N">` 内容块按有无内容决定是否出现。
2. 把 policy 重写得更可操作：说明 memory 是什么/不是什么、快照已是最新且可信、如何用 `project_memory_update` 维护、以及优先级边界。
3. 无记忆时追加 `POLICY_NO_MEMORY`：说明“快照记录时本工作区尚无持久记忆，很可能这是首次会话”，并指示**在真正探索过工作区之后**用 `base_revision 0` 创建第一份。
4. 因为快照在本会话内固定，bootstrap 后该段仍会显示“尚无记忆”，所以补充一句：再次写入前先用 `project_memory_read` 确认，不要重复创建本会话已记录的内容。

修复后，全新工作区第一个 session 收到的注入内容：

```
<PROJECT_MEMORY_POLICY>
Project Memory (<workspace>/.agent/MEMORY.md) caches reusable, project-level knowledge across sessions: ...
The snapshot above, when present, is already the current persistent memory. Treat it as the trusted baseline: ...
Record new knowledge with project_memory_update: submit base_revision from the most recent project_memory_read, ...

No persistent memory was recorded for this workspace when this snapshot was taken, so this is most likely a first session here.

Once you have learned stable, reusable knowledge about this project, create it with project_memory_update using base_revision 0 and the complete Markdown body. Do that after you have actually explored the workspace — not before.

This snapshot stays fixed for the whole session, so it keeps saying this even after you have written the file. Check with project_memory_read before writing again; do not re-create memory that this session already recorded.
</PROJECT_MEMORY_POLICY>
```

**关于“是否应该注入 policy”的设计取舍**：另一种做法是把“这是首次会话、请创建记忆”塞进 `project_memory_read` 或工具的 description。没有采用，原因有二：一是设计文档明确要求 policy 进入 system prompt；二是只在工具描述里说明，模型仍不知道该用这个机制——它得先想到去调那个工具。policy 无条件注入后，每次 assembly 都保证模型知道这套机制存在。

**未改变的行为**：工作区无法解析（无 cwd、目录不存在）或 memory 文件被拒绝（格式错误、超长、符号链接）时，仍然**不注入**并记 warning（C3）。此时连快照都拿不到，policy 会去承诺一个插件无法确认的工作区，保持降级更诚实。

验证：`.audit/c2-c3-verify.mjs` 40/40，其中“首次会话”专项 6 项（policy 注入、bootstrap 引导齐全、无空 revision 块、过 `renderPrompt`、`base_revision 0` 首次写入成功、后续 assembly 切换为内容块）；`.audit/fresh-session-prompt.mjs` 打印实际注入文本；0.1.6-alpha.2 真实运行时冒烟 **13/13**（含“全新工作区注入 bootstrap policy”）。

---

## 二、中等问题

### M1. `file:` 安装会引入插件自己的 `@deepseek-ai/dsh-tools` 副本（版本偏斜风险）

`lib/tools.js:1` 运行时 `import { defineTool } from '@deepseek-ai/dsh-tools'`。作为 `file:` 依赖直连本仓库时，Node 会沿真实路径从本仓库的 `node_modules` 解析，那里是 **0.1.5-rc.2**，而 Desktop 运行时是 **0.1.6-alpha.2**。`peerDependencies` 同样限定 `^0.1.5-rc.2`。

`defineTool` 只是产出普通对象，`ctx.tools.register()` 的检查（`dsh-tools/lib/index.js:2872-2881`）在新版本中依然宽松，所以**可能**能跑；但我已用一个探针（`.audit/schema-probe.mjs`）确认两个版本的 `defineTool` 对插件当前 schema 形状都接受（`oneOf`/`enum`/`additionalProperties` 均合法），却无法排除 Cordis/Service 实例不同源带来的隐患。若插件被注册和查询落在不同模块副本上，表现为“工具静默不出现”。

建议：把 `devDependencies`/`peerDependencies` 对齐到目标运行时（当前 Desktop 是 `0.1.6-alpha.2`），并在烟测中确认 `dsh --profile web --dump-config` 里插件行存在且工具在会话中可见。

### M2. `withLock` 之前就把 `.agent` 建出来了，`unchanged` 路径会留下空目录

`src/memory-store.ts:79` 先 `resolveMemoryPaths(workspaceRoot, true)`（会 `mkdir .agent`），再进锁；如果第一次 update 传入空 content（`baseRevision: 0`），会走到 `:87` 的 `unchanged` 直接返回——**既没有创建 MEMORY.md，又留下了空的 `.agent/`**（已复现，`.audit/runtime-harness2.mjs` 第 H 项）。与 README 第 56 行“Reads do not create `.agent` or `MEMORY.md`; the first effective update does”的措辞存在偏差。

建议：把 `.agent` 的创建推迟到真正要写入之前，或在 `unchanged` 且目录是本次新建时回滚（`rmdir`，忽略 ENOTEMPTY）。

### M3. `MemoryUpdateRequest.reason` 是死字段

`src/memory-store.ts:20` 定义、`src/tools.ts:109` 传入，**从未被使用**。README 也说“not stored”。要么删掉、要么落进日志/审计。

### M4. 刷新与 replaceGeneration 变更竞争时，`ensure()` 语义略可疑

`src/snapshot-manager.ts:54-62`：`ensure()` 只在 `current.surfaceGeneration !== 当前代` 时重载。`enqueueLoad()`（`:72-91`）在 `await store.read()` 之后才捕获 `replaceGeneration`。因此：

- 若 replace 发生在 read 过程中，快照会记录**新**代但内容是旧读取——下一次 `ensure()` 不会再刷新（代已一致）。要等再下一次 replace 才纠正。窗口极小（读一个 48KB 文件的时间），但语义上确实存在“代与内容不匹配”。
- 快速连续三次 `ensure()` 会各自排一次读（harness 里观察到 3 个不同 Promise 对象，最终都收敛到同一 revision）。`loads` 的串行化保证了不丢数据，但有重复 I/O。

建议：在 `enqueueLoad` 中先捕获 `const generation = agent.session.surface.replaceGeneration`，read 完再比对；若已变化则重读或直接记为该代。

### M5. 快照固定 + `read` 不刷新 ⇒ 模型的工作副本可能落后

按规格这是有意的（避免因果倒置）。实践上意味着：A 会话更新到 rev N+1 后，**同一会话**的模型仍看到 rev N，除非显式 `project_memory_refresh` 或发生压缩。而压缩是自动的、可能很久不发生。中间这段时间模型基于旧画像工作。

另外 `project_memory_update` 的默认返回里带了 `snapshot_revision`（`src/tools.ts:115`），这是唯一的提示，容易被忽略。建议在 update 成功时明确告诉模型“本次快照仍为 rev N，如需立刻生效请调用 refresh”，或在工具描述里强调。

### M6. 每个 prompt assembly 都做一次 `realpath`/`resolveWorkspaceRoot`

`src/index.ts:29` → `snapshots.ensure()`，命中缓存时代价只是一串 getter；未命中或代变化时会 `resolveWorkspaceRoot()`，其中包含 `lstat` + `realpath`。在长会话 + 多次压缩下是重复的系统调用。可接受，但值得在 V2 里缓存“工作区根 → 已校验”的结果（注意这会削弱符号链接检测的即时性）。

### M7. 锁的健壮性上限

- `staleLockMs` 默认 30s，长于默认 `lockTimeoutMs`（5s），所以在默认配置下不会误抢活跃锁；但如果用户调大 `lockTimeoutMs` 或调小 `staleLockMs`，就可能出现两个写入者同时进入临界区。好在 `baseRevision` CAS 仍然阻止丢更新（后到者得到 `conflict`），只是错误信息会从 `LOCK_TIMEOUT` 变成 `conflict`。建议在 `resolveConfig` 里校验 `staleLockMs > lockTimeoutMs`。
- `wait()`（`src/memory-store.ts:32-43`）每次重试都 `addEventListener('abort', ...)` 且从不 `removeEventListener`，最多约 8 次重试 → 8 个监听器，无实际危害，但可顺手清理。

### M8. 注入位置是“在 persona-suffix 之前”，而 `assembled.sections` 已定型

`src/prompt-provider.ts:24-29` 在 `next()` 之后直接改数组并 `splice` 到 `deployment:persona-suffix` 前。这**跳过了**“按 order 数值排序”的规范化（`AssembleContext` 文档明确 order 才是权威）：如果另一个监听器在 waterfall 中往同一 assembly 里插入了 order 介于中间的小节，memory 段会排到它后面。当前只改自己的数组、且插在固定锚点前，实际结果稳定（harness 已确认位置正确），但这是“位置靠运气”的实现。建议显式注册一个带 `order` 的 section（`systemPrompt.section({name, order, text})`）而不是在 waterfall 里手工 splice，可由 DSH 负责排序。

### M9. 全局监听器 vs scope 语义

`src/index.ts:24` 的 `ctx.on('system-prompt/assemble', ...)` 是**全局**监听器，因此：

- 对任何 agent（含子 agent、诊断性 assembly）都会触发一次 memory 读取；`agent === undefined` 时已正确跳过（`:27`）；
- 对“由 complete section 拥有提示词”的 assembly 也会计算并插入 section，而 DSH 之后会把 complete section 还原为唯一 section（harness 已复现 `["deployment:complete","project-memory:snapshot"]`），即这次读取与插入是**纯浪费**，且如果该 scope 的 workspace 有问题就会**凭空**打断这个 assembly。

建议：在监听器里判断作用域/是否 complete 后再决定是否加载；或把 section 改为 DSH 的 scoped 注册方式。

---

## 三、低风险 / 观察项

- **L1 注入边界可被伪造**：正文里出现 `</PROJECT_MEMORY>` 或 `<PROJECT_MEMORY_POLICY>` 字面量即可打乱边界。memory 是 workspace 内文件，恶意程度有限，但 `PROJECT_MEMORY` 段落在提示词靠后位置，内容又能被模型当作指令读，正规做法是转义或改用明确的非 XML 边界 + 说明。
- **L2 每次 update 需要模型重发完整正文**：`project_memory_update` 要求提交“完整维护后的 body”（`src/tools.ts:75-79`）。48KB 上限下这是可观的 token 成本。规格里的 “Minimal Update” 由模型自觉遵守，工具层没有约束。V2 可考虑 section 级 patch 操作（`replace_section` / `remove_section` / `append_section`），保留 `content` 作为兜底。
- **L3 `.agent/MEMORY.md` 会出现在工作区文件列表/grep/todo 之外的各种扫描里**：README 未提示。文件本身不大，但用户可能意外把它当作普通源码处理。
- **L4 `parameters: {}` 允许任意多余参数**：`project_memory_read` / `project_memory_refresh` 的参数根是隐式开放对象（`additionalProperties` 缺省为 true）。模型传垃圾参数不会报错，只是被忽略。加一条 `additionalProperties` 语义说明或干脆接受（DSH 侧无校验入口）。
- **L5 输出里 `content` 重复**：`read`/`update`/`refresh` 都把完整正文 JSON 化返回。`update` 返回 `content` 有用于“确认写入结果”，但会让工具结果翻倍。可考虑让 `update`/`refresh` 只回 `revision + changed`。
- **L6 `test` 脚本在受限 sandbox 下无法运行**：`vitest` 默认 fork worker，需要管道 stdio；本机 sandbox 下报 `Error: spawn EPERM`。这不是代码问题，但会在受限环境里造成“测试挂了”的误判。可在 `vitest.config.ts` 里 `pool: 'threads'` 或文档注明。
- **L7 兼容性声明**：已更新 README（原写 “`0.1.5-rc.2` compatible API line”，现改为双线验证说明）。详见 §七。
- **L8 `src/tools.ts:99,138` 的 `isConcurrencySafe: () => false` 签名**：DSH 的接口是 `(args) => boolean`（`DefineToolOptions` 第 201 行）。TS 允许少参数，功能正确，写全参数更清晰。
- **L9 测试覆盖缺口（部分已补）**：
  - ~~没有测试覆盖 `renderPrompt()` 会作用在注入后的 assembly 上~~ → 已在 `tests/prompt-provider.test.ts` 用真实 `renderPrompt` 补齐（6 种正文形态）；
  - ~~没有 integration 测试覆盖 `ctx.tools.register`~~ → `tests/assemble-guard.test.ts` 覆盖注册 + 监听器 + 降级；`defineTool` 产出形状仍只有 §七 的跨版本探针，未进仓库；
  - `tests/snapshot-manager.test.ts:23` 用 `as unknown as Agent` 手搓 session，绕过了真实类型检查，`firstLiveSeq` 的 resume 分支没有被测到；
  - 缺 `path-policy`（真实符号链接、`PATH_ESCAPE`）、`lock`（超时/陈旧恢复）的专项测试（Windows 上符号链接用例会直接 `EPERM` 跳过，实测如此）。

---

## 四、与设计规格（PROJECT_NOTEBOOK.md）的符合度

| 规格 | 实现 | 结论 |
| --- | --- | --- |
| Project-scoped（绑定 workspace） | `agent.session.header.cwd` → `<cwd>/.agent/MEMORY.md` | 符合 |
| Persistent Memory + Session Snapshot | `ProjectMemoryStore` + `SnapshotManager`（`WeakMap<Agent, snapshot>`） | 符合 |
| Snapshot 默认固定 | `update` 不改快照；`ensure` 仅在代变化时重载 | 符合 |
| Snapshot + Refresh（resume / compaction / 显式） | `firstLiveSeq > 0` → `resume`；`replaceGeneration` 变化 → `surface-replacement`；`project_memory_refresh` | 符合（细节见 M4） |
| Revision-based，每次有效修改 +1 | `serializeMemoryFile(nextRevision, ...)`，内容未变返回 `unchanged` | 符合 |
| Trusted by default / Direct evidence wins | `POLICY` 文本 + `cannot override higher-priority instructions` | 符合 |
| 自由 Markdown + frontmatter（format/revision） | `memory-format.ts`，legacy 无 frontmatter 视为 rev 0 | 符合 |
| 最小化更新、串行 read-modify-write、基于磁盘最新状态 | 锁 + 基于 `readAt` 的 CAS；但要求模型重发完整正文（L2） | 基本符合 |
| 三个工具 read/update/refresh | 已实现，语义与文档一致（harness 已逐一验证） | 符合 |
| System Prompt 注入 + Policy | `<PROJECT_MEMORY revision>` + `<PROJECT_MEMORY_POLICY>`，正文花括号对改写为 `{ {` | 符合 |
| 不做外部变化自动刷新 | 确实未实现 | 符合 |

---

## 五、版本兼容性（0.1.6-alpha.2 能否安装）

### 结论

**可以。** 我用 Desktop 真实的 `0.1.6-alpha.2` 包（`dsh-tools`、`dsh-system-prompt`）直接加载构建产物并跑完整流程，**11/11 全部通过**：

```
runtime under test: dsh-tools 0.1.6-alpha.2, dsh-system-prompt 0.1.6-alpha.2

PASS  plugin entry loads under the 0.1.6 runtime
PASS  runtime defineTool is reachable from the same module instance
PASS  all three tools register on the 0.1.6 ToolRuntime contract
PASS    schema accepted by the 0.1.6 runtime: project_memory_read / _update / _refresh
PASS  assembly injects the snapshot on the 0.1.6 runtime
PASS  real 0.1.6 renderPrompt accepts the injected section
PASS  project_memory_read / _update / _refresh execute on the 0.1.6 runtime
```

加载方式：把 Desktop 的 `@deepseek-ai/{dsh-tools,dsh-system-prompt,cordis,schemastery}` 做成 junction 放进一个临时 `node_modules`，再 `import('./plugin/lib/index.js')`，这样插件的裸导入与 `defineTool` 落在**同一个模块实例**上。脚本见下方附录。

### 插件实际依赖的 API，以及两条线的状态

| 插件用到的 API | 位置 | 0.1.5-rc.2 | 0.1.6-alpha.2 |
| --- | --- | --- | --- |
| `system-prompt/assemble` waterfall（`(assembly, context, next)`） | `src/index.ts:24` | 有 | 有 |
| `context.agent`（`AssembleContext` 增强） | `src/index.ts:26` | 有（`dsh-agent/lib/types/runtime-types.d.ts:14-18`） | 有（`assembleContextFor` 注入 `{agent, scope, signal}`） |
| `Context.tools.register(definition)` | `src/tools.ts:31` | 有 | 有（`ToolRuntime.register`，检查 `output.schema`） |
| `defineTool` / 输出 schema 子集 | `src/tools.ts` | 接受 | 接受（`oneOf`/`enum`/`additionalProperties` 均在受支持子集内） |
| `Agent.session.header.cwd` | `src/snapshot-manager.ts:18` | 有 | 有（`dsh-tool-fs` 同款用法） |
| `Agent.session.firstLiveSeq` | `src/snapshot-manager.ts:60` | 有 | 有 |
| `Agent.session.surface.replaceGeneration` | `src/snapshot-manager.ts:56` | 有 | 有 |
| `interpolate: false`（**未使用**） | — | **无**，`assemble()` 只构造 `{name, text}` | 有，`assemble()` 会转发 |

最后一行就是为什么 C2 选择改写文本而不是用 `interpolate: false`：如果用了该标志，`0.1.6-alpha.2` 上正常，`0.1.5-rc.2` 上标志被丢弃、`{{...}}` 依旧抛错。

### 但有一条安装层面的版本风险需要处理（M1 的实证）

`peerDependencies` 目前是 `^0.1.5-rc.2`。按 npm/pnpm 的 semver 规则，**预发布版本不匹配不含同版本号的 range**，所以：

```
^0.1.5-rc.2  与  0.1.6-alpha.2   →  不匹配（range 里没有 0.1.6-alpha.2 这个预发布号）
```

后果分两种情况：

- **Desktop profile 内安装（推荐路径，当前可行）**：profile 目录里 `@deepseek-ai/dsh-agent` 等已经是安装自带的 `0.1.6-alpha.2` 实体，`file:` 安装不会再去 registry 解析这些 peer，Node 从 profile 的 `node_modules` 逐级向上就能找到。实测 11/11 通过，说明这条路可用。
- **从 registry 安装到一个干净环境**：pnpm 会尝试按 `^0.1.5-rc.2` 去解析，落到 npm 上并不存在的 `0.1.5-rc.2` 系列（这正是交接单里 CLI 自身安装失败的同源问题），于是装不上。

建议（按优先级）：

1. 把 `devDependencies` 对齐到你打算长期支持的版本（当前 Desktop 是 `0.1.6-alpha.2`），这样类型检查对着真实目标面；
2. 把 `peerDependencies` 放宽到能同时接受两条线，例如 `>=0.1.5-rc.2`（或 `>=0.1.5-rc.2 <0.2.0`）；保留 `^0.1.5-rc.2` 会在 registry 安装路径上挡掉你的 Desktop；
3. 若确定只服务 Desktop，直接把 peer 写死为 `0.1.6-alpha.2` 最省事，但会失去对 rc.2 线的兼容声明。

**另外，首次烟测请用 `pnpm add file:...`（或正式发布后 `pnpm add dsh-project-memory`），不要用 `link:` 指向本仓库。** 本仓库的 `node_modules` 里是 `0.1.5-rc.2`；`link:` 会让 Node 沿真实路径向上解析，从而加载插件自带的 `dsh-tools@0.1.5-rc.2` 与 `schemastery@3.18.2` 副本，与运行时的同名服务不同源。`file:` 会把包实体放进 profile 的 `node_modules`，解析到共享副本。

---

## 六、烟测手册

### 0. 前置

C1 已修复（`package.json` 的 `dsh.bundle` 现为对象形式），C2/C3 已修复并构建。开始前确认当前构建是最新的：

```powershell
cd <本仓库>
pnpm build
```

### 1. 选择测试用的 DSH CLI

| 方式 | 说明 |
| --- | --- |
| **A. 用 Desktop 自带的 `dsh`（推荐先做这个）** | 当前环境里 `dsh --version` = `0.1.6-alpha.2`，`Get-Command dsh` 会指向 Desktop 应用自己的启动包装。这是唯一立即可用、且和 Desktop GUI 同版本的 CLI。 |
| B. 装 npm 上的 `@deepseek-ai/dsh@0.1.5-rc.2` | 交接单所述的安装失败：该版本会解析到未发布的 `dsh-client-ui-sidebar-documentpreview@^0.1.5-rc.3`。可用 `pnpm.overrides` 强制成已发布版本（见第 13 步），但没必要——它比 A 更旧。 |
| C. 直接给 Desktop GUI 的 profile 装插件 | 等价于 A，只是入口是 GUI 的插件管理界面（`dsh-client-ui-settings-plugins`）。 |

需要注意：**插件本地 `node_modules` 里的 `@deepseek-ai/*` 是 `0.1.5-rc.2`，profile 里的是 `0.1.6-alpha.2`**（见 §M1）。第一次烟测务必用 `pnpm add file:...`（不是 `link:`），让它解析到 profile 里的共享副本。

### 2. 安装并确认 profile 已被改写

```powershell
dsh plugin --profile web add file:<本仓库绝对路径>
```

判定标准（成功与失败的差别很明确）：

- **成功**：输出里出现 pnpm 的 `+ dsh-project-memory 0.1.0`，且 profile 的 `package.json` 出现
  `"dependencies": { "dsh-project-memory": "file:..." }` 与
  `"dsh": { "profile": { "bundles": [ ...,"dsh-project-memory" ] } }`。
- **失败（C1 修复前的表现，现已不会出现）**：`dsh: profile bundle "dsh-project-memory" declares no dsh.bundle in its package.json`，
  或插件管理器报 `not-bundle`，并且 `package.json` / `pnpm-lock.yaml` 被回滚。若现在仍看到这条，说明安装的是修复前的旧包（检查 `package.json` 里 `dsh.bundle` 是否为对象，或 profile 内是否缓存了旧副本）。

profile 目录可通过下面命令定位：

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'project-memory' -Context 2,4
```

期望看到插入行：

```yaml
- id: project-memory
  name: dsh-project-memory
```

`--dump-config` 只证明配置树里的行存在；**它不证明模块能被加载**。请继续第 3 步。

### 3. 准备一个干净的烟测工作区

```powershell
$ws = "$env:USERPROFILE\dsh-memory-smoke"
Remove-Item -Recurse -Force $ws -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ws | Out-Null
Set-Content -Path "$ws\README.md" -Value "# Smoke workspace`n`nA tiny project used to test Project Memory."
New-Item -ItemType Directory -Path "$ws\src" | Out-Null
Set-Content -Path "$ws\src\index.js" -Value "export const answer = 42"
```

**关键**：用这个工作区新建一个会话（GUI 里选目录，或用 CLI 的对应入口）。`cwd` 必须是它。

### 4. 用例 R1 — 首次会话必须看到 Project Memory 机制（C4 回归）

提问：

```
这个项目是做什么的？请先只回答你已知的信息，不要读取任何文件。
```

判定：

- 会话正常出第一轮回答（**没有 `agent/error`**）；
- 工作区内**没有** `.agent/` 目录（`Test-Path $ws\.agent` 为 `False`）——读取不创建目录；
- **system prompt 里必须出现 `<PROJECT_MEMORY_POLICY>`**，且包含“first session”“`base_revision 0`”这类引导。这是 C4 修复的核心，修复前这里**什么都没有**。

若要看注入的原始文本而不依赖模型转述，直接跑：

```powershell
node .audit/fresh-session-prompt.mjs
```

### 5. 用例 R2 — 首次会话按引导创建第一份 MEMORY.md

提问：

```
请先熟悉这个工作区，然后把值得跨会话复用的项目认知记录下来。
```

判定：

- 模型先探索（`list_dir`/`read_file`/`grep` 等），**然后**调用 `project_memory_update`，且 `base_revision: 0`；
- 工具返回 `status: updated`、`previous_revision: 0`、`persistent_revision: 1`；
- 返回里 `snapshot_revision` 仍为 `0`（**规格行为**：update 不改当前快照）；
- 盘上文件正确：

```powershell
Get-Content "$ws\.agent\MEMORY.md"
```

```
---
format: 1
revision: 1
---
```

- **同一会话继续追问时**，模型不应反复重建：由于快照固定，system prompt 仍显示 bootstrap 变体，但引导里写了“写前先用 `project_memory_read` 确认”，所以再次写入应得到 `status: unchanged` 或先 `read` 再决定。

### 6. 用例 R3 — snapshot 固定：同一会话里 prompt 仍用旧 revision

在同一会话继续提问：

```
只回答：你的 <PROJECT_MEMORY> 段落里标注的 revision 是多少？不要调用任何工具。
```

判定：回答是 `0`（或“没有该段落”，因为 rev 0 时正文为空 → 不注入内容块）。**都不是 `1`**。

然后：

```
调用 project_memory_refresh，然后告诉我现在 <PROJECT_MEMORY> 的 revision。
```

判定：`snapshot_revision: 1`、`changed: true`；之后系统提示词里出现 `<PROJECT_MEMORY revision="1">` 且含刚才写入的事实，同时 bootstrap 引导消失。

### 7. 用例 R4 — 跨会话继承（插件的核心价值）

**新建**一个会话（同一工作区），问：

```
不使用任何文件读取工具，直接根据已有项目记忆回答：这个项目的入口文件是哪个？
```

判定：回答命中 `src/index.js`，且 agent 没有为了回答而 `list_dir`/`read_file`。这是“Trust by default”是否生效的直接证据。

### 8. 用例 R5 — 冲突保护（两个会话抢写）

1. 会话 A：`project_memory_read` → 记下 revision（假设 N）。
2. 会话 B：`project_memory_read` → 同样是 N；B 调 `project_memory_update(base_revision=N, ...)` → 成功，rev 变 N+1。
3. 回到会话 A：用**过期的** N 调 `project_memory_update(base_revision=N, ...)`。

判定：A 得到 `status: conflict`，`persistent_revision: N+1`，且返回内容是最新的（B 写的那版），**没有被覆盖**。磁盘上 revision 仍为 N+1。

### 9. 用例 R6 — 外部改动 → `is_snapshot_stale`

在 DSH 之外直接改文件：

```powershell
# 手工把 revision 改成 9（保持 format: 1）
(Get-Content "$ws\.agent\MEMORY.md") -replace '^revision: \d+$', 'revision: 9' |
  Set-Content "$ws\.agent\MEMORY.md"
```

然后在新会话（或刷新后）调 `project_memory_read`：

判定：`persistent_revision: 9`，并且如果该会话之前已加载过快照，`is_snapshot_stale: true`。

### 10. 用例 R7 — 格式/安全边界（只失败这一件事，不打断会话）

| 输入 | 期望 | 实测（C2/C3 修复后） |
| --- | --- | --- |
| `MEMORY.md` 有重复键（两行 `revision:`） | 不注入 + 记 warn，会话继续 | 降级通过 |
| `format: 2` | 不注入 + 记 warn，会话继续 | 降级通过 |
| 正文含 `{{variable}}` | 正常注入，正文中的花括号对被改写为 `{ {` | 渲染通过 |
| 正文含 `{{ matrix.os }}`（GitHub Actions 写法） | 同上 | 渲染通过 |
| 正文含 `</PROJECT_MEMORY>` | 边界不被伪造成新段落 | 仍可被伪造（L1，未修） |
| `.agent` 为指向别处的符号链接 | `SYMLINK_DENIED`，不读不写；会话继续 | 降级通过 |
| `.agent/MEMORY.md` 是目录 | 不注入，会话继续 | 降级通过 |
| 工作区目录不存在 / session 无 cwd | 不注入，会话继续 | 降级通过 |

### 11. 用例 R8 — 压缩后刷新（Snapshot + Refresh 的 compaction 分支）

1. 在一个会话里把 memory 升到 rev N，确认快照是 N。
2. 在**另一个**会话把 memory 升到 N+1。
3. 回到会话 A，用 GUI 的压缩命令（`/compact` 或 `dsh-command-compact` 对应入口）触发上下文压缩。
4. 压缩完成后的**下一次**模型步，问：`你的 <PROJECT_MEMORY> revision 是多少？`

判定：是 N+1（代码依据：`src/snapshot-manager.ts:56-61` 用 `surface.replaceGeneration` 判定；真实运行时 `assemble()` 在 `agent/pre-step` 压缩之前，所以刷新发生在**下一次** assembly 边界，README 第 70 行的描述与此一致）。

### 12. 用例 R9 — 卸载可干净回滚

```powershell
dsh plugin --profile web remove dsh-project-memory
dsh --profile web --dump-config | Select-String 'project-memory'   # 应无输出
```

判定：profile 的 `package.json` 中依赖与 `dsh.profile.bundles` 都被清理，且 `$ws\.agent\MEMORY.md` **仍然存在**（数据属于工作区，不属于插件生命周期）。

### 13. 可选：绕开 `0.1.5-rc.2` 的 peer 解析问题（方式 B）

只在你想复现交接单里那条失败路径时用。在**目标 profile 目录**（不是本插件仓库）加 `pnpm.overrides`，把未发布的包钉到已发布版本：

```json
{
  "pnpm": {
    "overrides": {
      "@deepseek-ai/dsh-client-ui-sidebar-documentpreview": "0.1.5-rc.2"
    }
  }
}
```

再在 profile 内 `pnpm install`。若 `0.1.5-rc.2` 也不存在，去 npm 查该包真实已发布版本再钉。**更省事的选择是直接用方式 A**，因为当前 Desktop 自带 `0.1.6-alpha.2`，不存在这个缺包问题。

---

## 七、建议的后续顺序

1. ~~C1~~ 已修复。
2. ~~C2 + C3~~ 已修复（§一）。烟测 R7 现在应全部是“降级而不中断”。
3. **M1 / §五**：把 `peerDependencies` 放宽（如 `>=0.1.5-rc.2`）或对齐到 `0.1.6-alpha.2`，否则从 registry 安装到干净环境会被 range 挡掉。
4. **M2/M3**（`.agent` 空目录、死字段），顺手清理。
5. **M4/L9**（补 `firstLiveSeq` resume 分支、`path-policy`、`lock` 的测试；把 §附录 的跨版本 `defineTool` 探针搬进 `tests/`）。
6. 其余 M/L 项按 V2 规划。

---

## 附：本次审查使用的临时脚本（`.audit/` 不在 `files` 里，不会被 `pnpm pack` 打进去）

- `.audit/runtime-harness.mjs` —— 用真实 `dsh-tools` 注册并执行三个工具、跑 waterfall 注入、验证快照 fixed/refresh/conflict 与降级行为（16/16）。
- `.audit/runtime-harness2.mjs` —— 用真实 `renderPrompt` 验证注入文本；并发 `ensure()`、压缩代变化、空更新、legacy 升级、超长文件、重复 frontmatter 等边界。
- `.audit/c2-c3-verify.mjs` —— C2/C3 专项：10 种花括号形态 × 真实 `renderPrompt`，9 种失败场景的降级行为，abort 传播（34/34）。
- `.audit/schema-probe.mjs` —— 对比 `0.1.5-rc.2` 与 `0.1.6-alpha.2` 的 `defineTool` 对插件 schema 形状的接受度。
- `.audit/bundle-manifest-check.mjs` —— 按 DSH 加载器的真实判断复现 `dsh.bundle` 被拒。

§五 的 0.1.6-alpha.2 运行时冒烟脚本放在临时目录（依赖 junction 出来的 `node_modules`，不适合入库）：
`%TEMP%\pm-runtime-016\runtime-016-smoke.mjs`，用 `node runtime-016-smoke.mjs` 运行。

已搬进正式测试的回归保护：

- `tests/prompt-provider.test.ts` —— 真实 `renderPrompt` + 6 种正文形态（C2）。
- `tests/assemble-guard.test.ts` —— 9 个降级/注入场景（C3）。
