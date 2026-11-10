// dsh-system-prompt-studio — Host 半。
//
// 目标：让用户按「对话」管理模型真正收到的**系统提示词**，而不只是用户消息。
//
// 三件事：
//   1. 按 agent 作用域注册提示词段（追加 / 同名影子替换 / 完全替换）；
//   2. 只读观察每次装配，得到该会话真实的段清单（名称/顺序/字符数）；
//   3. 一条回环 HTTP 路由给 Web 面板读写状态，状态自己落在 $DSH_HOME 下。
//
// 为什么必须按 agent 作用域注册：`ctx.systemPrompt.section()` 把段写进**调用者
// 所在作用域**的层，而 `agent.ctx` 正是那个会话的作用域。同层同名段会抛错，
// 但作用域层会影子覆盖全局同名段——这正是「替换指定段」的实现方式，不需要
// 改动任何第一方包。
//
// 为什么不用 import '@deepseek-ai/*'：本包只依赖 Node 内置模块，profile 的依赖
// 解析与离线测试都不受影响；服务一律通过 `ctx.get(name)` 做可选获取。

import { copyFileSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-system-prompt-studio'
export const inject = ['webServer']

/** 支持的覆盖模式。`none` 不是模式，只在内部表示「没有生效覆盖」。 */
const MODES = ['append', 'replace', 'complete']
/** 追加段的段名（即使文本为空也必须唯一，避免与第一方段撞名）。 */
const APPEND_SECTION = 'studio:append'
/** 完全替换段的段名。 */
const COMPLETE_SECTION = 'studio:complete'
/** 段的排序兜底范围，避免用户把段塞到离谱的位置。 */
const ORDER_MIN = 10201
const ORDER_MAX = 20000
/**
 * fork 继承的最大上溯深度（硬上限）。
 *
 * 取 3 是有意的：真实场景里 fork 一次是常态，fork 的 fork 已经很罕见，
 * 再深基本都是子代理链。深度太大既拖慢每次装配（判定会在 text 回调里跑），
 * 也让「这条规则到底从哪继承来的」变得无法向用户解释。
 */
const MAX_INHERIT_DEPTH = 8

/**
 * 第一方段的排序常量（来自 @deepseek-ai/dsh-system-prompt 的 SECTION_ORDERS）。
 * 「替换指定段」必须沿用目标段自己的顺序，否则段会跑到提示词的另一头。
 *
 * 段名以**线上实测**为准（`assembly.sections` 里的 name），不要凭常量名猜：
 * 实测到的名字是 `app:web-surface`、`context:file-reference`、
 * `ui:deliverable-file-references`、`mcp-resource-servers` 这种形式。
 * 未收录的名字由 {@link anchorOrderFor} 按前一次装配里的位置推算。
 */
const KNOWN_ORDERS = {
  'harness:identity': -1000,
  'deployment:persona-prefix': 0,
  'plan:policy': 500,
  'team:policy': 600,
  'ptc:only': 800,
  'context:file-reference': 900,
  'tool:bash': 1000,
  'tool:pwsh': 1010,
  'tool:read': 1100,
  'tool:write': 1200,
  'tool:edit': 1300,
  'tool:apply_patch': 1350,
  'tool:glob': 1400,
  'tool:grep': 1500,
  'tool:jobs': 1600,
  'tool:pty': 1700,
  'tool:web_search': 2000,
  'tool:web_fetch': 2100,
  'tool:lsp': 2200,
  'tool:session_query': 2300,
  'tool:goal': 2400,
  'tool:schedule': 2500,
  'tool:workflow': 2600,
  'tool:ralph': 2700,
  'tool:subagent': 2800,
  'tool:report': 2900,
  'mcp-resource-servers': 3100,
  'tools:sdk': 5000,
  'ui:deliverable-file-references': 9000,
  'structured-output': 9900,
  'harness:source': 10000,
  'app:web-surface': 10100,
  'deployment:persona-suffix': 10200,
}

const DEFAULTS = {
  enabled: true,
  apiPath: '/api/system-prompt-studio',
  stateFile: '',
  defaultMode: 'append',
  allowComplete: true,
  appendOrder: 10500,
  defaultTargetName: 'deployment:persona-suffix',
  maxChars: 200000,
  observeAssemblies: true,
  maxObservedScopes: 64,
  // 全局默认值套用到哪些会话：roots = 只套用到顶层会话；all = 含子代理。
  globalDefaultScope: 'roots',
  // fork 继承：子会话没有自身覆盖时，沿 parentSession 链向上找。
  // inheritOnFork=false 可退回「各会话独立」的旧行为。
  inheritOnFork: true,
  // 继承深度上限。防环之外还要防「极深的子代理链」把判定拖慢。
  maxInheritDepth: 3,
  // ── 下面是 client 半读的键，host 忽略 ────────────────────────────────
  visible: true,
  showOnNewConversation: true,
  hostURL: '',
}

/**
 * 解析并夹取本行的配置。patch 是整体替换，所以这里必须对每个键做兜底，
 * 不能假设用户会把所有键都写上。
 */
function resolveConfig(raw) {
  const cfg = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: cfg.enabled !== false,
    apiPath: apiPath(cfg.apiPath),
    stateFile: typeof cfg.stateFile === 'string' ? cfg.stateFile.trim() : '',
    defaultMode: MODES.includes(cfg.defaultMode) ? cfg.defaultMode : DEFAULTS.defaultMode,
    allowComplete: cfg.allowComplete !== false,
    appendOrder: number(cfg.appendOrder, DEFAULTS.appendOrder, ORDER_MIN, ORDER_MAX),
    defaultTargetName:
      typeof cfg.defaultTargetName === 'string' && cfg.defaultTargetName.trim() !== ''
        ? cfg.defaultTargetName.trim()
        : DEFAULTS.defaultTargetName,
    maxChars: number(cfg.maxChars, DEFAULTS.maxChars, 200, 4000000),
    observeAssemblies: cfg.observeAssemblies !== false,
    maxObservedScopes: number(cfg.maxObservedScopes, DEFAULTS.maxObservedScopes, 1, 4096),
    globalDefaultScope: cfg.globalDefaultScope === 'all' ? 'all' : 'roots',
    inheritOnFork: cfg.inheritOnFork !== false,
    maxInheritDepth: number(cfg.maxInheritDepth, DEFAULTS.maxInheritDepth, 0, MAX_INHERIT_DEPTH),
    visible: cfg.visible !== false,
    showOnNewConversation: cfg.showOnNewConversation !== false,
    hostURL: typeof cfg.hostURL === 'string' ? cfg.hostURL.trim() : '',
  }
}

function number(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function apiPath(value) {
  if (typeof value !== 'string') return DEFAULTS.apiPath
  const trimmed = value.trim()
  if (!trimmed.startsWith('/api/')) return DEFAULTS.apiPath
  if (trimmed.includes(' ') || trimmed.includes('?') || trimmed.includes('#')) return DEFAULTS.apiPath
  return trimmed
}

// ---------------------------------------------------------------------------
// 状态：版本化 JSON，内存镜像 + 串行落盘
// ---------------------------------------------------------------------------

function emptyEntry(mode) {
  return { enabled: false, mode: mode ?? DEFAULTS.defaultMode, text: '', target: '', updatedAt: 0 }
}

function emptyState() {
  return { version: 1, global: emptyEntry(), sessions: {} }
}

function defaultStateFile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'dsh-system-prompt-studio', 'state.json')
}

/** 把读入的 entry 洗成合法形状；非法字段回退到默认值而不是抛错。 */
function normalizeEntry(raw, fallback) {
  const base = fallback !== undefined ? fallback : emptyEntry()
  const entry = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : base.enabled,
    mode: MODES.includes(entry.mode) ? entry.mode : base.mode,
    text: typeof entry.text === 'string' ? entry.text : base.text,
    target: typeof entry.target === 'string' ? entry.target : base.target,
    updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : base.updatedAt,
  }
}

/**
 * 读入状态。故意用同步读：apply 发生在 agent/created 之前，异步读会与首批
 * 会话的装段产生竞态，导致「刚打开就有一瞬间用了旧值」。
 * 损坏时不覆盖原文件，而是备份后空状态起步，把原因交给接口回报。
 */
function loadState(file) {
  const health = { stateFile: file, loaded: false, error: '', backup: '' }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      health.loaded = true
      return { state: emptyState(), health }
    }
    health.error = `读取状态文件失败：${message(error)}`
    return { state: emptyState(), health }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    health.error = `状态文件不是合法 JSON：${message(error)}`
    const backup = `${file}.corrupt-${Date.now()}`
    // 同步备份，保证备份先于任何后续写入发生；失败就只报告原因。
    try {
      copyFileSync(file, backup)
      health.backup = backup
    } catch {
      health.backup = ''
    }
    return { state: emptyState(), health }
  }
  const state = emptyState()
  if (parsed !== null && typeof parsed === 'object') {
    state.global = normalizeEntry(parsed.global)
    if (parsed.sessions !== null && typeof parsed.sessions === 'object') {
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (typeof id !== 'string' || id === '') continue
        state.sessions[id] = normalizeEntry(entry)
      }
    }
  }
  health.loaded = true
  return { state, health }
}

/**
 * 串行落盘：同目录临时文件 + rename 原子替换。返回 true 表示已持久化；
 * false 时调用方必须把 `persisted:false` 告诉用户，不能假装保存成功。
 */
function createWriter(file, health, readState) {
  let chain = Promise.resolve(true)
  return function persist() {
    const snapshot = JSON.stringify(readState(), null, 2)
    chain = chain.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.tmp-${process.pid}-${Date.now()}`
        await writeFile(temp, snapshot, 'utf8')
        await rename(temp, file)
        health.error = ''
        return true
      } catch (error) {
        health.error = `写入状态文件失败：${message(error)}`
        return false
      }
    })
    return chain
  }
}

// ---------------------------------------------------------------------------
// HTTP 小工具（沿用工作区里已验证的回环围栏写法）
// ---------------------------------------------------------------------------

function isIPv4Loopback(parts) {
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = String(address).toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7).split('.'))
  return isIPv4Loopback(normalized.split('.'))
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || isIPv4Loopback(hostname.split('.'))
}

/**
 * 回环围栏：socket 与 Host 头都必须是回环（挡掉远程客户端），浏览器页面只能
 * 同源访问。桌面壳从自定义协议加载界面（Origin 可能是 "null"），这类来源本身
 * 不可能是远程站点，而 socket/Host 已确认回环，因此放行。
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = request.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  const origin = request.headers?.origin
  if (origin === undefined || origin === 'null') return true
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') {
    if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
    return originUrl.host === hostUrl.host
  }
  return true
}

function corsHeaders(request) {
  const origin = request.headers?.origin
  const headers = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  }
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') headers['access-control-allow-origin'] = origin
  return headers
}

function writeJson(res, status, body, extra) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(extra ?? {}),
  })
  res.end(JSON.stringify(body))
}

function message(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  return String(error.message ?? error)
}

/**
 * 覆盖的「形态签名」：只描述*装成什么样*，不含正文内容。
 *
 * 文本变化不必重装（`section.text` 是函数，装配时重新求值），但形态、目标段、
 * 顺序、以及**继承来源**变化时必须重装——父会话换了规则或继承链断开时，子会话
 * 的注册要跟着更新，否则会一直沿用旧形态。
 */
function buildSignature(effective) {
  if (effective === null || effective === undefined) return 'none|'
  if (effective.kind === 'none') return `none|${effective.reason ?? ''}`
  const origin = effective.inheritedFrom === undefined ? '' : `|from:${effective.inheritedFrom}`
  return `${effective.kind}|${effective.target}|${effective.order}${origin}`
}

/** 逐块取出一条消息的纯文本；非文本块跳过。 */
function textOfMessage(m) {
  const content = m?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * 从一次装配结果推算每个段的顺序值。
 *
 * 装配输出**不带 order**（顺序只是排序输入），所以这里用「已知常量为锚点，
 * 未知段在相邻锚点之间线性插值」的办法还原：已知段直接用常量值，未知段在
 * 前后已知段之间均分，边界外按 ±1 递增。这样未知段也能落在它真实所在的
 * 位置附近，而不是一律贴到末尾。
 *
 * @param bare 装配数组顺序的 `[{ name, chars }]`
 * @returns 带 `order` 的同一列表；完全推算不出时 order 为 null
 */
function deriveOrders(bare) {
  const rows = bare.map((row) => ({ ...row, order: null }))
  const anchors = []
  for (let index = 0; index < rows.length; index++) {
    const known = KNOWN_ORDERS[rows[index].name]
    if (typeof known === 'number') {
      rows[index].order = known
      anchors.push({ index, order: known })
    }
  }
  if (anchors.length === 0) return rows

  // 第一个锚点之前：按 -1 递减，保证仍排在它前面。
  const first = anchors[0]
  for (let index = first.index - 1; index >= 0; index--) {
    rows[index].order = first.order - (first.index - index)
  }
  // 相邻锚点之间：均分间隔（至少留 1 的步长）。
  for (let a = 0; a + 1 < anchors.length; a++) {
    const left = anchors[a]
    const right = anchors[a + 1]
    const gap = right.index - left.index
    if (gap <= 1) continue
    const span = right.order - left.order
    for (let offset = 1; offset < gap; offset++) {
      const share = span / gap
      const value = share >= 1 ? Math.round(left.order + share * offset) : left.order + offset
      rows[left.index + offset].order = value
    }
  }
  // 最后一个锚点之后：按 +1 递增。
  const last = anchors[anchors.length - 1]
  for (let index = last.index + 1; index < rows.length; index++) {
    rows[index].order = last.order + (index - last.index)
  }
  // 兜底：插值撞车时按数组顺序强制递增，保证排序仍然稳定可预期。
  let previous = -Infinity
  for (const row of rows) {
    if (row.order === null) continue
    if (row.order <= previous) row.order = Math.floor(previous) + 1
    previous = row.order
  }
  return rows
}

/** 读 JSON 请求体，超过上限直接 413（不截断，避免把半截文本存进去）。 */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (status, code, text) => {
      if (settled) return
      settled = true
      const error = new Error(text)
      error.status = status
      error.code = code
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        fail(413, 'BODY_TOO_LARGE', `请求体超过 ${limit} 字节`)
        try {
          req.destroy()
        } catch {
          /* 连接可能已经断开 */
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        const error = new Error('请求体不是合法 JSON')
        error.status = 400
        error.code = 'INVALID_JSON'
        reject(error)
      }
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

const MOUNTED = Symbol.for('dsh-system-prompt-studio.mounted')

/** 同一 profile 里重复挂载本行时，第二次起是 no-op（否则同名路由注册会抛错）。 */
function mountOnce(packageName, fn) {
  return (...args) => {
    const registry = globalThis
    const mounted = (registry[MOUNTED] ??= new Set())
    if (mounted.has(packageName)) return
    mounted.add(packageName)
    args[0]?.effect?.(() => () => {
      mounted.delete(packageName)
    })
    return fn(...args)
  }
}

/** 运行期状态；apply 时重建，测试可以经 `__internals.runtime` 只读查看。 */
const runtime = {
  config: resolveConfig({}),
  state: emptyState(),
  health: { stateFile: '', loaded: false, error: '', backup: '' },
  /** sessionId → { agent, sections, signature, effective, error } */
  installed: new Map(),
  /** sessionId → { at, sections:[{name, order, chars}] } */
  observed: new Map(),
  /** 段名 → 最近一次实测到的顺序 */
  observedOrder: new Map(),
  assembles: 0,
  lastObserved: null,
  persist: () => Promise.resolve(true),
}

export const apply = mountOnce(name, function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  runtime.config = config
  const file = config.stateFile !== '' ? config.stateFile : defaultStateFile()
  const loaded = loadState(file)
  runtime.state = loaded.state
  runtime.health = loaded.health
  runtime.persist = createWriter(file, runtime.health, () => runtime.state)

  /** 可选服务获取；一律带 undefined 检查，缺失不影响插件激活。 */
  const service = (key) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(key) : undefined
    } catch {
      return undefined
    }
  }

  // ── 观察：只记录，绝不改写 ───────────────────────────────────────────
  if (config.observeAssemblies) {
    const off = ctx.on('system-prompt/assemble', (assembly, context, next) => {
      try {
        observeAssembly(ctx, assembly, context)
      } catch {
        /* 观察失败绝不能影响装配 */
      }
      return next()
    })
    ctx.effect(() => () => {
      try {
        off()
      } catch {
        /* disposal is best-effort */
      }
    })
  }

  // ── 覆盖判定 ─────────────────────────────────────────────────────────
  /** 目标段的排序：已知常量 → 实测到的顺序 → 追加段顺序。 */
  function orderFor(target) {
    if (Object.hasOwn(KNOWN_ORDERS, target)) return KNOWN_ORDERS[target]
    const seen = runtime.observedOrder.get(target)
    if (typeof seen === 'number' && Number.isFinite(seen)) return seen
    return config.appendOrder
  }

  function overrideFromEntry(entry, source) {
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (text.trim() === '') return { kind: 'none', source, reason: 'empty' }
    const mode = MODES.includes(entry.mode) ? entry.mode : config.defaultMode
    if (mode === 'complete') {
      if (!config.allowComplete) return { kind: 'none', source, reason: 'complete-blocked' }
      return { kind: 'complete', source, text, target: COMPLETE_SECTION, order: config.appendOrder }
    }
    if (mode === 'replace') {
      const target = typeof entry.target === 'string' ? entry.target.trim() : ''
      if (target === '') return { kind: 'none', source, reason: 'target-missing' }
      return { kind: 'replace', source, text, target, order: orderFor(target) }
    }
    return { kind: 'append', source, text, target: APPEND_SECTION, order: config.appendOrder }
  }

  /** 子代理判定：header.parentSession 存在即为子会话；读不到就当作顶层。 */
  function isRootAgent(agent) {
    return parentIdOf(agent) === ''
  }

  /** 读一个 agent 的父会话 id；读不到就返回空串。 */
  function parentIdOf(agent) {
    try {
      const parent = agent?.session?.header?.parentSession
      return typeof parent === 'string' ? parent : ''
    } catch {
      return ''
    }
  }

  /**
   * 沿 parentSession 链找「最近的、有自身覆盖的祖先」。
   *
   * 解决的是最扎心的一个静默失败：用户 fork 一个调教好的对话，fork 出来的新
   * sessionId 在状态里没有条目，提示词**悄悄变回默认**，用户根本不知道发生了什么。
   *
   * 两个保护：
   *   - `seen` 防环（状态或 header 数据异常时不至于死循环）；
   *   - `maxInheritDepth` 防深链（判定在每次装配的 text 回调里执行，不能太重）。
   *
   * 只沿「有自身覆盖」的祖先找：祖先只是继承来的不算合格起点，避免把
   * 一条古老的规则穿过很多层传下去、让来源无法解释。
   */
  function findInheritedOverride(agent) {
    if (!config.inheritOnFork) return null
    const limit = config.maxInheritDepth
    if (limit <= 0) return null
    const seen = new Set()
    let current = agent
    let depth = 0
    while (depth < limit) {
      const parentId = parentIdOf(current)
      if (parentId === '' || seen.has(parentId)) return null
      seen.add(parentId)
      depth += 1
      const parentEntry = runtime.state.sessions[parentId]
      if (parentEntry !== undefined && parentEntry.enabled) {
        const inherited = overrideFromEntry(parentEntry, 'session')
        // 父条目存在但内容为空/不完整时继续往上找，不要在这里给出空覆盖。
        if (inherited.kind !== 'none') {
          return { ...inherited, inheritedFrom: parentId, inheritedDepth: depth }
        }
      }
      current = resolveAgentById(parentId)
      if (current === undefined) return null
    }
    return null
  }

  /** 按 id 找活 agent；没有就返回 undefined。 */
  function resolveAgentById(sessionId) {
    const registry = agents()
    if (registry === undefined) return undefined
    try {
      return registry.get(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * 判一个 agent 当前该不该有覆盖、以及是什么形态。
   *
   * 优先级：
   *   1. 自身会话条目
   *   2. 沿 parentSession 链继承（最近的有覆盖的祖先）
   *   3. 全局默认（按 globalDefaultScope 决定是否碰子代理）
   */
  function effectiveFor(agent) {
    const id = typeof agent?.id === 'string' ? agent.id : ''
    const own = id !== '' ? runtime.state.sessions[id] : undefined
    if (own !== undefined && own.enabled) return overrideFromEntry(own, 'session')
    const inherited = findInheritedOverride(agent)
    if (inherited !== null) return inherited
    if (runtime.state.global.enabled) {
      if (config.globalDefaultScope === 'roots' && !isRootAgent(agent)) {
        return { kind: 'none', source: 'global', reason: 'subagent' }
      }
      return overrideFromEntry(runtime.state.global, 'global')
    }
    return { kind: 'none' }
  }

  /**
   * 冷会话（没有活 agent）时的退化判定。
   *
   * 冷会话读不到 header，因此找不到父链——只能看自身条目与全局默认。
   * 这是本方案的已知边界：冷会话的继承要等它被恢复（有了 agent）之后才成立。
   */
  function effectiveForId(sessionId) {
    const agent = resolveAgentById(sessionId)
    if (agent !== undefined) return effectiveFor(agent)
    const own = runtime.state.sessions[sessionId]
    if (own !== undefined && own.enabled) return overrideFromEntry(own, 'session')
    if (runtime.state.global.enabled) return overrideFromEntry(runtime.state.global, 'global')
    return { kind: 'none' }
  }

  function signatureOf(effective) {
    return buildSignature(effective)
  }

  // ── 按 agent 装段 ────────────────────────────────────────────────────
  function agents() {
    const found = service('agents')
    return found !== undefined && typeof found.list === 'function' ? found : undefined
  }

  /** 该 agent 作用域里的 systemPrompt；拿不到就返回 undefined（绝不退回归全局）。 */
  function systemPromptFor(agent) {
    const agentCtx = agent?.ctx
    if (agentCtx === null || typeof agentCtx !== 'object') return undefined
    try {
      const direct = agentCtx.systemPrompt
      if (direct !== null && typeof direct === 'object' && typeof direct.section === 'function') return direct
    } catch {
      /* 服务在该作用域不可用时属性访问可能抛错，继续走 ctx.get */
    }
    try {
      const viaGet = typeof agentCtx.get === 'function' ? agentCtx.get('systemPrompt') : undefined
      if (viaGet !== null && typeof viaGet === 'object' && typeof viaGet.section === 'function') return viaGet
    } catch {
      /* 同上 */
    }
    return undefined
  }

  function disposeSections(entry) {
    if (entry === undefined) return
    for (const dispose of entry.sections) {
      try {
        dispose()
      } catch {
        /* 重复释放是安全的 */
      }
    }
    entry.sections = []
  }

  function recordOf(sessionId) {
    let entry = runtime.installed.get(sessionId)
    if (entry === undefined) {
      entry = { agent: undefined, sections: [], signature: '', effective: { kind: 'none' }, error: '' }
      runtime.installed.set(sessionId, entry)
    }
    return entry
  }

  /**
   * 让某个 agent 的作用域与当前状态一致：比对「该装什么」与「已装什么」的
   * 签名，只在形态变化时重装注册。文本变化不必重装——段的 text 是函数，
   * 每次装配都会重新求值。
   */
  function install(agent) {
    if (agent === null || typeof agent !== 'object') return
    const sessionId = typeof agent.id === 'string' ? agent.id : ''
    if (sessionId === '') return
    const entry = recordOf(sessionId)
    entry.agent = agent
    if (!config.enabled) {
      disposeSections(entry)
      entry.signature = 'disabled'
      entry.effective = { kind: 'none', reason: 'disabled' }
      return
    }
    const effective = effectiveFor(agent)
    const signature = signatureOf(effective)
    if (entry.signature === signature) return
    disposeSections(entry)
    entry.signature = signature
    entry.effective = effective
    entry.error = ''
    if (effective.kind === 'none') return

    const systemPrompt = systemPromptFor(agent)
    if (systemPrompt === undefined) {
      entry.error = '该 agent 作用域里没有 systemPrompt 服务'
      entry.effective = { kind: 'none', reason: 'no-systemPrompt' }
      return
    }
    try {
      const dispose = systemPrompt.section({
        name: effective.target,
        order: effective.order,
        // 用户文本里的 {{…}} 必须保持字面，否则装配会因为「未知变量」直接抛错。
        interpolate: false,
        ...(effective.kind === 'complete' ? { complete: true } : {}),
        // 每次装配重新求值：状态被清掉时立刻变空段（空段会被装配丢弃）。
        text: () => {
          try {
            const now = effectiveFor(agent)
            return signatureOf(now) === signature ? now.text : ''
          } catch {
            return ''
          }
        },
      })
      entry.sections.push(dispose)
    } catch (error) {
      entry.error = `注册提示词段失败：${message(error)}`
      entry.effective = { kind: 'none', reason: 'register-failed' }
      ctx.logger?.warn?.(`[system-prompt-studio] ${entry.error}`)
    }
  }

  function uninstall(sessionId) {
    const entry = runtime.installed.get(sessionId)
    if (entry === undefined) return
    disposeSections(entry)
    runtime.installed.delete(sessionId)
  }

  function reinstallAll() {
    const registry = agents()
    if (registry === undefined) return
    let list = []
    try {
      list = registry.list()
    } catch {
      list = []
    }
    for (const agent of list) install(agent)
  }

  // ── 生命周期接线 ──────────────────────────────────────────────────────
  reinstallAll()
  ctx.on('agent/created', (payload) => {
    try {
      install(payload?.agent)
    } catch (error) {
      ctx.logger?.warn?.(`[system-prompt-studio] agent/created 处理失败：${message(error)}`)
    }
  })
  ctx.on('agent/disposed', (payload) => {
    const id = typeof payload?.agent?.id === 'string' ? payload.agent.id : ''
    if (id !== '') uninstall(id)
  })
  ctx.effect(() => () => {
    for (const id of [...runtime.installed.keys()]) uninstall(id)
    runtime.installed.clear()
    runtime.observed.clear()
    runtime.observedOrder.clear()
  })

  // ── 只读装配观察 ─────────────────────────────────────────────────────
  /**
   * 记录段名/位置/字符数，绝不改写 assembly。
   *
   * 一个实测出来的事实：`assembly.sections` 只带 `name` / `text` /
   * `interpolate`，**没有 `order`**（顺序是装配时用来排序的输入，不进输出）。
   * 所以这里记的是数组下标，顺序值再由 {@link deriveOrders} 从下标 + 已知常量
   * 推算出来。这样「替换指定段」既能沿用它原本的位置，也不需要猜。
   *
   * 归因优先用装配上下文里的 `scope`——`assembleContextFor(agent)` 明确把
   * `scope: agent` 一起传下来（agent 就是该会话的作用域键），所以这里拿到的
   * 就是当步那个会话。拿不到时退回 `agents.currentInitiator()`，再拿不到就
   * 只留在 `lastObserved` 里，面板退化成「最近一次装配」。
   */
  function observeAssembly(innerCtx, assembly, context) {
    const sections = Array.isArray(assembly?.sections) ? assembly.sections : []
    const bare = []
    for (const section of sections) {
      if (section === null || typeof section !== 'object') continue
      const sectionName = typeof section.name === 'string' ? section.name : ''
      if (sectionName === '') continue
      const text = typeof section.text === 'string' ? section.text : ''
      bare.push({ name: sectionName, chars: text.length })
    }
    const rows = deriveOrders(bare)
    runtime.assembles += 1
    const snapshot = { at: Date.now(), sections: rows }
    runtime.lastObserved = snapshot
    for (const row of rows) {
      if (typeof row.order === 'number') runtime.observedOrder.set(row.name, row.order)
    }
    let sessionId = typeof context?.scope?.id === 'string' ? context.scope.id : ''
    if (sessionId === '') {
      try {
        const agent = innerCtx.get?.('agents')?.currentInitiator?.()
        if (typeof agent?.id === 'string') sessionId = agent.id
      } catch {
        sessionId = ''
      }
    }
    if (sessionId === '') return
    runtime.observed.set(sessionId, snapshot)
    while (runtime.observed.size > config.maxObservedScopes) {
      const oldest = runtime.observed.keys().next()
      if (oldest.done === true) break
      runtime.observed.delete(oldest.value)
    }
  }

  // ── 状态快照（GET 与写入后都返回同一形状） ───────────────────────────
  /** 最近一次请求真正发出去的系统提示词：取活会话里最后一个 system 消息。 */
  function currentSystemPrompt(sessions, sessionId) {
    if (sessions === undefined || typeof sessions.get !== 'function') {
      return { text: null, note: '当前 profile 没有 sessions 服务，读不到会话日志。' }
    }
    let session
    try {
      session = sessions.get(sessionId)
    } catch {
      session = undefined
    }
    if (session === undefined) return { text: null, note: '该对话当前没有在运行（冷会话），没有可读的最近请求。' }
    let messages
    try {
      messages = typeof session.deriveMessages === 'function' ? session.deriveMessages() : []
    } catch (error) {
      return { text: null, note: `读取会话消息失败：${message(error)}` }
    }
    for (let index = messages.length - 1; index >= 0; index--) {
      const candidate = messages[index]
      if (candidate !== null && typeof candidate === 'object' && candidate.role === 'system') {
        const text = textOfMessage(candidate)
        if (text !== '') return { text }
      }
    }
    return { text: null, note: '该对话还没有发出过带系统提示词的请求。' }
  }

  function snapshot(sessionId) {
    const registry = agents()
    const sessions = service('sessions')
    const sysPrompt = service('systemPrompt')
    const entry = sessionId !== '' ? runtime.state.sessions[sessionId] : undefined
    const effective = sessionId !== '' ? effectiveForId(sessionId) : { kind: 'none' }
    const record = sessionId !== '' ? runtime.installed.get(sessionId) : undefined
    const watch = sessionId !== '' ? runtime.observed.get(sessionId) : undefined
    const current = sessionId !== '' ? currentSystemPrompt(sessions, sessionId) : { text: null, note: '未指定会话。' }
    let live = false
    try {
      live = sessionId !== '' && typeof registry?.get === 'function' ? registry.get(sessionId) !== undefined : false
    } catch {
      live = false
    }
    return {
      ok: true,
      ts: Date.now(),
      capability: {
        enabled: config.enabled,
        systemPrompt: sysPrompt !== undefined,
        agents: registry !== undefined,
        sessions: sessions !== undefined,
        observeAssemblies: config.observeAssemblies,
        allowComplete: config.allowComplete,
      },
      sessionId,
      live,
      global: { ...runtime.state.global },
      session: entry !== undefined ? { ...entry } : null,
      effective: {
        kind: effective.kind,
        target: effective.target ?? '',
        chars: typeof effective.text === 'string' ? effective.text.length : 0,
        source: effective.source ?? 'none',
        reason: effective.reason ?? '',
        // 继承信息：面板据此显示「继承自 <父会话>」并提供「在此固定」。
        inheritedFrom: effective.inheritedFrom ?? '',
        inheritedDepth: typeof effective.inheritedDepth === 'number' ? effective.inheritedDepth : 0,
      },
      /** 该会话自身的父会话 id（没有则为空串）；面板用来解释继承关系。 */
      parentSession: parentIdOf(resolveAgentById(sessionId)),
      install: record === undefined ? null : { signature: record.signature, error: record.error, count: record.sections.length },
      sections: watch === undefined ? null : watch.sections,
      /**
       * 段清单是「最近一次装配」的快照，不是实时结果：装配只在模型请求时发生，
       * 保存不会触发重新装配。不给时间戳的话，用户保存后打开面板看到旧清单，
       * 会以为「保存没生效」。
       */
      sectionsAt: watch === undefined ? 0 : watch.at,
      /**
       * 清单是否早于当前覆盖的保存时间。true = 面板必须提示「这是保存前的清单」。
       * 只在有自身条目时比较；没有覆盖时清单是纯粹的现状描述，不存在过期问题。
       */
      sectionsStale:
        watch === undefined || entry === undefined
          ? false
          : typeof entry.updatedAt === 'number' && entry.updatedAt > watch.at,
      /**
       * 当前生效的是 complete 模式。
       *
       * 这个标记存在的唯一原因：complete 的压缩发生在 `system-prompt/assemble`
       * waterfall **之后**（见 dsh-system-prompt 的 assemble：waterfall 拿到的是
       * 全量 sections，返回前才替换成 `[completeSection]`）。观察器挂在 waterfall
       * 上，因此它记录的永远是压缩前的全量清单——在 complete 模式下，面板显示的
       * 段清单与实际发送的内容必然不一致。把这件事明确标出来，而不是让用户自己
       * 对着 25 个段怀疑替换没生效。
       */
      sectionsComplete: effective.kind === 'complete',
      sectionsNote:
        watch !== undefined
          ? ''
          : config.observeAssemblies
            ? '该对话还没有装配过提示词（先发一条消息即可看到真实段清单）。'
            : '配置里关闭了装配观察，无法列出段清单。',
      current: current.text === null ? null : { text: current.text, chars: current.text.length, source: 'session-log' },
      currentNote: current.note ?? '',
      modes: MODES,
      defaultTargetName: config.defaultTargetName,
      limits: { maxChars: config.maxChars, appendOrder: config.appendOrder },
      observes: { assembles: runtime.assembles, sessions: runtime.observed.size, latest: runtime.lastObserved },
      health: { ...runtime.health },
      persisted: runtime.health.error === '',
    }
  }

  /** 写入后：重装所有会话的段 + 落盘，返回持久化结果。 */
  async function applyState() {
    reinstallAll()
    return runtime.persist()
  }

  function validate(entry) {
    if (entry.text.length > config.maxChars) return 'TEXT_TOO_LONG'
    if (entry.enabled && entry.text.trim() === '') return 'EMPTY_TEXT'
    if (entry.mode === 'replace' && entry.target.trim() === '') return 'TARGET_REQUIRED'
    if (entry.mode === 'complete' && entry.enabled && !config.allowComplete) return 'COMPLETE_BLOCKED'
    return ''
  }

  function reasonFor(code) {
    if (code === 'TEXT_TOO_LONG') return `正文超过上限 ${config.maxChars} 字符，请精简后再保存（不会被截断保存）。`
    if (code === 'EMPTY_TEXT') return '启用了覆盖但正文为空：请填写正文，或关掉这个覆盖。'
    if (code === 'TARGET_REQUIRED') return '替换模式必须给目标段名。'
    if (code === 'COMPLETE_BLOCKED') return '配置里 allowComplete=false，完全替换模式被禁用。'
    return code
  }

  /** POST 的校验与写入。所有拒绝都带稳定 error code，成功时返回写入后的完整快照。 */
  async function handlePost(payload) {
    const body = payload !== null && typeof payload === 'object' ? payload : {}
    const action = typeof body.action === 'string' ? body.action : ''
    const scope = body.scope === 'global' ? 'global' : 'session'
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

    if (action === 'resetAll') {
      if (body.confirm !== true) {
        return { status: 400, body: { ok: false, error: 'CONFIRM_REQUIRED', message: '清空全部会话覆盖需要 confirm: true。' } }
      }
      runtime.state.sessions = {}
      const persisted = await applyState()
      return { status: 200, body: { ...snapshot(''), persisted } }
    }

    if (action !== 'set' && action !== 'clear' && action !== 'pin') {
      return { status: 400, body: { ok: false, error: 'UNKNOWN_ACTION', message: `未知 action：${action || '(空)'}` } }
    }
    if (scope === 'session' && sessionId === '') {
      return { status: 400, body: { ok: false, error: 'MISSING_SESSION', message: '作用域是 session 时必须给 sessionId。' } }
    }

    if (action === 'clear') {
      if (scope === 'global') runtime.state.global = { ...emptyEntry(config.defaultMode), updatedAt: Date.now() }
      else delete runtime.state.sessions[sessionId]
      const persisted = await applyState()
      return { status: 200, body: { ...snapshot(sessionId), persisted } }
    }

    /**
     * pin：把当前「继承来的」覆盖固化成本会话自己的条目。
     *
     * 用途是给继承一个可控的出口——用户 fork 之后想在这个分支上独立调整，
     * 又不想从头再写一遍。父会话之后再改，这个分支就不跟着变了，这正是
     * 「固定」的语义。
     */
    if (action === 'pin') {
      if (scope !== 'session') {
        return { status: 400, body: { ok: false, error: 'PIN_SESSION_ONLY', message: 'pin 只对具体会话有效。' } }
      }
      const effective = effectiveForId(sessionId)
      if (effective.kind === 'none') {
        return { status: 400, body: { ok: false, error: 'NOTHING_TO_PIN', message: '该会话当前没有可固定的覆盖（没有继承，也没有全局默认）。' } }
      }
      const pinned = {
        enabled: true,
        mode: effective.kind,
        text: effective.text,
        target: effective.kind === 'replace' ? effective.target : '',
        updatedAt: Date.now(),
      }
      const invalid = validate(pinned)
      if (invalid !== '') {
        return { status: 400, body: { ok: false, error: invalid, message: reasonFor(invalid) } }
      }
      runtime.state.sessions[sessionId] = pinned
      const persisted = await applyState()
      return { status: 200, body: { ...snapshot(sessionId), persisted } }
    }

    const patch = body.patch !== null && typeof body.patch === 'object' ? body.patch : {}
    const current =
      scope === 'global' ? runtime.state.global : runtime.state.sessions[sessionId] ?? emptyEntry(config.defaultMode)
    // 逐字段合并：只写用户真正提交的键，避免面板把没传的键清掉。
    const next = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      mode: MODES.includes(patch.mode) ? patch.mode : current.mode,
      text: typeof patch.text === 'string' ? patch.text : current.text,
      target: typeof patch.target === 'string' ? patch.target : current.target,
      updatedAt: Date.now(),
    }

    const invalid = validate(next)
    if (invalid !== '') {
      return {
        status: 400,
        body: { ok: false, error: invalid, message: reasonFor(invalid), limits: { maxChars: config.maxChars } },
      }
    }

    if (scope === 'global') runtime.state.global = next
    else runtime.state.sessions[sessionId] = next
    const persisted = await applyState()
    return { status: 200, body: { ...snapshot(sessionId), persisted } }
  }

  // ── 路由 ──────────────────────────────────────────────────────────────
  const webServer = service('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    try {
      const dispose = webServer.register({
        kind: 'exact',
        path: config.apiPath,
        handler: async (req, res) => {
          const cors = corsHeaders(req)
          if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }, cors)
            return
          }
          if (req.method === 'OPTIONS') {
            res.writeHead(204, cors)
            res.end()
            return
          }
          try {
            if (req.method === 'GET') {
              let params
              try {
                params = new URL(req.url ?? '/', 'http://x').searchParams
              } catch {
                params = undefined
              }
              writeJson(res, 200, snapshot(params === undefined ? '' : params.get('session') ?? ''), cors)
              return
            }
            if (req.method === 'POST') {
              const payload = await readJsonBody(req, config.maxChars * 4)
              const result = await handlePost(payload)
              writeJson(res, result.status, result.body, cors)
              return
            }
            writeJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'GET, POST, OPTIONS' }, cors)
          } catch (error) {
            const status = typeof error?.status === 'number' ? error.status : 500
            writeJson(res, status, { ok: false, error: error?.code ?? 'internal-error', message: message(error) }, cors)
            if (status >= 500) ctx.logger?.warn?.(`[system-prompt-studio] 请求失败：${message(error)}`)
          }
        },
      })
      ctx.effect(() => () => {
        try {
          dispose()
        } catch {
          /* disposal is best-effort */
        }
      })
    } catch (error) {
      ctx.logger?.warn?.(`[system-prompt-studio] 路由注册失败（${config.apiPath}）：${message(error)}`)
    }
  } else {
    ctx.logger?.warn?.('[system-prompt-studio] 没有 webServer，面板拿不到状态；提示词覆盖仍然按配置生效。')
  }

  // 测试出口：只有显式启用时才挂内部句柄，正常运行时这一整段被跳过。
  // 见 __internals 的注释——模块导出会进入宿主进程，不能默认暴露写入路径。
  if (testHook === true || process.env.NODE_ENV === 'test') {
    runtime.test = { install, uninstall, reinstallAll, snapshot, handlePost, effectiveFor, effectiveForId }
  }
})

/**
 * 测试与诊断用的只读入口。
 *
 * 这里**只放纯函数与状态快照**，绝不放 `install` / `handlePost` / `snapshot` 这类
 * 能改变运行期的内部函数——模块导出对象会随包一起进入宿主进程，任何同进程代码
 * 只要 import 就能绕过 HTTP 回环围栏直接改状态。
 *
 * 需要驱动 `handlePost` 之类的测试，走 `__internals.testHook()`：它只在
 * `process.env.NODE_ENV === 'test'` 或显式调用 `__internals.enableTestHook()` 后
 * 才有值，正常运行时恒为 `undefined`。
 */
let testHook = undefined

export const __internals = {
  MODES,
  DEFAULTS,
  APPEND_SECTION,
  COMPLETE_SECTION,
  KNOWN_ORDERS,
  ORDER_MIN,
  ORDER_MAX,
  MAX_INHERIT_DEPTH,
  resolveConfig,
  normalizeEntry,
  emptyState,
  emptyEntry,
  textOfMessage,
  deriveOrders,
  isLoopbackRequest,
  isIPv4Loopback,
  isLoopbackHostname,
  readJsonBody,
  signatureOf: buildSignature,
  /** 只读的运行期状态快照（配置、计数器、缓存）；不含任何可调用入口。 */
  readRuntime: () => ({
    config: { ...runtime.config },
    state: JSON.parse(JSON.stringify(runtime.state)),
    health: { ...runtime.health },
    assembles: runtime.assembles,
    installed: runtime.installed.size,
    observed: runtime.observed.size,
    lastObserved: runtime.lastObserved,
  }),
  /** 何时可用：测试显式打开，或 NODE_ENV=test。返回值本身不做鉴权，仅作断点。 */
  testHook: () => testHook,
  /** 仅供测试进程调用，让下一次 apply 暴露内部句柄。 */
  enableTestHook: () => {
    testHook = true
  },
}

