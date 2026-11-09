# dsh-system-prompt-studio（系统提示词工作室）

按**对话**查看并覆盖模型实际收到的**系统提示词**——不只是用户提示词。

DSH 本身只提供配置文件级的人设前后缀（`@deepseek-ai/dsh-system-prompt` 的
`personaPrefix` / `personaSuffix`）：改一次要重启，而且对所有会话生效。这个插件
把同一件事做成运行时的、按会话的、即时生效的：

- 在对话标题栏加一个入口按钮，打开编辑器；
- **追加**：保留第一方全部提示词，只在末尾追加你的段落（默认）；
- **替换指定段**：用同名段影子覆盖某一第一方段落（例如
  `deployment:persona-suffix`、`plan:policy`、`tools:sdk`）；
- **完全替换**：整段系统提示词由你的文本接管（需勾选确认）；
- 保存后**下一次模型请求即生效**，不用重启；
- 覆盖按 session 持久化，会话恢复后继续生效；另有一份「全局默认」，新对话自动套用；
- 面板能读到该对话**最近一次请求真正发出的系统提示词**，以及**当前装配到的段清单**
  （段名 / 顺序 / 字符数）——替换目标从实测清单里选，不用猜段名。

- 运行环境：DSH `>=0.2.2-0 <0.3.0-0`（Web 与桌面端共用同一份客户端产物）
- 依赖：**零运行时依赖**，只用 Node 内置模块，不 import 任何 `@deepseek-ai/*`

---

## 安装

### 方式一：从 GitHub 源码安装（推荐，无需 npm 发布）

```bash
dsh plugin --profile desktop add github:user-Mrz/dsh-system-prompt-studio
```

把 `desktop` 换成你自己的 profile 名即可。

**建议锁定 commit SHA**，保证你装到的是一份确定、不会再变动的代码：

```bash
dsh plugin --profile desktop add github:user-Mrz/dsh-system-prompt-studio#<commit-sha>
```

不加 `#<sha>` 时，装的是默认分支的最新提交：作者后续任何一次推送，都会改变你下次
安装时实际运行的代码。

### 方式二：从本地目录安装

```bash
dsh plugin --profile desktop add file:C:\path\to\dsh-system-prompt-studio
```

### 首次安装可能需要一步「授权」（Git 源码安装）

pnpm 默认**拒绝执行 Git 依赖的构建脚本**，这是它的安全策略。本插件的 `prepare`
脚本只做入口文件校验、不产出任何文件，被拦下也不影响可用性；但如果安装被它拦停，
DSH 会在终端给出明确指引：把下面的键写进当前 profile 的 `pnpm-workspace.yaml`，然后
**重新执行同一条 `add` 命令**：

```yaml
allowBuilds:
  "dsh-system-prompt-studio": true
```

> ⚠️ 这一步的含义是：允许该包的代码在你的机器上**于 DSH Agent 沙箱之外**执行安装期
> 脚本。本仓库的 `scripts/verify-entry.mjs` 只读文件、不联网、不写盘，但请只对你信任
> 的源码仓库授予这项权限。

### 安装之后

Host 半通常即时生效。**客户端模块是新的 JS，需要刷新一次页面**才会出现标题栏按钮
（若你的 profile 没有跑 `dev:web` 监视器，不要期待免刷新 HMR）。

验证是否装好：

```bash
curl "http://127.0.0.1:3080/api/system-prompt-studio?session=<sessionId>"
```

返回 `{"ok":true,...,"capability":{...}}` 即 Host 半正常。

卸载：

```bash
dsh plugin --profile desktop remove dsh-system-prompt-studio
```

状态文件不会被删除。

---

## 使用

1. 打开任意对话，标题栏出现「系统提示词」按钮（已存在覆盖时按钮带一个圆点）。
2. 选作用域：`本对话` / `全局默认`（全局默认只套用到顶层会话，**不含子代理**）。
3. 选模式，写正文，点保存。
4. 下一次发消息时生效。展开底部两个只读区块可以看到实际效果：
   - 「最近一次请求的系统提示词」：该对话**已经发出去**的系统提示词原文；
   - 「本对话装配到的段」：装配时的段名 / 顺序 / 字符数清单。

### 从别的对话分叉出来（fork）

fork 出来的对话是一个**新的 session id**。为了让精心调好的规则不要悄悄失效，
子对话会沿 `parentSession` 链自动继承最近的、有规则的祖先：

- 面板顶部会显示「当前规则继承自：…」，并在旁边给出「在此固定」按钮；
- 点「在此固定」把这个继承结果写成该对话自己的规则，之后上游再改就不影响这里；
- 子对话自己一改，就立刻停止继承（自身规则优先）；
- 最多向上找 `maxInheritDepth` 层（默认 3）；`inheritOnFork: false` 可完全关闭。

### 未保存的保护

面板检测到有未保存改动时：

- `Esc`、点遮罩、点右上角 ✕ 都不会直接关闭，而是先问「放弃未保存的修改？」；
- 确认层里 `Esc` 等于「继续编辑」，不会连按两下就丢；
- 关标签页/刷新会触发浏览器的离开确认。

只有真的改了东西才会拦——改了又改回去不算脏，未修改时一切照旧。

### 三种模式

| 模式 | 做什么 | 什么时候用 |
|---|---|---|
| 追加（默认） | 新增一个段 `studio:append`，顺序 10500（第一方 `deployment:persona-suffix`=10200 之后） | 加规则、加语气、加输出格式约束——最安全 |
| 替换指定段 | 用同名段影子覆盖该会话作用域里的那一第一方段 | 想改掉某一段而不是叠加，比如换掉收尾的人设段 |
| 完全替换 | 注册一个 `complete: true` 的段，成为唯一系统提示词段 | 想让模型完全按你的指令工作 |

**完全替换的风险**：第一方的工具使用说明、结构化输出指引、计划模式策略等全部
消失，工具调用质量可能明显下降。运行时上下文（工作目录 / 沙箱 / 审批策略）仍然
会作为用户侧快照随请求发送，不会被这段替换。另外同一个会话里如果有别的插件也
注册了 `complete` 段，装配会直接报 `multiple complete prompt sections`——排查办法
就是把它改回追加或替换。

### 段名与顺序

「替换指定段」用的是 `ctx.systemPrompt.section()` 的作用域影子机制：在
`agent.ctx` 里注册与第一方**同名**的段，就会覆盖该会话里的那一段。

一个实现上的关键事实：**装配输出不带 `order`**。装配结果的 `assembly.sections` 只有
`name` / `text` / `interpolate`——顺序只是排序输入，不进输出。所以插件用「已知常量
为锚点 + 按装配数组下标插值」的办法还原位置（见 `lib/index.js` 的 `deriveOrders`），
未知段也能落在它真实所在的区间内，而不是一律贴到末尾。

本机实测到的段名（会随启用的插件不同而变化，以面板清单为准）：

```
harness:identity · deployment:persona-prefix · tool:dshm · plan:policy
context:file-reference · tool:pwsh · tool:read · tool:write · tool:edit
tool:glob · tool:grep · tool:jobs · tool:web_search · tool:web_fetch
tool:goal · tool:schedule · tool:workflow · tool:subagent · tool:subagent_fork
mcp-resource-servers · ui:deliverable-file-references · harness:source
app:web-surface · deployment:persona-suffix
```

注意几个容易猜错的名字：是 `app:web-surface` 而不是 `web:surface`，是
`context:file-reference` 而不是 `file-reference`，是
`ui:deliverable-file-references` 而不是 `deliverable:file-references`。

要精确知道某个段叫什么、排第几，先让该对话发一条消息，再看面板里的段清单。

---

## 配置

见 `cordis.patch.yml`（每个键都有注释）。常用几项：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关掉后不注册任何段，接口回报原因 |
| `defaultMode` | `append` | 全局默认使用的模式 |
| `allowComplete` | `true` | 设 `false` 可彻底禁用「完全替换」 |
| `appendOrder` | `10500` | 追加段顺序，夹在 `[10201, 20000]` |
| `maxChars` | `200000` | 单份正文上限；超限拒绝保存，不截断 |
| `globalDefaultScope` | `roots` | 全局默认是否套用到子代理（`roots` = 不套用） |
| `inheritOnFork` | `true` | fork 出的对话是否沿 `parentSession` 自动继承上游规则 |
| `maxInheritDepth` | `3` | 继承最多上溯几层（1–8）；`0` 等同关闭 |
| `observeAssemblies` | `true` | 是否注册只读装配观察（决定能否列出段清单） |
| `visible` | `true` | 面板入口是否显示（客户端） |

## 数据在哪里

`$DSH_HOME/dsh-system-prompt-studio/state.json`（例如 `~/.dsh/dsh-system-prompt-studio/state.json`），
版本化 JSON：

```jsonc
{
  "version": 1,
  "global":  { "enabled": false, "mode": "append", "text": "", "target": "", "updatedAt": 0 },
  "sessions": { "<sessionId>": { "enabled": true, "mode": "append", "text": "…", "target": "", "updatedAt": 0 } }
}
```

- 写入走同目录临时文件 + `rename` 原子替换，串行排队；
- 写失败时面板会明确说「只保存在内存，重启会丢」，不会假装保存成功；
- 文件损坏时**不覆盖原文件**，先备份成 `state.json.corrupt-<时间戳>`，再空状态起步，
  原因在接口的 `health` 字段里回报。

## 接口

```
GET  /api/system-prompt-studio?session=<sessionId>
POST /api/system-prompt-studio
     { "action": "set",   "scope": "session"|"global", "sessionId"?: "…", "patch": { "enabled": true, "mode": "append"|"replace"|"complete", "text": "…", "target": "…" } }
     { "action": "clear", "scope": "session"|"global", "sessionId"?: "…" }
     { "action": "pin",   "scope": "session", "sessionId": "…" }
     { "action": "resetAll", "confirm": true }
```

- `pin` 把该会话当前生效的（继承或全局默认）覆盖固化成它自己的规则；
- 仅接受回环请求（socket 与 Host 头都必须是回环）；跨站 Origin 一律 403；
- POST 只接受 JSON 体，超过 `maxChars * 4` 字节直接 413；
- 稳定错误码：`TEXT_TOO_LONG`、`EMPTY_TEXT`、`TARGET_REQUIRED`、`COMPLETE_BLOCKED`、
  `UNKNOWN_ACTION`、`MISSING_SESSION`、`NOTHING_TO_PIN`、`PIN_SESSION_ONLY`、`CONFIRM_REQUIRED`、
  `INVALID_JSON`、`BODY_TOO_LARGE`、`method-not-allowed`、`forbidden: loopback-only`。

## 已知限制

1. **覆盖按 sessionId 键控，但 fork 会继承**：fork 出的新对话沿 `parentSession` 链继承
   最近的祖先规则（可关，见 `inheritOnFork`）；子代理默认不继承全局默认，也不参与继承链。
   会话 resume 到同一个 id 会重新套用。
2. **冷会话**（没有活 agent）可以保存，等它恢复后才生效；预览会显示「未在运行」。
   冷会话读不到 header，因此**继承关系要等它被恢复成活会话之后才成立**。
3. **`{{…}}` 不插值**：正文以 `interpolate: false` 注册，花括号原样保留。这是刻意
   的——否则用户文本里任何 `{{x}}` 都会让装配抛「unknown prompt variable」。
4. **缓存前缀失效**：系统提示词一变，该对话的 provider 缓存从首个变化的 token 起
   失效，下一次请求按新前缀计费。这是机制本身决定的，不是插件行为。
5. **完全替换与其它 `complete` 段互斥**：装配只允许一个生效的 `complete` 段。
6. **只读观察是近似归因**：段清单靠装配上下文的 `scope`（即 agent）归属；拿不到时
   退化成「最近一次装配」，不影响覆盖本身。

## 开发

```
npm run check              # 语法检查 + 两个测试
node test/host-check.mjs   # 假 ctx：路由、装段、校验、围栏、清理、顺序推算
node test/client-check.mjs # 假 loader/React：槽注册、样式注入与清理
```

Host 半只依赖 Node 内置模块，不 import 任何 `@deepseek-ai/*`；服务一律通过
`ctx.get(name)` 做可选获取，所以缺服务时插件仍能加载并如实报告能力位。

`prepare` 脚本（`scripts/verify-entry.mjs`）在安装期校验入口与清单文件是否存在，
不做任何编译——`lib/` 是随仓库提交的纯 JavaScript。

## 隐私

本仓库不含任何凭据、API key、会话内容或个人路径。插件运行时数据只写在你自己机器的
`$DSH_HOME/dsh-system-prompt-studio/` 下，不会被回传。

## License

[MIT](LICENSE)
