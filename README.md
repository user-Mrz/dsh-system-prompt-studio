# dsh-system-prompt-studio

[![npm](https://img.shields.io/npm/v/@user-mrz/dsh-system-prompt-studio.svg)](https://www.npmjs.com/package/@user-mrz/dsh-system-prompt-studio)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A **[DeepSeek Harness](https://github.com/deepseek-ai)** plugin that lets you inspect and override the
**system prompt** a conversation actually sends to the model — per conversation, at runtime, without
restarting.

> **This plugin ships as the scoped npm package
> [`@user-mrz/dsh-system-prompt-studio`](https://www.npmjs.com/package/@user-mrz/dsh-system-prompt-studio).**
> An unrelated, unscoped package named `dsh-system-prompt-studio` also exists on npm, maintained by
> someone else. Installing that one will **not** give you this plugin. Always install the
> `@user-mrz/`-scoped name.

DSH itself only exposes deployment-wide persona prefix/suffix in configuration files: change one and you
need a restart, and it affects every session. This plugin moves the same capability to runtime, per
session, effective immediately.

> 中文说明见文末 · [跳转到中文](#中文说明)

---

## What it does

- **See the real thing.** The panel shows the system prompt your conversation *actually sent* on its
  last request, plus the section list that was assembled for it (name / order / character count).
- **Override it three ways.**

  | Mode | Effect |
  |---|---|
  | **Append** (default) | Keeps every first-party section, adds yours at the end. Safest. |
  | **Replace a section** | Shadows one named first-party section, e.g. `deployment:persona-suffix`. |
  | **Replace everything** | Your text becomes the entire system prompt. Highest risk: drops first-party guidance **and every other plugin's sections** — see below. |

- **Applies on the next model request.** No restart, no reload.
- **Three scopes**: this conversation, **this workspace** (a directory), or the global default. Rules
  persist per session *and* per working directory.
- **Inherits across forks.** A forked conversation picks up its parent's rules along the `parentSession`
  chain, with a **Pin** action to freeze the inherited result locally.
- **Guards unsaved edits.** Esc, backdrop click and the close button all ask before discarding.
- **Zero runtime dependencies.** Only Node built-ins; it does not import any `@deepseek-ai/*` package.

### ⚠️ Before you use "Replace everything"

That mode removes **all** first-party guidance — tool instructions, structured-output rules, plan-mode
policy. Tool-calling quality can drop noticeably. Runtime context (working directory, sandbox policy,
approval policy) is still sent as a user-side snapshot and is **not** replaced by your text.

**It also removes every section other plugins registered.** This is the part that bites quietly. A
plugin's tool schema still ships, but the prose that tells the model *when and how* to call it is gone,
so the tool stays installed and unused — and nothing errors. The failure looks like "the model got
dumber", not like "I turned something off". If you run a plugin that registers prompt sections
(`plugin:ssh`, `plugin:task-board`, `team:policy`, and so on), Replace everything disables all of them
at once for that conversation.

The panel lists exactly what will be dropped before you save: every section name with its character
count, plus a separate line naming how many of them belong to other plugins. If the conversation has
not assembled a prompt yet, it says it cannot list them rather than guessing.

**Consider turning the mode off entirely.** Set `allowComplete: false` in the plugin row's config and
the mode becomes unavailable — the panel greys it out, and saving one is rejected with
`COMPLETE_BLOCKED`. Any `complete` override already in the state file stops applying and the prompt
falls back to the first-party default (the data is kept, not deleted). This is the recommended setting
for any profile running third-party plugins that contribute prompt sections.

Also: assembly allows only one active `complete` section. If another plugin registers one in the same
session, assembly fails with `multiple complete prompt sections` — and then **every** model request in
that conversation fails, while the user only sees "request failed". Switch back to Append or Replace to
recover.

---

## Requirements

- DSH `>=0.2.2-0 <0.3.0-0` (Web and Desktop share the same client artifact)
- Node.js ≥ 22.19.0

## Install

The package lives at **[npmjs.com/package/@user-mrz/dsh-system-prompt-studio](https://www.npmjs.com/package/@user-mrz/dsh-system-prompt-studio)**.
Install that scoped name — `dsh-system-prompt-studio` without the scope is a different author's package.

From npm (recommended — this is the version that gets version numbers, tags and a published tarball):

```bash
dsh plugin --profile <profile> add @user-mrz/dsh-system-prompt-studio
```

From GitHub, which tracks the default branch and therefore needs a ref if you want a fixed version:

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio#v0.3.0
```

Replace `<profile>` with your profile name — for the Web build that is usually `web`.

**Pin a version for reproducibility.** Without one you get whatever is newest, so a later release
changes what you install next time:

```bash
dsh plugin --profile <profile> add @user-mrz/dsh-system-prompt-studio@0.3.0
```

<details>
<summary>Local directory install (for development)</summary>

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-system-prompt-studio
```

</details>

### If pnpm blocks the build script

pnpm refuses to run build scripts from Git dependencies by default. This plugin's `prepare` script only
**verifies** that the entry files exist — it compiles nothing and writes nothing — so being blocked does
not break the install. If pnpm stops anyway, it writes a pending entry into your profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-system-prompt-studio: set this to true or false   # ← change this line to: true
```

Set it to `true` and re-run the same `add` command.

> ⚠️ That grants this package's code permission to run **outside the DSH agent sandbox** at install time.
> Here, [`scripts/verify-entry.mjs`](scripts/verify-entry.mjs) only reads files — no network, no writes —
> but grant it only to source you trust.

### After installing

The Host half activates immediately. **The client half is new JavaScript, so refresh the page once** to
make the title-bar button appear.

Verify the Host half is live:

```bash
curl "http://127.0.0.1:3080/api/system-prompt-studio?session=<sessionId>"
```

A `{"ok":true,...,"capability":{...}}` response means it's working.

### Uninstall

```bash
dsh plugin --profile <profile> remove @user-mrz/dsh-system-prompt-studio
```

Your saved overrides are **not** deleted.

---

## Usage

1. A **System prompt** button appears in the title bar of any conversation (with a dot when this
   conversation already has its own override). On a **brand-new conversation** the title bar is
   hidden by the harness, so the button lives in the welcome area instead, labeled
   **Set system prompt**.
2. Pick a scope — **this conversation**, **this workspace**, or **global default**. The global default
   applies to top-level conversations only (not subagents); the workspace scope applies to every
   conversation whose working directory is that directory, subagents included.
3. Choose a mode, write your text, save. It takes effect on your next message.
4. Expand the two read-only blocks at the bottom to check reality:
   - *System prompt of the latest request* — what was actually sent;
   - *Sections assembled for this conversation* — real section names, order and size.

### Scopes and precedence

From most specific to least, the first one that exists wins:

| # | Scope | Applies to | Survives a new conversation? |
| --- | --- | --- | --- |
| 1 | **This conversation** | exactly one conversation | no |
| 2 | **Inherited from a fork** | that fork and its descendants | n/a (lineage) |
| 3 | **This workspace** | every conversation in that directory | **yes** |
| 4 | **Global default** | every top-level conversation | yes |

The workspace scope sits above the global default because it is narrower — a project's rules should not
be overridden by a blanket persona. It sits *below* a fork's inherited rules because a fork carries the
context of the work it branched from, and a rule written for that specific branch is a more specific
statement than the directory's default.

**The directory is resolved from the workspace registry first.** The panel shows the resolved path next to
the tabs. Priority: the workspace this conversation belongs to in `workspaceRegistry` (the one you see in
the sidebar), then — only when no workspace owns it — the conversation's current directory, then the
directory recorded when the conversation was created.

That ordering matters more than it looks. `workingDirectory.get()` returns the **deployment default
directory** for a conversation that never changed directory, not its own project; keying on it directly
would make every conversation share one workspace entry, so rules saved in one project would apply in
another. It is therefore only trusted when it differs from that default, i.e. when a change was really
committed.

The panel displays the **original path spelling**, not the normalised key: normalisation lowercases the
Windows drive and directory names, which is right for matching and wrong for a path a user is meant to
recognise.

The path is resolved on the host — the panel never sends one, so a same-origin script cannot write rules
for directories you never opened.

`resetAll` (the API action that clears every per-conversation override) **does not** touch workspace
entries: those are accumulated project configuration, not per-conversation scratch state.

### Can I set the prompt of a conversation that hasn't started yet?

Yes, and it applies from the **first** message, not the second. The harness creates the agent the
moment the conversation exists — before you type anything — so the override is already registered by
the time your first prompt is assembled. Open the welcome-area button and save.

Three ways to cover a new conversation:

| Want | Do this |
| --- | --- |
| Just this one new conversation | Open its welcome-area button → **this conversation** → save |
| Every conversation in this project | Open the button in any conversation in that directory → **this workspace** → save |
| Every top-level conversation that has no override of its own | Open the button in any conversation → **global default** → save |

The global default and the workspace rules are **not** limited to conversations created after you save
them: both are re-evaluated for every live conversation on each save, so existing conversations without
something more specific pick them up immediately too. A conversation that has its own override keeps it.

### Choosing a section to replace

"Replace a section" works by registering a section with the **same name** in the conversation's scope,
which shadows the first-party one. There is no separate API for it — that *is* the mechanism.

The panel's section list comes from the live assembly, so the names are real. Pick from the dropdown
rather than typing from memory: several names are easy to guess wrong.

### The section list is a snapshot, not a live view

Assembly happens when a model request runs; saving does not trigger one. So the section list is always
**one request behind** your last save. The panel shows the time of the assembly it came from, and says so
explicitly when that assembly predates your save — send one message and reopen to see the new result.

In **Replace everything** mode the list is always the *pre-replacement* set. That is not a bug: the
harness applies a `complete` section by replacing the whole section array *after* the assembly hook has
already run, so any observer — including this one — necessarily sees the full list first. The panel labels
this case instead of leaving you to wonder why every section is still listed.

> An assembled section carries only `name` / `text` / `interpolate` — **not** its sort order. The plugin
> reconstructs order from known constants plus position in the assembly array
> ([`deriveOrders`](lib/index.js)). Unknown names land near where they actually belong; a name that
> does not exist falls back to the append order and is inserted as a new section.

### Forked conversations

A fork gets a **new session id**. So that carefully tuned rules don't silently vanish, the child walks
the `parentSession` chain to the nearest ancestor that has its own rules:

- the panel shows *Inherited from: …* with a **Pin here** button;
- **Pin** writes the inherited result into the conversation's own entry — later upstream changes no
  longer affect it;
- edit the child yourself and inheritance stops immediately (own rules win);
- at most `maxInheritDepth` levels up (default 3); `inheritOnFork: false` disables it entirely.

### Unsaved edits

When there are unsaved changes, Esc / backdrop click / ✕ all ask *Discard unsaved changes?* first. Inside
that confirmation, Esc means **keep editing** — mashing Esc never destroys your text. Closing the tab or
reloading triggers the browser's own leave confirmation. Editing and reverting is not considered dirty.

---

## Configuration

Edit the row in `cordis.patch.yml` or override it in your profile patch. The most useful keys:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; when off, no section is registered and the API reports why |
| `defaultMode` | `append` | Mode used by the global default |
| `allowComplete` | `true` | Set `false` to disable "replace everything" entirely. **Recommended when other plugins register prompt sections** — see the warning above. |
| `appendOrder` | `10500` | Sort order of the appended section, clamped to `[10201, 20000]` |
| `maxChars` | `200000` | Max body length; oversize is **rejected**, never truncated |
| `globalDefaultScope` | `roots` | Whether the global default also applies to subagents (`all` to include) |
| `inheritOnFork` | `true` | Whether forked conversations inherit upstream rules |
| `maxInheritDepth` | `3` | How many levels to walk up (1–8); `0` behaves like off |
| `workspaceScope` | `all` | Whether workspace rules also apply to subagents (`roots` for top-level only) |
| `observeAssemblies` | `true` | Read-only assembly observer; required for the section list |
| `visible` | `true` | Whether the panel button is shown (client-side) |
| `showOnNewConversation` | `true` | Whether the welcome area of a brand-new conversation also gets a button (client-side) |
| `hostURL` | `''` | Fallback host URL for desktop shells; empty = auto |

Every key is documented in [`cordis.patch.yml`](cordis.patch.yml).

## Where data lives

`$DSH_HOME/dsh-system-prompt-studio/state.json` — versioned JSON:

```jsonc
{
  "version": 1,
  "global":  { "enabled": false, "mode": "append", "text": "", "target": "", "updatedAt": 0 },
  "sessions": { "<sessionId>": { "enabled": true, "mode": "append", "text": "…", "target": "", "updatedAt": 0 } },
  "workspaces": { "C:/work/alpha": { "enabled": true, "mode": "append", "text": "…", "target": "", "updatedAt": 0 } }
}
```

Workspace keys are **normalised directory paths**, not `workspaceRegistry` ids. Separators are unified
to `/`, trailing and duplicate separators and `.` segments are dropped, and case is folded on Windows —
so `C:\work\alpha\`, `C:/work/alpha` and `c:/Work/Alpha` are one key. Ids were rejected on purpose:
deleting and re-registering a workspace mints a new id, and a project's rules should not evaporate
because of that. Keys that do not normalise cleanly (empty, or a bare drive like `C:`) are treated as
"no usable directory" rather than as a shared bucket.

- Writes go through a temp file plus atomic `rename`, serialized on one queue.
- If a write fails, the panel says so explicitly (*in memory only, lost on restart*) rather than
  pretending the save worked.
- A corrupt file is **never overwritten**: it is backed up to `state.json.corrupt-<timestamp>` first, the
  plugin starts empty, and the reason is reported in the API's `health` field.

## HTTP API

```
GET  /api/system-prompt-studio?session=<sessionId>
POST /api/system-prompt-studio
     { "action": "set",   "scope": "session"|"workspace"|"global", "sessionId"?: "…", "patch": { "enabled": true, "mode": "append"|"replace"|"complete", "text": "…", "target": "…" } }
     { "action": "clear", "scope": "session"|"workspace"|"global", "sessionId"?: "…" }
     { "action": "pin",   "scope": "session", "sessionId": "…" }
     { "action": "resetAll", "confirm": true }
```

- Loopback-only: both the socket and the `Host` header must be loopback; cross-site origins get 403.
- POST bodies over `maxChars * 4` bytes are rejected with 413 (never truncated).
- `scope: "workspace"` resolves the directory **from `sessionId`** on the host. An explicit
  `"workspaceKey": "C:/path"` is honoured only when no `sessionId` is given (scripts and tests) and goes
  through the same normalisation. Sending a path is not how the panel works, by design: accepting one
  would let same-origin script write rules for directories the user never opened.
- An unrecognised `scope` value falls back to `session`, never to `global`.
- Stable error codes: `TEXT_TOO_LONG`, `EMPTY_TEXT`, `TARGET_REQUIRED`, `COMPLETE_BLOCKED`,
  `UNKNOWN_ACTION`, `MISSING_SESSION`, `MISSING_WORKSPACE`, `NOTHING_TO_PIN`, `PIN_SESSION_ONLY`,
  `CONFIRM_REQUIRED`, `INVALID_JSON`, `BODY_TOO_LARGE`, `method-not-allowed`, `forbidden: loopback-only`.

## Known limitations

1. **Overrides are keyed by session id, but forks inherit.** A forked conversation picks up the nearest
   ancestor's rules (disable with `inheritOnFork`). Subagents do not take the global default and do not
   participate in the fork chain; they *do* take workspace rules unless `workspaceScope: roots`.
   Resuming a session under the same id re-applies its rules.
2. **Cold sessions** (no live agent) can be saved for, but take effect once resumed. Fork inheritance
   specifically requires a live agent, because the parent chain is read from the session header — a cold
   session has none until it is running again. Workspace rules work for cold sessions too: the registry
   lookup only needs the session id, so a conversation that has not been resumed yet can still be given
   its project's rules, and its live siblings pick them up immediately.
3. **`{{…}}` is not interpolated.** Bodies are registered with `interpolate: false`, so braces stay
   literal. This is deliberate: otherwise any `{{x}}` in your text would fail assembly with
   *unknown prompt variable*.
4. **Cache prefix invalidation.** Changing the system prompt invalidates that conversation's provider
   cache from the first changed token, so the next request pays for the new prefix. That is how the
   mechanism works, not plugin behaviour.
5. **"Replace everything" is exclusive.** Assembly permits a single active `complete` section.
6. **Section attribution is approximate.** The list is attributed via the assembly context's scope (the
   agent); if that is unavailable it falls back to the most recent assembly. Overrides themselves are
   unaffected.
7. **Workspace matching is textual, not filesystem-resolved.** Keys are normalised path spellings; `..`
   is not resolved (that needs filesystem semantics this plugin does not touch) and symlinks are not
   followed. The host prefers the `workspaceRegistry` entry, whose path is canonicalised by DSH itself,
   so the normal case is exact.

## Development

```bash
npm run check              # syntax check + both test suites
node test/host-check.mjs   # fake ctx: routes, section install, validation, loopback fence, cleanup, order derivation
node test/client-check.mjs # fake loader/React: slot registration, style injection and teardown
```

The Host half depends only on Node built-ins and resolves every service through `ctx.get(name)`, so the
plugin still loads and honestly reports capability bits when a service is missing.

[`scripts/verify-entry.mjs`](scripts/verify-entry.mjs) runs as `prepare` and only checks that entry files
exist — no compilation, since `lib/` is committed plain JavaScript.

## Privacy

No credentials, API keys, conversation content or personal paths are in this repository. At runtime the
plugin writes only under your own `$DSH_HOME/dsh-system-prompt-studio/`. Nothing is sent anywhere.

## License

[MIT](LICENSE)

---

## 中文说明

按**对话**查看并覆盖模型实际收到的**系统提示词**，而不只是用户提示词。

DSH 本身只提供配置文件级的人设前后缀：改一次要重启，且对所有会话生效。这个插件把同一件事做成
运行时的、按会话的、即时生效的。

**三种模式**

| 模式 | 作用 |
|---|---|
| 追加（默认） | 保留第一方全部提示词，在末尾追加你的段落 —— 最安全 |
| 替换指定段 | 用同名段影子覆盖某一第一方段落，例如 `deployment:persona-suffix` |
| 完全替换 | 你的文本成为整段系统提示词 —— 风险最高 |

**⚠️ 关于「完全替换」**：它会移除第一方的全部指引（工具使用说明、结构化输出规则、计划模式策略），
工具调用质量可能明显下降。运行时上下文（工作目录 / 沙箱 / 审批策略）仍会作为用户侧快照发送，
不会被你的文本替换。

**它同时会移除其它插件注册的全部段落，这一点最容易在不知不觉中出问题。** 插件的工具 schema 还在，
但告诉模型「何时调用、怎么调用」的那段说明没了，于是工具装着却用不上，而且不报任何错——看起来像
「模型变笨了」，而不是「我关掉了什么」。如果你装了会注册提示词段的插件（`plugin:ssh`、
`plugin:task-board`、`team:policy` 之类），「完全替换」会把它们在该对话里一次性全部停用。

面板在保存前会逐条列出到底会丢掉什么：每个段名与字符数，并单独点明其中有多少个属于其它插件。
若该对话还没装配过提示词，面板会如实说无法列举，而不是猜一个数字。

**建议直接把这个模式关掉。** 在插件那一行的配置里设 `allowComplete: false`，该模式即不可用——
面板会把选项置灰，强行保存会被 `COMPLETE_BLOCKED` 拒绝。状态文件里已有的 `complete` 覆盖会停止
生效，提示词回到第一方默认（数据保留，不删除）。**只要 profile 里装了会贡献提示词段的第三方插件，
就推荐这么设。**

另外装配只允许一个生效的 `complete` 段，若同会话内有别的插件也注册了一个，装配会报
`multiple complete prompt sections` —— 那时该对话的**每一次**模型请求都会失败，而用户只会看到
「请求失败」。改回「追加」或「替换」即可恢复。

**安装**

本插件发布为 npm 作用域包
**[@user-mrz/dsh-system-prompt-studio](https://www.npmjs.com/package/@user-mrz/dsh-system-prompt-studio)**。
npm 上另有一个**不带作用域**的同名包 `dsh-system-prompt-studio`，那是**另一位作者的另一个项目**，
装它得不到本插件——请始终使用带 `@user-mrz/` 作用域的名字。

从 npm（推荐，有版本号可锁）：

```bash
dsh plugin --profile <profile> add @user-mrz/dsh-system-prompt-studio
```

或从 GitHub（跟随默认分支，建议锁 tag）：

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio#v0.3.0
```

锁定版本，保证装到的是一份确定的代码：

```bash
dsh plugin --profile <profile> add @user-mrz/dsh-system-prompt-studio@0.3.0
```

`prepare` 脚本只校验入口文件存在，不做编译。若被 pnpm 拦下，把 `pnpm-workspace.yaml` 里
`allowBuilds` 下该包的待决占位改成 `true`，再重跑同一条命令 —— 这一步允许该包在 **DSH 沙箱之外**
执行安装期脚本，请只对你信任的源码授权。

**安装后**：Host 半即时生效；客户端是新的 JS，需要刷新一次页面才会出现标题栏按钮。

**使用**：打开对话 → 标题栏「系统提示词」按钮 → 选作用域（本对话 / 本工作区 / 全局默认）、模式、
写正文 → 保存，下一次发消息生效。
**新开的空对话**标题栏是隐藏的，入口改在欢迎区（文字为「设置系统提示词」）—— 会话一创建 agent
就已经在了，所以这里保存的覆盖**从第一句话**就生效，不是等到第二句。
面板底部两个只读区块分别显示「最近一次请求真正发出的系统提示词」与「本次装配到的段清单」。

**段清单是快照，不是实时视图**：装配只在模型请求时发生，保存不会触发它，所以清单总是比你刚才的
保存**晚一个请求**。面板会标出这份清单来自哪一次装配（时分秒），并在它早于你的保存时明确提示
「这是保存前的清单」——发一条消息再打开就能看到新结果。

**「完全替换」模式下清单永远是替换前的全量**。这不是 bug：DSH 在装配钩子**之后**才把 sections
整体换成 `[completeSection]`，所以任何观察者（包括本插件）必然先看到全量。面板会把这种情况标出来，
而不是让你对着几十个段怀疑替换没生效。

**新对话怎么生效**：「本对话」只作用于这一个新对话；「本工作区」作用于**这个目录下的所有对话**
（含子代理）；「全局默认」作用于**所有没有自身覆盖的顶层对话**——后两者都包括保存时就已经存在的
那些，它们是「兜底」而不是「只对新对话」。

**三档作用域的优先级**（从具体到宽泛，命中第一个就停）：本对话 → fork 继承 → 本工作区 → 全局默认。
工作区排在全局之上是因为它更窄；排在 fork 继承之下是因为 fork 带着它分叉出来的那段工作的上下文，
用户为那个分支单独调过的规则比目录默认更具体。

**工作区按你侧边栏看到的那个工作区算**：优先用 `workspaceRegistry` 里的归属（会话在注册表里属于哪个
工作区），所以它不会因为你在对话里 `cd` 而漂移；注册表里没有归属时，才退回这个对话的当前目录，再退回
会话创建时记下的原始目录。面板会显示解析出来的**原始路径**（不是归一化后的小写键），供你核对。

> 这里有个坑值得说明：`workingDirectory.get()` 对**没换过目录**的会话返回的是部署默认目录，不是会话
> 自己的项目目录。直接拿它当工作区键，所有会话会共用同一个键——在这个项目里设的规则会莫名其妙地对
> 别处生效。所以它只在「确实换过目录」时才被采用。

路径由宿主自己解析——面板从不传路径，否则同源脚本就能给用户从没打开过的目录写规则。`resetAll`
（清空所有会话覆盖的 API 动作）**不动**工作区条目：那是攒下来的项目配置，不是逐对话的临时状态。

**fork 继承**：fork 出的对话是新 session id，会沿 `parentSession` 链继承最近的祖先规则；面板显示
「继承自 …」并提供「在此固定」把继承结果固化成本地规则。子对话自己一改就停止继承。默认上溯 3 层，
可用 `inheritOnFork: false` 关闭。

**未保存保护**：有改动时 `Esc`、点遮罩、点 ✕ 都会先问「放弃未保存的修改？」；确认层里 `Esc` 等于
继续编辑。关标签页/刷新会触发浏览器离开确认。改了又改回去不算脏。

**数据位置**：`$DSH_HOME/dsh-system-prompt-studio/state.json`，原子写入；写失败会明说「只在内存」，
文件损坏会先备份成 `.corrupt-<时间戳>` 再空态起步。

**已知限制**：冷会话（没有活 agent）可以保存，但要等它恢复后才生效，且 fork 继承需要活会话才能读到
父链（工作区规则对冷会话也有效，目录从已存的会话里读）；`{{…}}` 不插值（刻意为之）；系统提示词一变，
该对话的缓存前缀从首个变化的 token 起失效；工作区匹配是文本归一化，不解析 `..`、不跟随符号链接。
