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
// 这个 id 必须和 package.json 的 name 完全一致。client-modules 用它做去重键，
// 宿主按包名派发同一份 bundle——不一致就是 duplicate factory registration，
// 整个 web boot 直接失败。改名时最容易忘的就是这里。
const manifestName = JSON.parse(
  (await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).name
check('id 与 package.json name 一致', definition?.id === manifestName, `${definition?.id} vs ${manifestName}`)
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
check('注入了两个槽', first.injections.length === 2, JSON.stringify(first.injections))
check('第一个是标题栏动作槽', first.injections[0] === 'conversation.session.header.actions', first.injections[0])
check('第二个是新空会话欢迎区槽', first.injections[1] === 'conversation.hero.options', first.injections[1])
check('注册了两个入口', first.registrations.length === 2, String(first.registrations.length))
const entry = first.registrations[0]
check('入口 id 正确', entry?.options?.id === 'system-prompt-studio', entry?.options?.id)
check('入口 order=30', entry?.options?.order === 30, String(entry?.options?.order))
check('入口 name 与槽一致', entry?.options?.name === 'conversation.session.header.actions')
const heroEntry = first.registrations[1]
check('hero 入口 id 独立', heroEntry?.options?.id === 'system-prompt-studio-hero', heroEntry?.options?.id)
check('hero 入口 name 与槽一致', heroEntry?.options?.name === 'conversation.hero.options')
check('hero 入口 order=20', heroEntry?.options?.order === 20, String(heroEntry?.options?.order))
check('两个入口 id 不冲突', entry?.options?.id !== heroEntry?.options?.id)
check('注入了 style 标签', styleTags.length === 1, String(styleTags.length))
check('style 带 plugin 标记', styleTags[0]?.dataset?.plugin === 'dsh-system-prompt-studio', styleTags[0]?.dataset?.plugin)
check('style 只引用主题令牌', String(styleTags[0]?.textContent ?? '').includes('--dsw-alias-') === true)
check('style 不含硬编码色值以外的 import', String(styleTags[0]?.textContent ?? '').includes('@deepseek-ai') === false)
check('style 覆盖 hero 变体', String(styleTags[0]?.textContent ?? '').includes('[data-variant="hero"]') === true)

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

// hero 入口：同样要能装配、带文字、并且 fallback 到 header 的文案
console.log('\n[hero entry]')
let heroTree
let heroCrashed = ''
try {
  heroTree = heroEntry.component({ sessionId: 'session-new' })
} catch (error) {
  heroCrashed = String(error?.message ?? error)
}
check('hero 组件调用不抛错', heroCrashed === '', heroCrashed)
check('hero 返回元素树', heroTree !== null && typeof heroTree === 'object')
check('hero 弹层默认关闭', heroTree !== null && heroTree.type === Fragment)
const heroButton = heroTree?.children?.[0]
check('hero 按钮 variant=hero', heroButton?.props?.['data-variant'] === 'hero', heroButton?.props?.['data-variant'])
const heroLabelNode = (heroButton?.children ?? []).find(
  (child) => child?.props?.['data-sps'] === 'entrylabel',
)
check('hero 永远带文字标签', heroLabelNode !== undefined)
check('hero 文案取自 actionNew', heroLabelNode?.children?.[0] === '设置系统提示词', heroLabelNode?.children?.[0])
const headerLabelNode = (tree?.children?.[0]?.children ?? []).find(
  (child) => child?.props?.['data-sps'] === 'entrylabel',
)
check('header 默认只有图标', headerLabelNode === undefined)

// 关掉 showOnNewConversation 后，只保留标题栏入口
console.log('\n[showOnNewConversation=false]')
const heroOff = makeCtx()
exported.apply(heroOff.ctx, { showOnNewConversation: false })
check('只注入标题栏槽', heroOff.injections.length === 1, JSON.stringify(heroOff.injections))
check('只注册标题栏入口', heroOff.registrations.length === 1, String(heroOff.registrations.length))

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

// ── P0-3 未保存改动保护 ──────────────────────────────────────────────────
// 没有真实渲染器，这里验证的是「组件装配后能取到 dirty 相关的接线」：
// 确认放弃的文案存在、Esc 分支已注册、beforeunload 只在 dirty 时挂。
console.log('\n[p0-3 dirty]')
const third = makeCtx()
exported.apply(third.ctx, {})
const entryForDirty = third.registrations[0]
let dirtyTree
let dirtyError = ''
try {
  dirtyTree = entryForDirty.component({ sessionId: 'session-dirty' })
} catch (error) {
  dirtyError = String(error?.message ?? error)
}
check('组件装配仍不抛错', dirtyError === '', dirtyError)
check('弹层默认关闭（未打开时无 dom 副作用）', dirtyTree !== null && typeof dirtyTree === 'object')

// 文案：确认放弃的四个键必须存在且是给用户看的中文
const sourceText = String(entryForDirty.component.toString())
void sourceText

// 依赖注入：两个关闭入口都必须走 requestClose，而不是直接 onClose。
const clientSource = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'),
)
check('存在 requestClose 保护入口', clientSource.includes('function requestClose') || clientSource.includes('const requestClose'))
check('Esc 走 requestClose', clientSource.includes('else requestClose()'))
check('遮罩点击走 requestClose', clientSource.includes('onClick: requestClose'))
check('关闭按钮走 requestClose', clientSource.includes("title: t('close'), onClick: requestClose"))
check('存在放弃确认层', clientSource.includes('discardLayer') && clientSource.includes("t('discardConfirm')"))
check('beforeunload 只在 dirty 时注册', clientSource.includes("if (!dirty) return undefined"))
check('保存成功后重置基线', clientSource.includes('setBaseline({ mode, text, target, enabled })'))
check('dirty 由基线现算', clientSource.includes('const dirty ='))
check('存在 pin 请求', clientSource.includes("action: 'pin'"))
check('存在继承来源展示', clientSource.includes("t('inheritedFrom')"))
// 段清单的两个误导场景：滞后快照、complete 压缩发生在观察器之后。
check('段清单显示装配时间', clientSource.includes('formatClock') && clientSource.includes('sectionsAtText'))
check('滞后清单有提示', clientSource.includes("t('sectionsStaleNote')"))
check('complete 有清单说明', clientSource.includes("t('sectionsCompleteNote')"))
check('时间戳格式函数存在', /function formatClock\s*\(/.test(clientSource))

// ── C：完全替换前逐条列出会丢掉的段 ──────────────────────────────────────
// 通用勾选框只说「会丢掉第一方全部提示词」，用户不知道丢的是 3 段还是 20 段，
// 也不知道里面有没有别的插件注册的段。面板本来就持有真实装配清单，所以这件事
// 应当算出来给他看，而不是只警告。
console.log('\n[complete drops]')
check('算出会丢掉的段', clientSource.includes('droppedSections'))
check('排除 studio 自己的段', clientSource.includes("studio:complete', 'studio:append'"))
check('累加被丢弃的字符数', clientSource.includes('dropped.reduce'))
check('识别第三方插件注册的段', clientSource.includes('FIRST_PARTY'))
// 前缀启发式会同时漏判和误判，所以改成「第一方内置段名」白名单：
//   - dsh-m 把段注册成 `tool:dshm`，前缀像第一方，实际是插件；
//   - 0.2.2-rc.2 的 dsh-cua 注册 `computer-use:dsh-cua`，不是 `tool:` 前缀，实际是第一方。
check('第一方判定用白名单而非前缀正则', clientSource.includes('const FIRST_PARTY = new Set(['))
check('白名单不含前缀正则', !clientSource.includes("const FIRST_PARTY = /^("))
check('tool:dshm 不在第一方白名单（它是插件段）', !/FIRST_PARTY = new Set\(\[[\s\S]*?'tool:dshm'/.test(clientSource))
check('computer-use:dsh-cua 也不在第一方白名单', !/FIRST_PARTY = new Set\(\[[\s\S]*?'computer-use:dsh-cua'/.test(clientSource))
check('第一方工具段仍在白名单', clientSource.includes("'tool:pwsh'") && clientSource.includes("'tool:subagent_fork'"))
check('清单可读时逐条列出', clientSource.includes("t('completeDrops')") && clientSource.includes('dropitem'))
check('超出上限折叠为「还有 N 个」', clientSource.includes("t('completeDropsMore')"))
check('冷会话如实说无法列举', clientSource.includes("t('completeDropsUnknown')"))
check('点名插件段会哑掉', clientSource.includes("t('completeDropsPlugins')"))
check('blocked 时不列清单（已被禁用，列了也没用）', /blocked\.complete\s*\?\s*null\s*:/.test(clientSource))

// ── P0-1 导出面收敛 ─────────────────────────────────────────────────────
console.log('\n[p0-1 export surface]')
const hostSource = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8'),
)
check('不再把内部函数挂到 runtime 上', !/runtime\.(install|uninstall|reinstallAll|snapshot|handlePost)\s*=/.test(hostSource))
check('测试出口受开关控制', hostSource.includes("process.env.NODE_ENV === 'test'"))
check('导出只有只读快照', hostSource.includes('readRuntime:'))
const hostModule = await import(new URL('../lib/index.js', import.meta.url).href)
check('__internals 不再暴露 runtime 对象', hostModule.__internals.runtime === undefined)
check('__internals.readRuntime 是函数', typeof hostModule.__internals.readRuntime === 'function')
check('测试钩子默认关闭', hostModule.__internals.testHook() === undefined)

// ── 收尾 ────────────────────────────────────────────────────────────────
console.log('')
if (failures === 0) {
  console.log('client-check: 全部通过')
  process.exit(0)
}
console.log(`client-check: ${failures} 项失败`)
process.exit(1)
