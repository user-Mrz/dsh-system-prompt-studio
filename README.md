# dsh-system-prompt-studio

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A **[DeepSeek Harness](https://github.com/deepseek-ai)** plugin that lets you inspect and override the
**system prompt** a conversation actually sends to the model — per conversation, at runtime, without
restarting.

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
  | **Replace everything** | Your text becomes the entire system prompt. Highest risk — see below. |

- **Applies on the next model request.** No restart, no reload.
- **Persists per session**, and a **global default** applies to new conversations automatically.
- **Inherits across forks.** A forked conversation picks up its parent's rules along the `parentSession`
  chain, with a **Pin** action to freeze the inherited result locally.
- **Guards unsaved edits.** Esc, backdrop click and the close button all ask before discarding.
- **Zero runtime dependencies.** Only Node built-ins; it does not import any `@deepseek-ai/*` package.

### ⚠️ Before you use "Replace everything"

That mode removes **all** first-party guidance — tool instructions, structured-output rules, plan-mode
policy. Tool-calling quality can drop noticeably. Runtime context (working directory, sandbox policy,
approval policy) is still sent as a user-side snapshot and is **not** replaced by your text.

Also: assembly allows only one active `complete` section. If another plugin registers one in the same
session, assembly fails with `multiple complete prompt sections`. Switch back to Append or Replace to
recover.

---

## Requirements

- DSH `>=0.2.2-0 <0.3.0-0` (Web and Desktop share the same client artifact)
- Node.js ≥ 22.19.0

## Install

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio
```

Replace `<profile>` with your profile name — for the Web build that is usually `web`.

**Pin a commit for reproducibility.** Without a ref you get whatever is on the default branch, so any
later push changes what you install next time:

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio#<commit-sha>
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
dsh plugin --profile <profile> remove dsh-system-prompt-studio
```

Your saved overrides are **not** deleted.

---

## Usage

1. A **System prompt** button appears in the title bar of any conversation (with a dot when this
   conversation already has its own override). On a **brand-new conversation** the title bar is
   hidden by the harness, so the button lives in the welcome area instead, labeled
   **Set system prompt**.
2. Pick a scope: **this conversation** or **global default**. The global default applies to top-level
   conversations only — not to subagents.
3. Choose a mode, write your text, save. It takes effect on your next message.
4. Expand the two read-only blocks at the bottom to check reality:
   - *System prompt of the latest request* — what was actually sent;
   - *Sections assembled for this conversation* — real section names, order and size.

### Can I set the prompt of a conversation that hasn't started yet?

Yes, and it applies from the **first** message, not the second. The harness creates the agent the
moment the conversation exists — before you type anything — so the override is already registered by
the time your first prompt is assembled. Open the welcome-area button and save.

Two ways to cover a new conversation:

| Want | Do this |
| --- | --- |
| Just this one new conversation | Open its welcome-area button → **this conversation** → save |
| Every top-level conversation that has no override of its own | Open the button in any conversation → **global default** → save |

The global default is **not** limited to conversations created after you save it: it is re-evaluated
for every live conversation on each save, so existing top-level conversations without an override of
their own pick it up immediately too. A conversation that has its own override keeps it — the global
default only fills in where nothing more specific exists.

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
| `allowComplete` | `true` | Set `false` to disable "replace everything" entirely |
| `appendOrder` | `10500` | Sort order of the appended section, clamped to `[10201, 20000]` |
| `maxChars` | `200000` | Max body length; oversize is **rejected**, never truncated |
| `globalDefaultScope` | `roots` | Whether the global default also applies to subagents (`all` to include) |
| `inheritOnFork` | `true` | Whether forked conversations inherit upstream rules |
| `maxInheritDepth` | `3` | How many levels to walk up (1–8); `0` behaves like off |
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
  "sessions": { "<sessionId>": { "enabled": true, "mode": "append", "text": "…", "target": "", "updatedAt": 0 } }
}
```

- Writes go through a temp file plus atomic `rename`, serialized on one queue.
- If a write fails, the panel says so explicitly (*in memory only, lost on restart*) rather than
  pretending the save worked.
- A corrupt file is **never overwritten**: it is backed up to `state.json.corrupt-<timestamp>` first, the
  plugin starts empty, and the reason is reported in the API's `health` field.

## HTTP API

```
GET  /api/system-prompt-studio?session=<sessionId>
POST /api/system-prompt-studio
     { "action": "set",   "scope": "session"|"global", "sessionId"?: "…", "patch": { "enabled": true, "mode": "append"|"replace"|"complete", "text": "…", "target": "…" } }
     { "action": "clear", "scope": "session"|"global", "sessionId"?: "…" }
     { "action": "pin",   "scope": "session", "sessionId": "…" }
     { "action": "resetAll", "confirm": true }
```

- Loopback-only: both the socket and the `Host` header must be loopback; cross-site origins get 403.
- POST bodies over `maxChars * 4` bytes are rejected with 413 (never truncated).
- Stable error codes: `TEXT_TOO_LONG`, `EMPTY_TEXT`, `TARGET_REQUIRED`, `COMPLETE_BLOCKED`,
  `UNKNOWN_ACTION`, `MISSING_SESSION`, `NOTHING_TO_PIN`, `PIN_SESSION_ONLY`, `CONFIRM_REQUIRED`,
  `INVALID_JSON`, `BODY_TOO_LARGE`, `method-not-allowed`, `forbidden: loopback-only`.

## Known limitations

1. **Overrides are keyed by session id, but forks inherit.** A forked conversation picks up the nearest
   ancestor's rules (disable with `inheritOnFork`). Subagents do not take the global default and do not
   participate in the chain. Resuming a session under the same id re-applies its rules.
2. **Cold sessions** (no live agent) can be saved for, but take effect once resumed. Inheritance
   specifically requires a live agent, because the parent chain is read from the session header — a cold
   session has none until it is running again.
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
不会被你的文本替换。另外装配只允许一个生效的 `complete` 段，若同会话内有别的插件也注册了一个，
装配会报 `multiple complete prompt sections` —— 改回「追加」或「替换」即可恢复。

**安装**

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio
```

建议锁定 commit，保证装到的是一份确定的代码：

```bash
dsh plugin --profile <profile> add github:user-Mrz/dsh-system-prompt-studio#<commit-sha>
```

`prepare` 脚本只校验入口文件存在，不做编译。若被 pnpm 拦下，把 `pnpm-workspace.yaml` 里
`allowBuilds` 下该包的待决占位改成 `true`，再重跑同一条命令 —— 这一步允许该包在 **DSH 沙箱之外**
执行安装期脚本，请只对你信任的源码授权。

**安装后**：Host 半即时生效；客户端是新的 JS，需要刷新一次页面才会出现标题栏按钮。

**使用**：打开对话 → 标题栏「系统提示词」按钮 → 选作用域、模式、写正文 → 保存，下一次发消息生效。
**新开的空对话**标题栏是隐藏的，入口改在欢迎区（文字为「设置系统提示词」）—— 会话一创建 agent
就已经在了，所以这里保存的覆盖**从第一句话**就生效，不是等到第二句。
面板底部两个只读区块分别显示「最近一次请求真正发出的系统提示词」与「本次装配到的段清单」。

**段清单是快照，不是实时视图**：装配只在模型请求时发生，保存不会触发它，所以清单总是比你刚才的
保存**晚一个请求**。面板会标出这份清单来自哪一次装配（时分秒），并在它早于你的保存时明确提示
「这是保存前的清单」——发一条消息再打开就能看到新结果。

**「完全替换」模式下清单永远是替换前的全量**。这不是 bug：DSH 在装配钩子**之后**才把 sections
整体换成 `[completeSection]`，所以任何观察者（包括本插件）必然先看到全量。面板会把这种情况标出来，
而不是让你对着几十个段怀疑替换没生效。

**新对话怎么生效**：「本对话」只作用于这一个新对话；「全局默认」作用于**所有没有自身覆盖的顶层
对话**——包括保存时就已经存在的那些，它是「兜底」而不是「只对新对话」。

**fork 继承**：fork 出的对话是新 session id，会沿 `parentSession` 链继承最近的祖先规则；面板显示
「继承自 …」并提供「在此固定」把继承结果固化成本地规则。子对话自己一改就停止继承。默认上溯 3 层，
可用 `inheritOnFork: false` 关闭。

**未保存保护**：有改动时 `Esc`、点遮罩、点 ✕ 都会先问「放弃未保存的修改？」；确认层里 `Esc` 等于
继续编辑。关标签页/刷新会触发浏览器离开确认。改了又改回去不算脏。

**数据位置**：`$DSH_HOME/dsh-system-prompt-studio/state.json`，原子写入；写失败会明说「只在内存」，
文件损坏会先备份成 `.corrupt-<时间戳>` 再空态起步。

**已知限制**：冷会话（没有活 agent）可以保存，但要等它恢复后才生效，且继承需要活会话才能读到父链；
`{{…}}` 不插值（刻意为之）；系统提示词一变，该对话的缓存前缀从首个变化的 token 起失效。
