// dsh-system-prompt-studio — Client 半结构测试。
//
// 没有真实浏览器 / React 渲染器，这里只验证「接线」：
//   1. 模块在 window.__ModuleLoader__ 下注册，id 正确；
//   2. factory 返回 { inject, apply }，inject 含 slots；
//   3. apply 往 conversation.session.header.actions 注册一个入口（id/order 正确）；
//   4. 组件能以假 React 调通一次、产出元素树、不抛错；
//   5. 卸载时移除注入的 <style>；
//   6. visible=false 时不注册。
//
// 运行：node test/client-check.mjs

const loaded = []
const styleTags = []
const listeners = []

const fakeDocument = {
  head: {
    appendChild(node) {
      if (node?.tagName === 'style') styleTags.push(node)
    },
  },
  body: { nodeName: 'BODY' },
  createElement(tag) {
    return {
      tagName: tag,
      dataset: {},
      textContent: '',
      remove() {
        const index = styleTags.indexOf(this)
        if (index >= 0) styleTags.splice(index, 1)
      },
    }
  },
  querySelector(selector) {
    if (selector.startsWith('style[data-plugin=')) return styleTags[0] ?? null
    return null
  },
  addEventListener(type, listener) {
    listeners.push({ type, listener })
  },
  removeEventListener(type, listener) {
    const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
    if (index >= 0) listeners.splice(index, 1)
  },
  createRange() {
    return { selectNodeContents() {} }
  },
}

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  location: { origin: 'http://127.0.0.1:3080' },
}
globalThis.document = fakeDocument
// Node 22+ 的 navigator 是只读 getter，用 defineProperty 覆盖。
try {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => {} } },
  })
} catch {
  /* 某些运行时不允许覆盖；组件只在点击复制时读它。 */
}
globalThis.fetch = async () => {
  throw new Error('fetch should not run in this structural test')
}

// ── 假 React ────────────────────────────────────────────────────────────
const Fragment = Symbol.for('react.fragment')
const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  Fragment,
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {
    return undefined
  },
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    return { current: initial ?? null }
  },
}

const portals = []
const fakeReactDOM = {
  createPortal(node, container) {
    portals.push({ node, container })
    return node
  },
}

const requireShim = (id) => {
  if (id === 'react') return fakeReact
  if (id === 'react-dom') return fakeReactDOM
  throw new Error(`unexpected require: ${id}`)
}

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ── 载入模块 ────────────────────────────────────────────────────────────
await import(new URL('../lib/client.js', import.meta.url).href)

console.log('\n[module]')
check('通过 __ModuleLoader__ 注册', loaded.length === 1, String(loaded.length))
const definition = loaded[0]
check('id 正确', definition?.id === 'dsh-system-prompt-studio', definition?.id)
check('factory 是函数', typeof definition?.factory === 'function')

const exported = definition.factory(requireShim)
console.log('\n[exports]')
check('返回对象', exported !== null && typeof exported === 'object')
check('inject 含 slots', Array.isArray(exported.inject) && exported.inject.includes('slots'), JSON.stringify(exported.inject))
check('apply 是函数', typeof exported.apply === 'function')

// ── apply 的注册 ────────────────────────────────────────────────────────
function makeCtx() {
  const registrations = []
  const injections = []
  const effects = []
  const ctx = {
    get(name) {
      if (name === 'locale') {
        return { getLocale: () => ({ id: 'zh-CN' }) }
      }
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        const dispose = callback()
        return dispose
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, injections, effects }
}

console.log('\n[apply]')
const first = makeCtx()
exported.apply(first.ctx, {})
check('注入了一个槽', first.injections.length === 1, JSON.stringify(first.injections))
check('注入的是标题栏动作槽', first.injections[0] === 'conversation.session.header.actions', first.injections[0])
check('注册了一个入口', first.registrations.length === 1, String(first.registrations.length))
const entry = first.registrations[0]
check('入口 id 正确', entry?.options?.id === 'system-prompt-studio', entry?.options?.id)
check('入口 order=30', entry?.options?.order === 30, String(entry?.options?.order))
check('入口 name 与槽一致', entry?.options?.name === 'conversation.session.header.actions')
check('注入了 style 标签', styleTags.length === 1, String(styleTags.length))
check('style 带 plugin 标记', styleTags[0]?.dataset?.plugin === 'dsh-system-prompt-studio', styleTags[0]?.dataset?.plugin)
check('style 只引用主题令牌', String(styleTags[0]?.textContent ?? '').includes('--dsw-alias-') === true)
check('style 不含硬编码色值以外的 import', String(styleTags[0]?.textContent ?? '').includes('@deepseek-ai') === false)

// ── 组件能否调通 ────────────────────────────────────────────────────────
console.log('\n[component]')
let tree
let crashed = ''
try {
  tree = entry.component({ sessionId: 'session-a' })
} catch (error) {
  crashed = String(error?.message ?? error)
}
check('组件调用不抛错', crashed === '', crashed)
check('返回元素树', tree !== null && typeof tree === 'object')
check('弹层默认关闭', tree !== null && tree.type === Fragment)

// 关掉 visible 后不应注册
console.log('\n[visible=false]')
const second = makeCtx()
exported.apply(second.ctx, { visible: false })
check('visible=false 时没有注入', second.injections.length === 0, JSON.stringify(second.injections))
check('visible=false 时没有注册', second.registrations.length === 0, String(second.registrations.length))

// ── 卸载清理 ────────────────────────────────────────────────────────────
console.log('\n[dispose]')
check('卸载前有 style', styleTags.length === 1, String(styleTags.length))
const disposer = first.effects[0]
if (typeof disposer === 'function') disposer()
check('卸载后 style 被移除', styleTags.length === 0, String(styleTags.length))

// ── 收尾 ────────────────────────────────────────────────────────────────
console.log('')
if (failures === 0) {
  console.log('client-check: 全部通过')
  process.exit(0)
}
console.log(`client-check: ${failures} 项失败`)
process.exit(1)
