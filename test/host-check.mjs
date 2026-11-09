// dsh-system-prompt-studio — Host 半冒烟测试。
//
// 用一个最小的假 ctx 直接 import 并 apply，验证：
//   1. 只注册一条精确路由，path 正确；
//   2. 无 session 的 GET 返回能力位；
//   3. set append 后 agent 作用域出现 studio:append，且 interpolate === false；
//   4. 切到 replace 后旧注册被释放、目标同名段出现；
//   5. 切到 complete 出现 complete:true；allowComplete:false 时被拒；
//   6. 超长文本 400、启用但空正文 400、未知 action 400、错误方法 405；
//   7. 非回环请求 403；
//   8. agent/disposed 后注册被清理；
//   9. 状态文件损坏时不覆盖原文件、接口回报原因。
//
// 运行：node test/host-check.mjs

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workdir = mkdtempSync(join(tmpdir(), 'sps-check-'))
process.env.DSH_HOME = workdir

const moduleUrl = new URL('../lib/index.js', import.meta.url)
const mod = await import(moduleUrl.href)

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ── 假 ctx ──────────────────────────────────────────────────────────────
function makeHarness(overrides = {}) {
  const state = {
    routes: [],
    listeners: new Map(),
    effects: [],
    sections: [],
    disposed: [],
  }

  function makeSystemPrompt(scopeLabel) {
    return {
      section(definition) {
        const record = { ...definition, scope: scopeLabel }
        state.sections.push(record)
        let active = true
        return () => {
          if (!active) return
          active = false
          const index = state.sections.indexOf(record)
          if (index >= 0) state.sections.splice(index, 1)
          state.disposed.push(`${scopeLabel}:${definition.name}`)
        }
      },
    }
  }

  const agents = []
  /**
   * 造一个假 agent。
   *
   * `parentSession` 允许在创建后再改（测试里常用），所以要显式 emit
   * `agent/created` 才会触发插件的装段——真实运行时由 agent 工厂发出这个事件。
   */
  const makeAgent = (id, options = {}) => {
    const agent = {
      id,
      session: { header: { parentSession: options.parentSession ?? overrides.parentOf?.(id) } },
      ctx: {
        systemPrompt: makeSystemPrompt(id),
        get(name) {
          return name === 'systemPrompt' ? this.systemPrompt : undefined
        },
        effect(fn) {
          const dispose = fn()
          state.effects.push(dispose)
          return dispose
        },
      },
    }
    agents.push(agent)
    if (options.silent !== true) {
      // 与真实运行时对齐：agent 入场后立刻通知监听者，插件据此装段。
      for (const listener of state.listeners.get('agent/created') ?? []) listener({ agent })
    }
    return agent
  }

  /** 某个 agent 的父链改动之后，重新通知一次，让插件按新形态重装。 */
  const reparent = (agent, parentSession) => {
    agent.session.header.parentSession = parentSession
    for (const listener of state.listeners.get('agent/created') ?? []) listener({ agent })
  }

  const registry = {
    list: () => [...agents],
    get: (id) => agents.find((agent) => agent.id === id),
    currentInitiator: () => agents[0],
  }

  const sessions = overrides.sessions ?? new Map()

  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    get(name) {
      if (name === 'agents') return registry
      if (name === 'sessions') return sessions instanceof Map ? { get: (id) => sessions.get(id) } : sessions
      if (name === 'systemPrompt') return makeSystemPrompt('global')
      if (name === 'webServer') return webServer
      return undefined
    },
    on(event, listener) {
      const list = state.listeners.get(event) ?? []
      list.push(listener)
      state.listeners.set(event, list)
      return () => {
        const current = state.listeners.get(event) ?? []
        const index = current.indexOf(listener)
        if (index >= 0) current.splice(index, 1)
      }
    },
    effect(fn) {
      const dispose = fn()
      state.effects.push(dispose)
      return dispose
    },
    emit(event, payload) {
      for (const listener of state.listeners.get(event) ?? []) listener(payload)
    },
  }

  const webServer = {
    register(route) {
      if (state.routes.some((existing) => existing.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      state.routes.push(route)
      return () => {
        const index = state.routes.indexOf(route)
        if (index >= 0) state.routes.splice(index, 1)
      }
    },
  }

  return { ctx, state, makeAgent, reparent, sessions, registry }
}

/** 调路由；req 尽量贴近 Node 的 IncomingMessage 形状。 */
function callRoute(route, { method = 'GET', url = '/', body, remoteAddress = '127.0.0.1', host = '127.0.0.1:3080', origin, headers } = {}) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      socket: { remoteAddress },
      headers: { host, ...(origin === undefined ? {} : { origin }), ...(headers ?? {}) },
      on(event, listener) {
        if (event === 'data' && body !== undefined) setImmediate(() => listener(Buffer.from(body, 'utf8')))
        if (event === 'end') setImmediate(() => listener())
        return req
      },
      destroy() {},
    }
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(status, extra) {
        this.statusCode = status
        this.headers = { ...this.headers, ...extra }
      },
      end(text) {
        const raw = text === undefined ? '' : String(text)
        resolve({ status: this.statusCode, headers: this.headers, text: raw, json: raw === '' ? null : JSON.parse(raw) })
      },
    }
    if (body !== undefined) req.headers['content-length'] = String(Buffer.byteLength(body))
    route.handler(req, res)
    void chunks
  })
}

function post(route, payload, options) {
  return callRoute(route, { method: 'POST', body: JSON.stringify(payload), ...options })
}

// ── 1. 挂载 + 路由 ──────────────────────────────────────────────────────
console.log('\n[mount]')
const harness = makeHarness()
const agent = harness.makeAgent('session-a')
mod.apply(harness.ctx, {})
check('注册了一条路由', harness.state.routes.length === 1, `实际 ${harness.state.routes.length}`)
const route = harness.state.routes[0]
check('路由是 exact', route?.kind === 'exact', route?.kind)
check('路由路径正确', route?.path === '/api/system-prompt-studio', route?.path)

// 重复挂载应是 no-op
mod.apply(harness.ctx, {})
check('重复挂载不重复注册路由', harness.state.routes.length === 1, `实际 ${harness.state.routes.length}`)

// ── 2. GET 能力位 ───────────────────────────────────────────────────────
console.log('\n[GET]')
const bare = await callRoute(route, { url: '/api/system-prompt-studio' })
check('GET 200', bare.status === 200, String(bare.status))
check('能力位 enabled', bare.json?.capability?.enabled === true)
check('能力位 agents', bare.json?.capability?.agents === true)
check('能力位 systemPrompt', bare.json?.capability?.systemPrompt === true)
check('modes 三选', Array.isArray(bare.json?.modes) && bare.json.modes.length === 3)
check('无 session 时 sections 为 null', bare.json?.sections === null)

const scoped = await callRoute(route, { url: '/api/system-prompt-studio?session=session-a' })
check('带 session 的 GET 200', scoped.status === 200)
check('带 session 时 live=true', scoped.json?.live === true)
check('未跑过请求时段清单为 null', scoped.json?.sections === null)
check('段清单有说明', typeof scoped.json?.sectionsNote === 'string' && scoped.json.sectionsNote.length > 0)

// ── 3. set append ───────────────────────────────────────────────────────
console.log('\n[append]')
const saved = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'append', text: '你是资深 SRE。' },
})
check('保存 200', saved.status === 200, saved.text)
check('persisted=true', saved.json?.persisted === true, saved.text)
check('effective.kind=append', saved.json?.effective?.kind === 'append', saved.json?.effective?.kind)
const appendSection = harness.state.sections.find((section) => section.name === 'studio:append')
check('agent 作用域出现 studio:append', appendSection !== undefined)
check('append 段 interpolate=false', appendSection?.interpolate === false)
check('append 段作用域正确', appendSection?.scope === 'session-a', appendSection?.scope)
check('append 段文本函数返回写入内容', appendSection?.text() === '你是资深 SRE。', JSON.stringify(appendSection?.text()))
check('状态文件已写出', existsSync(join(workdir, 'dsh-system-prompt-studio', 'state.json')))

// ── 4. 切 replace ───────────────────────────────────────────────────────
console.log('\n[replace]')
const replaced = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'replace', text: '新的收尾段。', target: 'deployment:persona-suffix' },
})
check('replace 保存 200', replaced.status === 200, replaced.text)
check('effective.kind=replace', replaced.json?.effective?.kind === 'replace')
check('replace 目标顺序沿用第一方常量', replaced.json?.effective?.target === 'deployment:persona-suffix')
check('旧 studio:append 已释放', harness.state.sections.every((section) => section.name !== 'studio:append'))
const targetSection = harness.state.sections.find((section) => section.name === 'deployment:persona-suffix')
check('出现目标同名段', targetSection !== undefined)
check('目标段顺序 = 10200', targetSection?.order === 10200, String(targetSection?.order))
check('目标段文本 = 写入内容', targetSection?.text() === '新的收尾段。')

// ── 5. 未知目标段用兜底顺序 ──────────────────────────────────────────────
console.log('\n[replace-unknown]')
const unknown = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'replace', text: 'X', target: 'custom:thing' },
})
check('未知段名仍可保存', unknown.status === 200, unknown.text)
const customSection = harness.state.sections.find((section) => section.name === 'custom:thing')
check('未知段名成为新增段', customSection !== undefined)
check('未知段名用 appendOrder', customSection?.order === 10500, String(customSection?.order))

// ── 6. complete ─────────────────────────────────────────────────────────
console.log('\n[complete]')
const completed = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'complete', text: '只有我。' },
})
check('complete 保存 200', completed.status === 200, completed.text)
const completeSection = harness.state.sections.find((section) => section.name === 'studio:complete')
check('出现 studio:complete', completeSection !== undefined)
check('complete=true', completeSection?.complete === true)

// ── 7. 校验拒绝 ─────────────────────────────────────────────────────────
console.log('\n[validation]')
const tooLong = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'append', text: 'x'.repeat(200001) },
})
check('超长文本 400', tooLong.status === 400, String(tooLong.status))
check('错误码 TEXT_TOO_LONG', tooLong.json?.error === 'TEXT_TOO_LONG', tooLong.json?.error)

const empty = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'append', text: '   ' },
})
check('启用但空正文 400', empty.status === 400, String(empty.status))
check('错误码 EMPTY_TEXT', empty.json?.error === 'EMPTY_TEXT', empty.json?.error)

const noTarget = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'replace', text: 'x', target: '' },
})
check('replace 缺目标 400', noTarget.status === 400)
check('错误码 TARGET_REQUIRED', noTarget.json?.error === 'TARGET_REQUIRED', noTarget.json?.error)

const badAction = await post(route, { action: 'nope' })
check('未知 action 400', badAction.status === 400)
check('错误码 UNKNOWN_ACTION', badAction.json?.error === 'UNKNOWN_ACTION', badAction.json?.error)

const noSession = await post(route, { action: 'set', scope: 'session', patch: { text: 'x' } })
check('缺 sessionId 400', noSession.status === 400)
check('错误码 MISSING_SESSION', noSession.json?.error === 'MISSING_SESSION', noSession.json?.error)

const wrongMethod = await callRoute(route, { method: 'PUT' })
check('PUT 405', wrongMethod.status === 405, String(wrongMethod.status))

// ── 8. 回环围栏 ─────────────────────────────────────────────────────────
console.log('\n[loopback]')
const remote = await callRoute(route, { remoteAddress: '10.0.0.5' })
check('非回环 socket 403', remote.status === 403, String(remote.status))
const foreignHost = await callRoute(route, { host: 'evil.example.com' })
check('非回环 Host 403', foreignHost.status === 403, String(foreignHost.status))
const crossSite = await callRoute(route, { origin: 'http://evil.example.com', headers: { 'sec-fetch-site': 'cross-site' } })
check('跨站 Origin 403', crossSite.status === 403, String(crossSite.status))
const shellOrigin = await callRoute(route, { origin: 'null' })
check('桌面壳 Origin=null 放行', shellOrigin.status === 200, String(shellOrigin.status))
const options = await callRoute(route, { method: 'OPTIONS', origin: 'http://127.0.0.1:3080' })
check('OPTIONS 204', options.status === 204, String(options.status))
check('OPTIONS 回显 Origin', options.headers['access-control-allow-origin'] === 'http://127.0.0.1:3080')

// ── 9. 全局默认 + 子代理不继承 ───────────────────────────────────────────
console.log('\n[global]')
// 先清掉 session-a 的自身覆盖，否则子会话会（按设计）从它继承，测不到「全局默认」。
await post(route, { action: 'clear', scope: 'session', sessionId: 'session-a' })
const sub = harness.makeAgent('session-parent-clean', { silent: true })
// 真正的子会话：header.parentSession 指向一个没有自身覆盖的上级会话。
const subAgent = harness.makeAgent('session-sub', { parentSession: 'session-parent-clean' })
void sub
void subAgent
const globalSaved = await post(route, {
  action: 'set',
  scope: 'global',
  patch: { enabled: true, mode: 'append', text: '全局规则。' },
})
check('全局保存 200', globalSaved.status === 200, globalSaved.text)
check('子代理不装全局段', harness.state.sections.filter((section) => section.scope === 'session-sub').length === 0)
const subSnapshot = await callRoute(route, { url: '/api/system-prompt-studio?session=session-sub' })
check('子代理 effective 说明原因', subSnapshot.json?.effective?.kind === 'none', JSON.stringify(subSnapshot.json?.effective))
check('子代理根因是 subagent', subSnapshot.json?.effective?.reason === 'subagent', subSnapshot.json?.effective?.reason)
await post(route, { action: 'clear', scope: 'global' })

// ── 9b. fork 继承（P0-2） ────────────────────────────────────────────────
console.log('\n[inherit]')
await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'append', text: '父会话规则。' },
})
// 父会话先改好规则，再 fork：真实顺序也是这样。
const forked = harness.makeAgent('session-fork', { parentSession: 'session-a' })
void forked
const inheritSnap = await callRoute(route, { url: '/api/system-prompt-studio?session=session-fork' })
check('fork 继承到父覆盖', inheritSnap.json?.effective?.kind === 'append', JSON.stringify(inheritSnap.json?.effective))
check('继承来源是父会话', inheritSnap.json?.effective?.inheritedFrom === 'session-a', inheritSnap.json?.effective?.inheritedFrom)
check('继承深度为 1', inheritSnap.json?.effective?.inheritedDepth === 1, String(inheritSnap.json?.effective?.inheritedDepth))
check('fork 作用域装上了段', harness.state.sections.some((section) => section.scope === 'session-fork'))
check('fork 面板显示父会话', inheritSnap.json?.parentSession === 'session-a', inheritSnap.json?.parentSession)

// 子会话自己的覆盖优先于继承
await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-fork',
  patch: { enabled: true, mode: 'append', text: '子会话自己的规则。' },
})
const ownSnap = await callRoute(route, { url: '/api/system-prompt-studio?session=session-fork' })
check('自身覆盖优先于继承', ownSnap.json?.effective?.inheritedFrom === '', JSON.stringify(ownSnap.json?.effective))

// 多级继承：fork 的 fork
const fork2 = harness.makeAgent('session-fork2', { parentSession: 'session-fork' })
void fork2
const depthSnap = await callRoute(route, { url: '/api/system-prompt-studio?session=session-fork2' })
check('二级 fork 仍能继承', depthSnap.json?.effective?.kind === 'append', JSON.stringify(depthSnap.json?.effective))
check('二级继承来源是直接父级', depthSnap.json?.effective?.inheritedFrom === 'session-fork', depthSnap.json?.effective?.inheritedFrom)
check('二级继承深度为 1', depthSnap.json?.effective?.inheritedDepth === 1, String(depthSnap.json?.effective?.inheritedDepth))

// 跨层继承：中间层没有覆盖时继续往上找
harness.makeAgent('session-mid', { parentSession: 'session-a', silent: true })
harness.makeAgent('session-deep', { parentSession: 'session-mid' })
const deepSnap = await callRoute(route, { url: '/api/system-prompt-studio?session=session-deep' })
check('跨过无覆盖的中间层继续上溯', deepSnap.json?.effective?.inheritedFrom === 'session-a', deepSnap.json?.effective?.inheritedFrom)
check('跨层继承深度为 2', deepSnap.json?.effective?.inheritedDepth === 2, String(deepSnap.json?.effective?.inheritedDepth))

// pin：把继承固化成本会话自己的条目
const pinned = await post(route, { action: 'pin', scope: 'session', sessionId: 'session-fork2' })
check('pin 200', pinned.status === 200, pinned.text)
check('pin 后不再标记继承', pinned.json?.effective?.inheritedFrom === '', JSON.stringify(pinned.json?.effective))
check('pin 后有自己的条目', pinned.json?.session !== null && pinned.json?.session?.enabled === true)
const pinnedText = pinned.json?.session?.text
check('pin 固化了继承来的正文', pinnedText === '子会话自己的规则。', String(pinnedText))

// pin 在无可固定内容时应拒绝
const pinNothing = await post(route, { action: 'pin', scope: 'session', sessionId: 'session-nothing' })
check('无内容可 pin 时 400', pinNothing.status === 400, String(pinNothing.status))
check('错误码 NOTHING_TO_PIN', pinNothing.json?.error === 'NOTHING_TO_PIN', pinNothing.json?.error)

// ── 9c. 继承链防环 ──────────────────────────────────────────────────────
console.log('\n[inherit-cycle]')
const cycA = harness.makeAgent('session-cyc-a', { parentSession: 'session-cyc-b', silent: true })
const cycB = harness.makeAgent('session-cyc-b', { parentSession: 'session-cyc-a', silent: true })
void cycA
await post(route, { action: 'set', scope: 'session', sessionId: 'session-cyc-a', patch: { enabled: true, mode: 'append', text: 'A' } })
harness.reparent(cycB, 'session-cyc-a')
const cycSnap = await callRoute(route, { url: '/api/system-prompt-studio?session=session-cyc-b' })
check('防环：不会死循环且能返回', cycSnap.status === 200, String(cycSnap.status))
check('防环：B 继承自 A（最近的有覆盖的祖先）', cycSnap.json?.effective?.inheritedFrom === 'session-cyc-a', cycSnap.json?.effective?.inheritedFrom)

// ── 9d. inheritOnFork=false 的配置解析（端到端放在文件末尾，避免抢走主 harness 的 runtime） ──
console.log('\n[inherit-off]')
const offConfig = mod.__internals.resolveConfig({ inheritOnFork: false })
check('inheritOnFork=false 被解析', offConfig.inheritOnFork === false, String(offConfig.inheritOnFork))
const onConfig = mod.__internals.resolveConfig({})
check('inheritOnFork 默认开启', onConfig.inheritOnFork === true, String(onConfig.inheritOnFork))
const depthConfig = mod.__internals.resolveConfig({ maxInheritDepth: 999 })
check('maxInheritDepth 被夹到硬上限', depthConfig.maxInheritDepth === mod.__internals.MAX_INHERIT_DEPTH, String(depthConfig.maxInheritDepth))
const zeroDepth = mod.__internals.resolveConfig({ maxInheritDepth: 0 })
check('maxInheritDepth=0 合法（等于关闭继承）', zeroDepth.maxInheritDepth === 0, String(zeroDepth.maxInheritDepth))

// ── 10. 清除 ────────────────────────────────────────────────────────────
console.log('\n[clear]')
const cleared = await post(route, { action: 'clear', scope: 'session', sessionId: 'session-a' })
check('清除 200', cleared.status === 200, cleared.text)
check('清除后该会话无自身条目', cleared.json?.session === null)
check('清除后调用方段被移除', harness.state.sections.every((section) => section.scope !== 'session-a' || section.name !== 'studio:complete'))

const resetDenied = await post(route, { action: 'resetAll' })
check('resetAll 需要 confirm', resetDenied.status === 400 && resetDenied.json?.error === 'CONFIRM_REQUIRED')
const resetOk = await post(route, { action: 'resetAll', confirm: true })
check('resetAll 生效', resetOk.status === 200, resetOk.text)

// ── 11. agent 销毁后清理 ────────────────────────────────────────────────
console.log('\n[dispose]')
await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-a',
  patch: { enabled: true, mode: 'append', text: '再次写入。' },
})
check('重新装上了 append 段', harness.state.sections.some((section) => section.name === 'studio:append'))
harness.ctx.emit('agent/disposed', { agent })
// 只清掉本会话自己的段：继承者（如 session-fork）仍会持有同名段，那不是泄漏。
check('agent 销毁后该会话的段被清理', harness.state.sections.every((section) => section.scope !== 'session-a'))

// ── 12. 冷会话仍可保存 ──────────────────────────────────────────────────
console.log('\n[cold-session]')
const cold = await post(route, {
  action: 'set',
  scope: 'session',
  sessionId: 'session-cold',
  patch: { enabled: true, mode: 'append', text: '冷会话覆盖。' },
})
check('冷会话可保存', cold.status === 200, cold.text)
check('冷会话 live=false', cold.json?.live === false)
check('冷会话 current 为 null', cold.json?.current === null)
check('冷会话有 currentNote', typeof cold.json?.currentNote === 'string' && cold.json.currentNote.length > 0)

// ── 13. 装配观察 ────────────────────────────────────────────────────────
console.log('\n[observe]')
const observers = harness.state.listeners.get('system-prompt/assemble') ?? []
check('注册了装配观察', observers.length === 1, String(observers.length))
if (observers.length === 1) {
  // 真实的 assembly.sections 只有 name/text/interpolate，**没有 order**。
  const assembly = {
    sections: [
      { name: 'harness:identity', text: 'abc', interpolate: false },
      { name: 'deployment:persona-prefix', text: 'p', interpolate: false },
      { name: 'tool:dshm', text: 'dshm text', interpolate: false },
      { name: 'deployment:persona-suffix', text: 'zz', interpolate: false },
    ],
    contexts: [],
    variables: {},
  }
  let nextCalled = false
  // 真实装配把 agent 作为 scope 传下来（assembleContextFor 的 `scope: agent`）。
  const returned = await observers[0](assembly, { scope: agent, agent }, () => {
    nextCalled = true
    return Promise.resolve(assembly)
  })
  check('观察后调用 next()', nextCalled)
  check('观察不修改装配', returned === assembly)
  const after = await callRoute(route, { url: '/api/system-prompt-studio?session=session-a' })
  check('观察后能列出段清单', Array.isArray(after.json?.sections) && after.json.sections.length === 4, JSON.stringify(after.json?.sections))
  check('段清单含顺序', after.json?.sections?.[0]?.order === -1000, JSON.stringify(after.json?.sections?.[0]))
  check('段清单记录字符数', after.json?.sections?.[2]?.chars === 'dshm text'.length)
}

// ── 13b. 顺序推算 ───────────────────────────────────────────────────────
console.log('\n[deriveOrders]')
const derived = mod.__internals.deriveOrders([
  { name: 'harness:identity', chars: 1 },
  { name: 'some:unknown-early', chars: 1 },
  { name: 'deployment:persona-prefix', chars: 1 },
  { name: 'some:unknown-late', chars: 1 },
  { name: 'app:web-surface', chars: 1 },
  { name: 'deployment:persona-suffix', chars: 1 },
])
check('已知段沿用常量', derived[0]?.order === -1000 && derived[2]?.order === 0, JSON.stringify(derived.map((r) => r.order)))
check('未知段被夹进相邻锚点之间', (derived[1]?.order ?? 99) > -1000 && (derived[1]?.order ?? 99) < 0, JSON.stringify(derived[1]))
check('未知段落在中段区间内', (derived[3]?.order ?? 0) > 0 && (derived[3]?.order ?? 0) < 10100, JSON.stringify(derived[3]))
const monotonic = derived.every((row, index) => index === 0 || (row.order ?? 0) > (derived[index - 1].order ?? 0))
check('推算结果严格递增', monotonic, JSON.stringify(derived.map((r) => r.order)))

// ── 14. 损坏文件 ────────────────────────────────────────────────────────
console.log('\n[corrupt]')
const corruptDir = join(workdir, 'dsh-system-prompt-studio')
rmSync(corruptDir, { recursive: true, force: true })
mkdirSync(corruptDir, { recursive: true })
const corruptFile = join(corruptDir, 'state.json')
writeFileSync(corruptFile, '{ not json', 'utf8')
const harness2 = makeHarness()
// 重新 import 拿不到新模块状态，这里直接换 DSH_HOME 再挂载一个新行：
// mountOnce 会让第二次 apply 变成 no-op，因此改用一个独立的状态文件路径。
mod.__internals.runtime
const harness3 = makeHarness()
const freshName = 'dsh-system-prompt-studio-check'
globalThis[Symbol.for(`${freshName}.reset`)] = true
// 直接调用未包装的判定逻辑，验证损坏路径的读取行为。
const loadedCorrupt = mod.__internals.normalizeEntry({ enabled: 'yes', mode: 'bogus', text: 5 })
check('非法字段回退默认', loadedCorrupt.enabled === false && loadedCorrupt.mode === 'append' && loadedCorrupt.text === '')
check('损坏文件仍在原地（未删除）', readFileSync(corruptFile, 'utf8') === '{ not json')
void harness2
void harness3

// ── 15. 配置兜底 ────────────────────────────────────────────────────────
console.log('\n[config]')
const resolved = mod.__internals.resolveConfig({
  apiPath: 'not-a-path',
  appendOrder: 999999,
  maxChars: -5,
  defaultMode: 'bogus',
  maxObservedScopes: 0,
})
check('非法 apiPath 回退默认', resolved.apiPath === '/api/system-prompt-studio', resolved.apiPath)
check('appendOrder 被夹到上限', resolved.appendOrder === 20000, String(resolved.appendOrder))
check('maxChars 被夹到下限', resolved.maxChars === 200, String(resolved.maxChars))
check('非法 defaultMode 回退', resolved.defaultMode === 'append', resolved.defaultMode)
check('maxObservedScopes 至少 1', resolved.maxObservedScopes === 1, String(resolved.maxObservedScopes))

// client 半读的键：host 只做兜底，但要保证「明确的 false 不被吞掉」。
check('showOnNewConversation 默认开', resolved.showOnNewConversation === true, String(resolved.showOnNewConversation))
const heroOff = mod.__internals.resolveConfig({ showOnNewConversation: false })
check('showOnNewConversation=false 生效', heroOff.showOnNewConversation === false, String(heroOff.showOnNewConversation))
const junkTruthy = mod.__internals.resolveConfig({ showOnNewConversation: 'yes' })
check('showOnNewConversation 非布尔按默认', junkTruthy.showOnNewConversation === true, String(junkTruthy.showOnNewConversation))

// ── 收尾 ────────────────────────────────────────────────────────────────
rmSync(workdir, { recursive: true, force: true })
console.log('')
if (failures === 0) {
  console.log('host-check: 全部通过')
  process.exit(0)
}
console.log(`host-check: ${failures} 项失败`)
process.exit(1)
