# DSH\-WORKSPACE\-MEMORY Plugin 开发

## 设计构想：

### 一、Project Memory 插件的目的

这个插件的目标不是保存用户画像，也不是单纯保存历史对话，而是：

> **在一个固定 Workspace / Project 范围内，持续维护一份紧凑、可复用、相对最新的“项目认知”，使 Agent 在不同 Session 之间能够继承之前已经付出探索成本获得的知识。**
> 
> 

假设 Workspace 是：

```Plain Text
project/
├── src/
├── tools/
├── README.md
└── .agent/
    └── MEMORY.md
```

Session A 为了完成 README 修改，已经通过：

```Plain Text
list_dir
read_file
grep
read package.json
read config
...
```

知道了：

```Plain Text
项目是什么
主要模块是什么
目录职责是什么
使用什么构建工具
关键架构是什么
开发约定是什么
```

Session B 虽然做的是完全不同的任务：

```Plain Text
检查 tools/ 下代码规范
```

但 Session B 不应该再次从零开始：

```Plain Text
重新 list root
重新读 package.json
重新理解项目结构
重新确认主要模块
...
```

而是：

```Plain Text
Session A 的项目探索
        ↓
Project Memory
        ↓
Session B 直接继承
```

所以这个插件真正缓存的是：

> **Agent 已经获得过的 Workspace Understanding。**
> 
> 

可以把它看成一种：

```Plain Text
Persistent Workspace Understanding
```

或者更工程化一点：

```Plain Text
Semantic Cache for Project Understanding
```

它缓存的不是某个工具调用的 raw result，而是那些工具调用最终形成的、跨任务仍然有价值的项目知识。

## 设计原则：

我把我们目前确定的原则压成一版：

1. **Project\-scoped**：Memory 绑定 Workspace，而不是用户或单个 Session。它保存跨 Session 可复用的项目认知。 

2. **Persistent Memory \+ Session Snapshot**：`.agent/MEMORY.md` 是最新持久状态；每个 Session 使用一个自己的 Memory Snapshot。 

3. **Snapshot 默认固定**：Memory 更新不会自动重写当前 Session 已加载的 Snapshot，避免因果倒置、重复上下文和频繁 System Prompt 改变。 

4. **Snapshot \+ Refresh**：在 Context Compaction、Session Resume、显式 Refresh，或当前 Session 未参与的重要 Memory 外部变化发生时，重新载入最新 Snapshot。 

5. **Revision\-based**：MEMORY\.md 每次有效修改 revision \+ 1；Snapshot 同样记录所加载的 revision。不要求 timestamp。 

6. **Trusted by default**：Project Memory 默认作为可信背景使用，Agent 不应为了验证 Memory 而重复探索项目。 

7. **Direct evidence wins**：如果当前任务自然获得的 Workspace 直接证据与 Memory 冲突，使用直接证据，并修正 Memory。 

8. **Knowledge, not changelog**：Memory 只保存对未来 Session 有复用价值的项目认知，不记录所有代码修改。 

9. **Maintain, not append**：Memory 是“当前项目画像”，旧事实发生变化时应该修改或删除，而不是不断 append 互相冲突的历史事实。 

我认为这九条已经可以作为这个插件的 **核心规格**。



## 图：

```Markdown
Project Workspace
                           │
                           ▼
                 .agent/MEMORY.md
                  Persistent Memory
                    revision = N
                           │
                           │ Session Start
                           ▼
                   Memory Snapshot
                    revision = N
                           │
                           ▼
                    System Prompt
                           │
                           ▼
                         Agent
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       Normal Workspace Work       Use Memory directly
             │
             ▼
       New Project Knowledge
       / Project State Change
             │
             ▼
       Is it reusable project
           knowledge?
             │
        ┌────┴────┐
       NO        YES
        │          │
        │          ▼
        │     Update MEMORY.md
        │      revision N+1
        │
        └──────────┐
                   │
                   ▼
          Current Snapshot remains N
                   │
                   ▼
            Continue Session


             Refresh Trigger
                   │
       ┌───────────┼────────────┐
       │           │            │
 Compaction     Resume     Explicit Refresh
       │           │            │
       └───────────┼────────────┘
                   ▼
            Read latest Memory
                   │
                   ▼
           Snapshot = latest rev
```

## 怎么设计：

### Memory Loader / Snapshot Manager

负责：

```Plain Text
Workspace 定位
↓
读取 .agent/MEMORY.md
↓
解析 revision
↓
创建 Session Snapshot
↓
给 System Prompt Provider 提供内容
```

同时维护：

```Plain Text
snapshotRevision
snapshotContent
```

### Memory Store

负责真正操作：

```Plain Text
.agent/MEMORY.md
```

提供类似：

```Plain Text
read()
update()
getRevision()
```

同时保证：

```Plain Text
每次有效写入
revision + 1
```

### Memory Tools

至少需要三个能力：

```Plain Text
project_memory_read
project_memory_update
project_memory_refresh
```

其中：

```Plain Text
read        让 Agent 必要时主动检查最新持久 Memory；
```

```Plain Text
update    用于沉淀新项目知识或修正旧知识；
```

```Plain Text
refresh    用于把最新 MEMORY.md 替换为当前 Session Snapshot。
```

> `update` 应该提交一个“Memory mutation request”，再由 Memory Manager 负责 merge
> 
> 

让你的 Memory 模块真正成为一个独立系统，而不是单纯暴露 `write_file(MEMORY.md)`。

### Memory System\-Prompt Provider

负责读取：

```Plain Text
SessionMemorySnapshot
```

然后生成：

```Plain Text
<PROJECT_MEMORY revision="N">
...
</PROJECT_MEMORY>

<PROJECT_MEMORY_POLICY>
...
</PROJECT_MEMORY_POLICY>
```

并负责将该部分内容并入到System\-Prompt中。（常用于一个项目下非第一个的新session开启时，将MEMORY\.md中的内容注入到system prompt中）





## 设计内容补充

## V1 设计补充

### Workspace 与 Memory 归属

Project Memory 直接绑定当前 DSH Workspace。DSH 已能够确定当前工作区目录，因此无需额外设计 Project Identity。

Memory 文件固定存放于：

```Plain Text
<workspace>/.agent/MEMORY.md
```

一个 Workspace 对应一份 Project Memory。

---

### MEMORY\.md 内容组织

V1 不采用固定领域 Schema，不强制要求 `Overview / Architecture / Tooling` 等预定义字段。

不同项目需要长期保存的知识类型不同，因此 MEMORY\.md 采用自由的结构化 Markdown：

```Plain Text
Section
    ↓
Content
```

具体 Section 由 Agent 根据当前项目特征动态创建、修改、删除和合并。

插件只约束 Memory 的维护原则，而不约束具体字段结构。

主要原则包括：

- **Reusability**：只记录未来其他 Session 有较高复用价值的项目知识。

- **Project\-level Knowledge**：优先保存项目结构、架构、模块职责、开发约定、重要机制等项目级认知，而非局部实现流水账。

- **Conciseness**：Memory 是项目画像，不是 Session Summary，不应复制大段源码、Tool Result 或对话内容。

- **Current State**：Memory 描述当前有效的项目状态，而不是记录项目变化历史。

- **Maintain, not Append**：旧事实失效时应修改或删除，而不是持续追加互相冲突的信息。

- **Minimal Update**：如果本次只产生少量新知识，则只修改相关 Section，避免无必要地大规模重写 MEMORY\.md。

- **Structure by Meaning**：Section 应根据项目本身的知识结构组织，而非套用固定模板。

- **Evidence\-driven Update**：只有在当前工作实际产生新的可复用项目认知，或项目状态发生相关变化时才更新 Memory。

---

### Memory 更新方式

V1 不额外设计复杂的 Memory Mutation Protocol。

由 Main Agent 自主判断何时获得了值得跨 Session 保存的项目知识，并通过 `project_memory_update` 直接维护 MEMORY\.md。

V1 不通过 Session Event 自动抽取 Memory，也不额外运行独立的 Memory Extraction Agent。

Memory 更新采用串行化的 read\-modify\-write：

```Plain Text
Acquire Lock
    ↓
Read latest MEMORY.md
    ↓
Apply minimal update
    ↓
revision + 1
    ↓
Write MEMORY.md
    ↓
Release Lock
```

更新必须基于当前磁盘上的最新 MEMORY\.md 状态，而不是基于 Session 启动时加载的旧 Snapshot。

---

### Session Snapshot

Session 启动时读取最新 MEMORY\.md，并创建当前 Session 的 Memory Snapshot。

```Plain Text
MEMORY.md
    ↓
Session Start
    ↓
Memory Snapshot
    ↓
System Prompt
```

Snapshot 在 Session 内默认固定。

即使当前 Session 更新了 MEMORY\.md：

```Plain Text
MEMORY revision N
    ↓
project_memory_update
    ↓
MEMORY revision N+1
```

当前 Session 的 Snapshot 仍保持 revision N，避免：

- System Prompt 在 Session 中频繁变化；

- 最新 Memory 与历史操作产生因果顺序错位；

- 刚刚获得的信息同时出现在历史记录和 System Prompt 中，造成上下文重复。

---

### Snapshot Refresh

V1 使用 `Snapshot + Refresh` 机制。

Refresh 仅在以下情况发生：

- Session Resume；

- Context Compaction 完成后、下一次模型 Step 之前；

- Agent 显式调用 `project_memory_refresh`。

V1 暂不实现“检测 MEMORY\.md 发生重要外部变化并自动 Refresh”。

Refresh 的语义为：

```Plain Text
Read latest MEMORY.md
    ↓
Replace Session Memory Snapshot
    ↓
Update snapshot revision
    ↓
Next Model Step
    ↓
System Prompt 使用新的 Snapshot
```

对于 Context Compaction，顺序固定为：

```Plain Text
Context Compaction
    ↓
生成新的 Compacted Surface
    ↓
Compaction 完成
    ↓
Refresh Memory Snapshot
    ↓
Next Model Step
```

---

### Memory 信任策略

Project Memory 是 Agent 已经沉淀的项目认知缓存，应默认作为可信背景直接使用。

Agent 不应为了验证 MEMORY\.md 中已有的信息而重复读取文件或重新探索 Workspace，否则会违背 Project Memory 减少重复工作的设计目标。

采用以下原则：

```Plain Text
Trust by default.
Invalidate on evidence.
```

即：

- 默认相信 Project Memory；

- 不主动为了“确认 Memory 是否正确”而重复探索；

- 如果当前任务在正常执行过程中自然获得了与 Memory 冲突的直接 Workspace Evidence，则以直接证据为准；

- 冲突确认后，应更新 MEMORY\.md，使 Project Memory 恢复到最新项目状态。

因此 Memory 不是“绝对真相”，但它是默认可信的 Project Knowledge Baseline。

---

### V1 核心能力

Project Memory Plugin V1 由以下核心部分组成：

```Plain Text
Project Memory Plugin

├── Memory Store
│   └── 管理 .agent/MEMORY.md 与 revision
│
├── Snapshot Manager
│   └── 管理当前 Session 的 Memory Snapshot
│
├── System Prompt Provider
│   └── 将当前 Snapshot 注入 System Prompt
│
└── Memory Tools
    ├── project_memory_read
    ├── project_memory_update
    └── project_memory_refresh
```

其中：

- `project_memory_read`：读取当前最新的持久化 Project Memory；

- `project_memory_update`：基于最新 MEMORY\.md 进行最小化更新，并使 revision \+ 1；

- `project_memory_refresh`：将当前 Session Snapshot 刷新为最新 MEMORY\.md 状态。

