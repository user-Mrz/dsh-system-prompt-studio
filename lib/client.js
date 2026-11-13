// dsh-system-prompt-studio — Client 半（Web / 桌面壳共用同一份）。
//
// 契约：client-module 扫描器打包 `exports["./client"]`，页面在
// `window.__ModuleLoader__` 下求值。factory 拿到一个 `require`，返回带
// `inject` 与 `apply` 的对象。
//
// ⚠️ 下面 `load({ id })` 里的 id **必须等于 package.json 的 name**。
// client-modules 的 register() 用 `registration.id` 作为去重键
// （`stripClientSuffix(registration.id)`），而宿主按包名派发同一份 bundle。
// 两者不一致时，同一个 bundle 会以两个 id 注册，运行期直接抛
// `duplicate factory registration for "…"`，整个 web boot 失败。
// 包名从 `dsh-system-prompt-studio` 改成 `@user-mrz/dsh-system-prompt-studio`
// 时踩过这个坑：宿主按 scoped 名派发，这里仍写短名，DSH 起不来。
//
// 三个注册点：
//   1. `conversation.session.header.actions` —— 标题栏入口按钮（已发过消息的对话）；
//   2. `conversation.hero.options` —— 新空会话欢迎区的入口。空会话是官方的
//      hero 态，标题栏整行带 `hideChrome`，`header.actions` 根本不渲染，
//      只有这个槽在 hero 态存在。缺了它，「只给这个新对话设覆盖」就没有入口。
//   3. 弹层本身用 react-dom 的 createPortal 挂到 document.body —— 该槽的
//      说明写明「溢出会被裁剪，弹层必须 portal」，所以不在槽内直接撑开。
//
// 数据全部来自 Host 半的回环路由（`api/system-prompt-studio`，文档相对路径，
// Web 与桌面壳都会走同源转发）。

window.__ModuleLoader__.load({
  id: '@user-mrz/dsh-system-prompt-studio',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const inject = ['slots']

    const API_PATH = 'api/system-prompt-studio'
    const FALLBACK_HOST = 'http://127.0.0.1:3080'
    const STYLE_ID = 'dsh-system-prompt-studio'

    // ── 文案（内建中文/英文；有 locale 服务时再叠加注册） ────────────────
    const TEXT = {
      zh: {
        action: '系统提示词',
        actionNew: '设置系统提示词',
        newConversationNote: '这个对话还没发过消息，但 agent 已经在了：现在保存，第一句话就带着这段提示词生效。',
        title: '系统提示词',
        subtitle: '按对话覆盖模型实际收到的系统提示词',
        close: '关闭',
        scopeSession: '本对话',
        scopeWorkspace: '本工作区',
        scopeGlobal: '全局默认',
        scopeWorkspaceHint: '这个工作区下所有对话都套用（含子代理）；按侧边栏里的工作区归属算。',
        scopeWorkspaceNoDir: '这个对话没有可用的工作区，无法按工作区保存。',
        scopeWorkspacePath: '工作区：',
        workspaceEmpty: '这个工作区还没有规则',
        workspaceSaved: '已保存为这个工作区的规则，它下面的对话下一次请求生效。',
        workspaceCleared: '已清除这个工作区的规则。',
        workspaceFrom: '当前规则来自这个工作区：',
        scopeGlobalHint: '所有没有自身覆盖的顶层对话都套用（不含子代理）。',
        modeAppend: '追加到末尾',
        modeAppendHint: '保留第一方全部提示词，只在末尾追加你的段落。',
        modeReplace: '替换指定段',
        modeReplaceHint: '用同名段影子覆盖第一方段落；段名从下面的实测清单里选。',
        modeComplete: '完全替换',
        modeCompleteHint: '只发你写的内容。第一方的工具使用说明、结构化输出指引等提示词全部消失，可能明显影响工具调用质量。',
        modeCompleteRisk: '运行时上下文（工作目录 / 沙箱 / 审批策略）仍会随请求发送，不会被这段替换。',
        modeCompleteAck: '我已了解：这会丢掉第一方全部提示词',
        completeDrops: '本次会丢弃以下段（共 {n} 个，{chars} 字符）：',
        completeDropsMore: '…以及另外 {n} 个段',
        completeDropsUnknown: '该对话还没有装配过提示词，所以现在无法列出会被丢弃的段。发一条消息后再打开这里，就能看到真实清单。',
        completeDropsPlugins: '注意：其中包含其它插件注册的段（{n} 个）。丢掉它们之后，那些插件的工具会「装着但模型不知道该怎么用」。',
        completeDropAll: '全部丢弃',
        target: '目标段',
        targetHint: '该对话跑过请求后，下拉框就是真实段名；手动填不存在的段名会变成新增段。',
        body: '正文',
        bodyHint: '{{…}} 会原样保留，不会被当作变量插值。',
        chars: '字符',
        enable: '在本对话启用覆盖',
        enableWorkspace: '在本工作区启用覆盖',
        enableGlobal: '在全局默认启用覆盖',
        save: '保存',
        clear: '清除覆盖',
        saving: '保存中…',
        saved: '已保存，本对话下一次模型请求生效。',
        savedLocal: '已保存到内存，但写入磁盘失败，重启后会丢失。',
        cleared: '已清除覆盖。',
        current: '最近一次请求的系统提示词',
        currentEmpty: '（还没有可读的系统提示词）',
        copy: '复制',
        copied: '已复制',
        sections: '本对话装配到的段',
        sectionsStaleNote: '这份清单来自上一次模型请求，早于你刚才的保存。发一条消息后再打开，就能看到新结果。',
        sectionsCompleteNote: '当前是「完全替换」模式：上面这份清单是替换前的全量段，实际发送时只会保留 studio:complete 一个段。',
        sectionName: '段名',
        sectionOrder: '顺序',
        sectionChars: '字符',
        refresh: '刷新',
        loading: '读取中…',
        disabledNoService: '当前 profile 没有装配 systemPrompt 服务，覆盖无法生效。',
        disabledNoAgents: '当前 profile 没有 agents 服务，覆盖无法挂到对话上。',
        disabledOff: '插件在配置里被停用了（enabled: false）。',
        completeBlocked: '配置里 allowComplete=false，完全替换模式被禁用。',
        fetchFailed: '读取失败：',
        saveFailed: '保存失败：',
        prefixCache: '提示：系统提示词一变，该对话的缓存前缀会从首个变化的 token 起失效，下一次请求按新前缀计费。',
        inherited: '该对话当前没有自身覆盖，正在使用全局默认。',
        inheritedFrom: '当前规则继承自：',
        inheritedNone: '该对话是从别的对话分叉出来的，但上游没有可继承的规则。',
        pin: '在此固定',
        pinned: '已固定为本对话自己的规则，之后上游再改也不影响这里。',
        discardTitle: '放弃未保存的修改？',
        discardBody: '你有改动还没保存。关闭面板会丢掉这些改动——它们不会被写入任何地方。',
        discardKeep: '继续编辑',
        discardConfirm: '放弃并关闭',
        emptyText: '启用覆盖但正文为空，请填写正文。',
        targetRequired: '替换模式必须填写目标段名。',
        subagentNote: '子代理会话默认不继承全局默认。',
      },
      en: {
        action: 'System prompt',
        actionNew: 'Set system prompt',
        newConversationNote: 'This conversation has not sent a message yet, but its agent already exists: saving now applies the prompt from the very first message.',
        title: 'System prompt',
        subtitle: 'Override the system prompt this conversation actually sends',
        close: 'Close',
        scopeSession: 'This conversation',
        scopeWorkspace: 'This workspace',
        scopeGlobal: 'Global default',
        scopeWorkspaceHint: 'Applied to every conversation in this workspace (subagents included); keyed on the workspace the sidebar shows.',
        scopeWorkspaceNoDir: 'This conversation has no usable workspace, so a workspace override cannot be saved.',
        scopeWorkspacePath: 'Workspace: ',
        workspaceEmpty: 'no rules for this workspace yet',
        workspaceSaved: 'Saved as this workspace\'s rules; applies to its conversations on their next request.',
        workspaceCleared: 'Cleared this workspace\'s rules.',
        workspaceFrom: 'Current rules come from this workspace: ',
        scopeGlobalHint: 'Applied to every top-level conversation without an override of its own (not subagents).',
        modeAppend: 'Append',
        modeAppendHint: 'Keep every first-party section and add yours at the end.',
        modeReplace: 'Replace a section',
        modeReplaceHint: 'Shadow one first-party section by name; pick a real name from the list below.',
        modeComplete: 'Replace everything',
        modeCompleteHint: 'Only your text is sent. First-party guidance such as tool instructions and structured-output rules disappears, which can degrade tool use.',
        modeCompleteRisk: 'Runtime context (working directory, sandbox, approval policy) is still sent as a user-side snapshot.',
        modeCompleteAck: 'I understand this drops every first-party prompt.',
        completeDrops: 'This will drop these sections ({n} of them, {chars} characters):',
        completeDropsMore: '…and {n} more section(s)',
        completeDropsUnknown: 'This conversation has not assembled a prompt yet, so the sections that would be dropped cannot be listed. Send a message, then reopen this panel to see the real list.',
        completeDropsPlugins: 'Note: {n} of them are registered by other plugins. Dropping those leaves their tools installed but unexplained, so the model will not know how to call them.',
        completeDropAll: 'Drop all',
        target: 'Target section',
        targetHint: 'After this conversation has run a request, the list holds real section names.',
        body: 'Body',
        bodyHint: '{{…}} is kept literally and is not interpolated.',
        chars: 'chars',
        enable: 'Enable override for this conversation',
        enableWorkspace: 'Enable override for this workspace',
        enableGlobal: 'Enable override in the global default',
        save: 'Save',
        clear: 'Clear override',
        saving: 'Saving…',
        saved: 'Saved. It applies to this conversation on its next model request.',
        savedLocal: 'Saved in memory only: the file write failed, so it will be lost on restart.',
        cleared: 'Override cleared.',
        current: 'System prompt of the latest request',
        currentEmpty: '(nothing readable yet)',
        copy: 'Copy',
        copied: 'Copied',
        sections: 'Sections assembled for this conversation',
        sectionsStaleNote: 'This list is from the previous model request, before your last save. Send a message and reopen to see the new result.',
        sectionsCompleteNote: 'Replace-everything is active: the list above is the full pre-replacement set. Only studio:complete is actually sent.',
        sectionName: 'Section',
        sectionOrder: 'Order',
        sectionChars: 'Chars',
        refresh: 'Refresh',
        loading: 'Loading…',
        disabledNoService: 'This profile has no systemPrompt service, so overrides cannot take effect.',
        disabledNoAgents: 'This profile has no agents service, so overrides cannot attach to a conversation.',
        disabledOff: 'The plugin is disabled in its configuration (enabled: false).',
        completeBlocked: 'allowComplete=false in the configuration, so Replace everything is unavailable.',
        fetchFailed: 'Load failed: ',
        saveFailed: 'Save failed: ',
        prefixCache: 'Note: changing the system prompt invalidates this conversation\'s cached prefix from the first changed token.',
        inherited: 'This conversation has no override of its own and is using the global default.',
        inheritedFrom: 'Current rules inherited from: ',
        inheritedNone: 'This conversation was forked, but the upstream conversation has no rules to inherit.',
        pin: 'Pin here',
        pinned: 'Pinned as this conversation\'s own rules; later upstream changes will not affect it.',
        discardTitle: 'Discard unsaved changes?',
        discardBody: 'You have edits that have not been saved. Closing the panel discards them — they will not be written anywhere.',
        discardKeep: 'Keep editing',
        discardConfirm: 'Discard and close',
        emptyText: 'The override is enabled but the body is empty.',
        targetRequired: 'Replace mode needs a target section name.',
        subagentNote: 'Subagent conversations do not inherit the global default.',
      },
    }

    /** 极简取词：默认中文，页面语言为 en 时用英文。 */
    function makeText(ctx) {
      let lang = 'zh'
      try {
        const snapshot = ctx.get?.('locale')?.getLocale?.()
        const id = snapshot?.id ?? snapshot?.locale ?? ''
        if (typeof id === 'string' && id.toLowerCase().startsWith('en')) lang = 'en'
      } catch {
        lang = 'zh'
      }
      const table = TEXT[lang] ?? TEXT.zh
      return (key) => table[key] ?? TEXT.zh[key] ?? key
    }

    /** API 基址候选：文档相对 → 显式 hostURL → 页面 origin → 127.0.0.1:3080。 */
    function baseCandidates(hostURL) {
      const list = ['']
      const push = (value) => {
        if (typeof value !== 'string') return
        const trimmed = value.replace(/\/+$/u, '')
        if (trimmed !== '' && !list.includes(trimmed)) list.push(trimmed)
      }
      push(hostURL)
      try {
        const origin = globalThis.location?.origin
        if (typeof origin === 'string' && origin !== '' && origin !== 'null') push(origin)
      } catch {
        /* 没有 location 的壳 */
      }
      push(FALLBACK_HOST)
      return list
    }

    function createApi(config) {
      const bases = baseCandidates(config.hostURL)
      let active = null

      const urlFor = (base, sessionId) => {
        const query = sessionId === '' ? '' : `?session=${encodeURIComponent(sessionId)}`
        return `${base === '' ? '' : `${base}/`}${API_PATH}${query}`
      }

      async function attempt(method, sessionId, body) {
        const order = active === null ? bases : [active, ...bases.filter((base) => base !== active)]
        let lastError = null
        for (const base of order) {
          try {
            const response = await fetch(urlFor(base, sessionId), {
              method,
              cache: 'no-store',
              headers: body === undefined ? undefined : { 'content-type': 'application/json' },
              body: body === undefined ? undefined : JSON.stringify(body),
            })
            const text = await response.text()
            let payload
            try {
              payload = text === '' ? {} : JSON.parse(text)
            } catch {
              throw new Error(`HTTP ${response.status}（响应不是 JSON）`)
            }
            if (!response.ok) {
              const reason = payload?.message ?? payload?.error ?? `HTTP ${response.status}`
              const error = new Error(reason)
              error.status = response.status
              error.payload = payload
              throw error
            }
            active = base
            return payload
          } catch (error) {
            lastError = error
          }
        }
        throw lastError ?? new Error('no-reachable-host')
      }

      return {
        load: (sessionId) => attempt('GET', sessionId, undefined),
        save: (body) => attempt('POST', '', body),
      }
    }

    // ── 样式：只用 --dsw-alias-* 主题令牌 ────────────────────────────────
    const CSS = `
[data-sps="backdrop"]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);backdrop-filter:blur(3px)}
[data-sps="dialog"]{display:flex;flex-direction:column;width:min(920px,100%);max-height:min(86vh,900px);border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 24px 64px rgba(0,0,0,.32);font-size:13px;overflow:hidden}
[data-sps="head"]{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
[data-sps="headmain"]{flex:1;min-width:0}
[data-sps="title"]{font-size:15px;font-weight:600;line-height:1.3}
[data-sps="subtitle"]{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
[data-sps="close"]{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font:16px/1 monospace;padding:4px 8px;border-radius:6px}
[data-sps="close"]:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
[data-sps="body"]{padding:14px 18px 18px;overflow:auto;display:flex;flex-direction:column;gap:14px}
[data-sps="row"]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-sps="tabs"]{display:inline-flex;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
[data-sps="tab"]{appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:5px 12px;border-radius:7px}
[data-sps="tab"][data-on="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}
[data-sps="mode"]{display:flex;flex-direction:column;gap:8px}
[data-sps="radio"]{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer}
[data-sps="radio"][data-on="true"]{border-color:var(--dsw-alias-brand-primary)}
[data-sps="radio"][data-risk="true"][data-on="true"]{border-color:var(--dsw-alias-state-error-primary)}
[data-sps="radio"] input{margin:3px 0 0}
[data-sps="radiomain"]{flex:1;min-width:0}
[data-sps="radiokey"]{font-weight:600}
[data-sps="radiosub"]{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary)}
[data-sps="warn"]{padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);font-size:12px;line-height:1.5}
[data-sps="error"]{padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);font-size:12px;line-height:1.5;white-space:pre-wrap}
[data-sps="ok"]{padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);font-size:12px}
[data-sps="muted"]{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
[data-sps="label"]{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
[data-sps="input"],[data-sps="textarea"]{width:100%;box-sizing:border-box;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;padding:8px 10px}
[data-sps="textarea"]{min-height:200px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6}
[data-sps="input"]:focus,[data-sps="textarea"]:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
[data-sps="foot"]{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
[data-sps="spacer"]{flex:1}
[data-sps="button"]{appearance:none;cursor:pointer;font:inherit;font-size:12px;padding:7px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
[data-sps="button"]:hover{border-color:var(--dsw-alias-brand-primary)}
[data-sps="button"][data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600}
[data-sps="button"]:disabled{opacity:.55;cursor:not-allowed}
[data-sps="details"]{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px}
[data-sps="details"] summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
[data-sps="pre"]{margin:8px 0 0;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}
[data-sps="table"]{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
[data-sps="table"] th,[data-sps="table"] td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:400}
[data-sps="table"] th{color:var(--dsw-alias-label-secondary);font-weight:600}
[data-sps="table"] td[data-num="true"]{text-align:right;font-variant-numeric:tabular-nums}
[data-sps="entry"]{display:inline-flex;align-items:center;gap:6px;appearance:none;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;padding:4px 8px;border-radius:7px;max-width:220px}
[data-sps="entry"]:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
[data-sps="entry"][data-on="true"]{color:var(--dsw-alias-label-primary)}
[data-sps="entry"][data-variant="hero"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:999px;padding:5px 12px;font-weight:500;gap:7px}
[data-sps="entry"][data-variant="hero"]:hover{border-color:var(--dsw-alias-brand-primary)}
[data-sps="entry"][data-variant="hero"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
[data-sps="dot"]{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary)}
[data-sps="entrylabel"]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin="${STYLE_ID}"]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        try {
          tag.remove()
        } catch {
          /* 已被移除 */
        }
      }
    }

    function Icon({ size = 16 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('rect', { x: 2.5, y: 4, width: 19, height: 13, rx: 3.4, fill: 'currentColor', opacity: 0.22 }),
        h('rect', { x: 2.5, y: 4, width: 19, height: 13, rx: 3.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7 17.4h6l-3.2 3.6z', fill: 'currentColor', opacity: 0.55 }),
        h('circle', { cx: 8, cy: 9.4, r: 1.35, fill: 'currentColor' }),
        h('rect', { x: 11, y: 8.4, width: 7.5, height: 2, rx: 1, fill: 'currentColor' }),
        h('circle', { cx: 8, cy: 13, r: 1.35, fill: 'currentColor' }),
        h('rect', { x: 11, y: 12, width: 4.8, height: 2, rx: 1, fill: 'currentColor' }),
      )
    }

    /**
     * 入口按钮。两个注册点复用同一个组件，只靠 variant 区分外观与文案：
     *
     *   - header：已发过消息的对话，标题栏里的小图标，绿点表示该对话已有自身覆盖；
     *   - hero：新空会话的欢迎区，带文字的胶囊按钮——那里空间足够，且「能不能
     *     给一个还没开口的新对话设提示词」正是用户会在这一刻问的问题，图标太隐晦。
     *
     * 两种 variant 的 sessionId 都由槽注入，所以「只改这一个新对话」在 hero 态
     * 也是成立的：会话一创建 agent 就已经在了，保存后第一句话就带着这段提示词。
     */
    function makeEntry(variant) {
      return function Entry(props, helpers) {
        const { t, api, config } = helpers
        const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
        const [open, setOpen] = React.useState(false)
        const [own, setOwn] = React.useState(false)

        React.useEffect(() => {
          if (sessionId === '') return undefined
          let cancelled = false
          api
            .load(sessionId)
            .then((payload) => {
              if (cancelled) return
              const entry = payload?.session
              setOwn(entry !== null && entry !== undefined && entry.enabled === true)
            })
            .catch(() => {
              /* 读不到就不显示指示点，入口本身仍然可用 */
            })
          return () => {
            cancelled = true
          }
        }, [api, sessionId, open])

        const hero = variant === 'hero'
        const label = hero ? t('actionNew') : t('action')
        const showLabel = hero || config.showLabel === true

        return h(
          React.Fragment,
          null,
          h(
            'button',
            {
              type: 'button',
              'data-sps': 'entry',
              'data-variant': variant,
              'data-on': open ? 'true' : 'false',
              title: t('action'),
              'aria-label': label,
              onClick: () => setOpen(true),
            },
            h(Icon, { size: hero ? 14 : 15 }),
            own ? h('span', { 'data-sps': 'dot' }) : null,
            showLabel ? h('span', { 'data-sps': 'entrylabel' }, label) : null,
          ),
          open ? h(Dialog, { sessionId, onClose: () => setOpen(false), t, api, variant }) : null,
        )
      }
    }

    const HeaderAction = makeEntry('header')
    const HeroAction = makeEntry('hero')

    /** 会话 id 太长，界面上只显示尾部一段，够区分又不会撑破布局。 */
    function shortId(id) {
      const text = typeof id === 'string' ? id : ''
      if (text.length <= 16) return text || '—'
      return `…${text.slice(-12)}`
    }

    /**
     * 时间戳只显示时分秒。
     *
     * 段清单是「最近一次装配」，通常就在几分钟内，日期是噪音；跨天的旧清单
     * 靠「保存前的清单」这条提示兜底，不需要日期也能理解。
     */
    function formatClock(ts) {
      try {
        const date = new Date(ts)
        const pad = (n) => String(n).padStart(2, '0')
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      } catch {
        return ''
      }
    }

    function Dialog({ sessionId, onClose, t, api, variant }) {
      const [status, setStatus] = React.useState({ phase: 'loading', payload: null, error: '' })
      const [scope, setScope] = React.useState('session')
      const [mode, setMode] = React.useState('append')
      const [text, setText] = React.useState('')
      const [target, setTarget] = React.useState('')
      const [enabled, setEnabled] = React.useState(true)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState({ kind: '', text: '' })
      /**
       * 未保存改动的保护。
       *
       * `baseline` 记下「上一次从服务端载入/成功保存之后」的形态；`dirty` 由它
       * 现算而不是单独维护一个布尔——这样「改了又改回去」不会误报未保存，
       * 也不会漏报（比如只切了模式、只动了一个勾选框）。
       */
      const [baseline, setBaseline] = React.useState({ mode: 'append', text: '', target: '', enabled: true })
      const [confirmClose, setConfirmClose] = React.useState(false)
      const textareaRef = React.useRef(null)
      const backdropRef = React.useRef(null)

      const captureBaseline = React.useCallback((payload, which) => {
        const entry =
          which === 'global' ? payload?.global : which === 'workspace' ? payload?.workspace?.entry : payload?.session
        return {
          mode: entry !== null && entry !== undefined && typeof entry.mode === 'string' ? entry.mode : 'append',
          text: entry !== null && entry !== undefined && typeof entry.text === 'string' ? entry.text : '',
          target:
            entry !== null && entry !== undefined && typeof entry.target === 'string' && entry.target !== ''
              ? entry.target
              : payload?.defaultTargetName ?? '',
          enabled: entry !== null && entry !== undefined && typeof entry.enabled === 'boolean' ? entry.enabled : true,
        }
      }, [])

      const applyPayload = React.useCallback(
        (payload, which) => {
          const next = captureBaseline(payload, which)
          setMode(next.mode)
          setText(next.text)
          setTarget(next.target)
          setEnabled(next.enabled)
          setAck(false)
          setBaseline(next)
        },
        [captureBaseline],
      )

      const reload = React.useCallback(
        async (which) => {
          setStatus((prev) => ({ ...prev, phase: 'loading', error: '' }))
          try {
            const payload = await api.load(sessionId)
            setStatus({ phase: 'ready', payload, error: '' })
            applyPayload(payload, which)
          } catch (error) {
            setStatus({ phase: 'failed', payload: null, error: String(error?.message ?? error) })
          }
        },
        [api, sessionId, applyPayload],
      )

      React.useEffect(() => {
        reload('session')
      }, [reload])

      // 未保存判定：四个用户可编辑的字段逐一对比基线。
      const dirty =
        mode !== baseline.mode || text !== baseline.text || target !== baseline.target || enabled !== baseline.enabled

      /**
       * 关闭请求的统一入口。
       *
       * 有未保存改动时先转为「确认」态，不直接关——用户写了几百字被一次误触
       * 的 Esc 或遮罩点击清掉，是这个面板最容易造成实际损失的地方。
       */
      const requestClose = React.useCallback(() => {
        if (dirty) {
          setConfirmClose(true)
          return
        }
        onClose()
      }, [dirty, onClose])

      const confirmDiscard = React.useCallback(() => {
        setConfirmClose(false)
        onClose()
      }, [onClose])

      const cancelDiscard = React.useCallback(() => {
        setConfirmClose(false)
        // 回到编辑态后把焦点还给正文，用户能接着写。
        try {
          textareaRef.current?.focus?.()
        } catch {
          /* 没有可聚焦的节点 */
        }
      }, [])

      // Esc 关闭 + 打开时聚焦正文。确认态下 Esc 取消放弃，而不是连按就丢。
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (confirmClose) cancelDiscard()
          else requestClose()
        }
        document.addEventListener('keydown', onKey, true)
        const timer = setTimeout(() => {
          try {
            textareaRef.current?.focus?.()
          } catch {
            /* 没有可聚焦的节点 */
          }
        }, 30)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          clearTimeout(timer)
        }
      }, [confirmClose, cancelDiscard, requestClose])

      // 关标签页/刷新的兜底：只在有未保存改动时注册。
      React.useEffect(() => {
        if (!dirty) return undefined
        const onBeforeUnload = (event) => {
          event.preventDefault()
          // 部分浏览器只认 returnValue。
          event.returnValue = ''
          return ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => {
          window.removeEventListener('beforeunload', onBeforeUnload)
        }
      }, [dirty])

      const payload = status.payload
      const capability = payload?.capability ?? {}
      const blocked = {
        off: payload !== null && payload !== undefined && capability.enabled === false,
        noService: payload !== null && payload !== undefined && capability.systemPrompt === false,
        noAgents: payload !== null && payload !== undefined && capability.agents === false,
        complete: payload !== null && payload !== undefined && capability.allowComplete === false,
      }
      const sections = Array.isArray(payload?.sections) ? payload.sections : null
      /**
       * 段清单来自哪一次装配。
       *
       * 装配只在模型请求时发生，保存不触发它——所以清单天生滞后一步。把时间戳
       * 摆到标题上，用户一眼就知道「这是 09:40 那次请求的清单」，而不是对着
       * 旧数据猜自己的保存有没有生效。
       */
      const sectionsAt = typeof payload?.sectionsAt === 'number' && payload.sectionsAt > 0 ? payload.sectionsAt : 0
      const sectionsAtText = sectionsAt === 0 ? '' : formatClock(sectionsAt)
      const maxChars = typeof payload?.limits?.maxChars === 'number' ? payload.limits.maxChars : 200000
      const current = payload?.current ?? null
      const ownEntry = payload?.session ?? null
      /**
       * 工作区这一档在当前对话上是否可用。
       *
       * `workspace.key` 为空表示 host 算不出这个对话的目录（服务缺失、或会话
       * 记录里没有 cwd）。这时必须把「本工作区」这个 tab 显式标成不可用，
       * 而不是让它看起来能点、点下去再报错——那会让用户以为是自己填错了。
       */
      const workspaceKey = typeof payload?.workspace?.key === 'string' ? payload.workspace.key : ''
      const workspacePath =
        typeof payload?.workspace?.path === 'string' && payload.workspace.path !== ''
          ? payload.workspace.path
          : workspaceKey
      const workspaceEntry = payload?.workspace?.entry ?? null
      const workspaceAvailable = workspaceKey !== ''
      const inheritFrom = scope === 'session' ? payload?.effective?.inheritedFrom ?? '' : ''
      // 只在「本对话」这一档提示工作区来源：站在工作区 tab 上说「规则来自工作区」
      // 是废话，用户此刻正在编辑的就是那条规则。
      const workspaceFrom = scope === 'session' ? payload?.effective?.workspaceKey ?? '' : ''
      const disabled = blocked.off || blocked.noService || blocked.noAgents || busy
      const completeOk = !blocked.complete && (mode !== 'complete' || ack)

      /**
       * 「完全替换」会丢掉的段：清单里除了 studio 自己那条以外的全部。
       *
       * 之所以算得出来而不只是警告：面板本来就持有真实装配清单（sections），
       * 所以「你会丢掉什么」不是修辞，是这一屏就能列出来的事实。之前只有一个
       * 通用勾选框，用户点下去并不知道自己损失的是 3 段还是 20 段，更不知道
       * 里面有没有别的插件注册的段 —— 那些插件会「装着但模型不知道怎么用」。
       *
       * sections 为 null 表示这个对话还没装配过（冷会话），此时如实说明无法列举，
       * 而不是编一个数字出来。
       */
      const droppedSections = (() => {
        if (mode !== 'complete' || !Array.isArray(sections)) return null
        // 自己注册的段不算「丢掉的第一方内容」，它正是用户要保留的那一段。
        const own = new Set(['studio:complete', 'studio:append'])
        const kept = sections.filter((row) => own.has(row.name))
        const dropped = sections.filter((row) => !own.has(row.name))
        const chars = dropped.reduce((sum, row) => sum + (typeof row.chars === 'number' ? row.chars : 0), 0)
        /**
         * 第三方插件注册的段。
         *
         * 用**前缀白名单**而不是「非第一方即插件」的反向判定：反向判定会把所有
         * 没见过的名字都算成插件，而第一方段的命名空间并不是全封闭的 ——
         * 0.2.2-rc.2 的 dsh-cua 就注册了一个 `computer-use:dsh-cua`，它不是
         * `tool:` 前缀却属于第一方随包发布的插件。反过来，`tool:` 前缀也不保证
         * 第一方：dsh-m 就把自己的段注册成 `tool:dshm`。
         *
         * 所以这里只认「确实是第一方内置包注册的段名」这份白名单，其余一律
         * 计入插件侧 —— 宁可多报一个（提示用户去看清单），也不要漏报一个让
         * 插件静默失效。
         */
        const FIRST_PARTY = new Set([
          'harness:identity',
          'harness:source',
          'deployment:persona-prefix',
          'deployment:persona-suffix',
          'plan:policy',
          'team:policy',
          'ptc:only',
          'context:file-reference',
          'tool:bash',
          'tool:pwsh',
          'tool:read',
          'tool:write',
          'tool:edit',
          'tool:apply_patch',
          'tool:glob',
          'tool:grep',
          'tool:jobs',
          'tool:pty',
          'tool:web_search',
          'tool:web_fetch',
          'tool:lsp',
          'tool:session_query',
          'tool:goal',
          'tool:schedule',
          'tool:workflow',
          'tool:ralph',
          'tool:subagent',
          'tool:subagent_fork',
          'tool:report',
          'mcp-resource-servers',
          'tools:sdk',
          'ui:deliverable-file-references',
          'structured-output',
          'app:web-surface',
        ])
        const plugins = dropped.filter((row) => !FIRST_PARTY.has(String(row.name ?? '')))
        return { dropped, chars, plugins, kept }
      })()

      const onSave = async () => {
        if (text.trim() === '' && enabled) {
          setNotice({ kind: 'error', text: t('emptyText') })
          return
        }
        if (mode === 'replace' && target.trim() === '') {
          setNotice({ kind: 'error', text: t('targetRequired') })
          return
        }
        if (mode === 'complete' && !ack) return
        if (scope === 'workspace' && !workspaceAvailable) {
          setNotice({ kind: 'error', text: t('scopeWorkspaceNoDir') })
          return
        }
        setBusy(true)
        setNotice({ kind: '', text: '' })
        try {
          const body = {
            action: 'set',
            scope,
            sessionId: sessionId,
            patch: { enabled, mode, text, target: mode === 'replace' ? target.trim() : '' },
          }
          const result = await api.save(body)
          setStatus({ phase: 'ready', payload: result, error: '' })
          // 保存成功后，当前形态成为新的基线——否则会一直显示「未保存」。
          setBaseline({ mode, text, target, enabled })
          setNotice({
            kind: result?.persisted === false ? 'error' : 'ok',
            text:
              result?.persisted === false
                ? t('savedLocal')
                : scope === 'workspace'
                  ? t('workspaceSaved')
                  : t('saved'),
          })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}${String(error?.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }

      const onClear = async () => {
        if (scope === 'workspace' && !workspaceAvailable) {
          setNotice({ kind: 'error', text: t('scopeWorkspaceNoDir') })
          return
        }
        setBusy(true)
        setNotice({ kind: '', text: '' })
        try {
          const body = { action: 'clear', scope, sessionId }
          const result = await api.save(body)
          setStatus({ phase: 'ready', payload: result, error: '' })
          applyPayload(result, scope)
          setNotice({ kind: 'ok', text: scope === 'workspace' ? t('workspaceCleared') : t('cleared') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}${String(error?.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }

      const onPin = async () => {
        setBusy(true)
        setNotice({ kind: '', text: '' })
        try {
          const result = await api.save({ action: 'pin', scope: 'session', sessionId })
          setStatus({ phase: 'ready', payload: result, error: '' })
          applyPayload(result, 'session')
          setNotice({ kind: 'ok', text: t('pinned') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}${String(error?.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }

      const onCopy = async () => {
        if (current === null) return
        try {
          await navigator.clipboard.writeText(current.text)
          setNotice({ kind: 'ok', text: t('copied') })
        } catch {
          try {
            const range = document.createRange()
            const node = backdropRef.current?.querySelector('[data-sps="pre"]')
            if (node !== null && node !== undefined) {
              range.selectNodeContents(node)
              const selection = window.getSelection()
              selection?.removeAllRanges?.()
              selection?.addRange?.(range)
            }
            setNotice({ kind: '', text: t('copy') })
          } catch {
            /* 复制不可用，保留原文让用户手动选择 */
          }
        }
      }

      const modeRow = (key, titleKey, hintKey, risky) =>
        h(
          'label',
          { 'data-sps': 'radio', 'data-on': mode === key ? 'true' : 'false', 'data-risk': risky ? 'true' : 'false' },
          h('input', {
            type: 'radio',
            name: 'sps-mode',
            checked: mode === key,
            disabled: risky && blocked.complete,
            onChange: () => {
              setMode(key)
              if (key !== 'complete') setAck(false)
            },
          }),
          h(
            'span',
            { 'data-sps': 'radiomain' },
            h('span', { 'data-sps': 'radiokey' }, t(titleKey)),
            h('span', { 'data-sps': 'radiosub' }, t(hintKey)),
          ),
        )

      const children = [
        h(
          'div',
          { key: 'head', 'data-sps': 'head' },
          h(
            'div',
            { 'data-sps': 'headmain' },
            h('div', { 'data-sps': 'title' }, t('title')),
            h('div', { 'data-sps': 'subtitle' }, `${t('subtitle')} · ${sessionId || '—'}`),
          ),
          h('button', { key: 'x', type: 'button', 'data-sps': 'close', title: t('close'), onClick: requestClose }, '✕'),
        ),
        h(
          'div',
          { key: 'body', 'data-sps': 'body' },
          // 新空会话：明确告诉用户「现在保存就是给这第一句话用」。
          // 不说清楚的话，这里和标题栏入口长得一样、效果却更值得怀疑。
          variant === 'hero' && sessionId !== ''
            ? h('div', { key: 'fresh', 'data-sps': 'ok' }, t('newConversationNote'))
            : null,
          // 能力不足时的说明
          blocked.off ? h('div', { key: 'off', 'data-sps': 'error' }, t('disabledOff')) : null,
          blocked.noService ? h('div', { key: 'nos', 'data-sps': 'error' }, t('disabledNoService')) : null,
          blocked.noAgents ? h('div', { key: 'noa', 'data-sps': 'error' }, t('disabledNoAgents')) : null,

          // 继承状态：让「我的规则从哪来」可见，而不是静默生效
          inheritFrom !== ''
            ? h(
                'div',
                { key: 'inherit', 'data-sps': 'warn', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                h('span', { style: { flex: 1, minWidth: 200 } }, `${t('inheritedFrom')} ${shortId(inheritFrom)}`),
                h(
                  'button',
                  { type: 'button', 'data-sps': 'button', disabled: busy, onClick: onPin },
                  t('pin'),
                ),
              )
            : null,
          // 没有自身条目、也没继承，但父会话存在：说明「上层没有可继承的规则」
          inheritFrom === '' && ownEntry === null && payload?.parentSession
            ? h('div', { key: 'inherit-none', 'data-sps': 'muted' }, t('inheritedNone'))
            : null,

          /**
           * 工作区来源提示。
           *
           * 只在「本对话没有自身条目、且当前生效的规则来自工作区」时显示：
           * 用户打开一个对话，发现提示词变了，而他自己没在这个对话里设过任何
           * 东西——必须能一眼看出是「这个目录的规矩」在起作用，而不是以为
           * 插件抽风或上一个对话的规则漏过来了。
           */
          workspaceFrom !== '' && ownEntry === null && inheritFrom === ''
            ? h(
                'div',
                { key: 'wsfrom', 'data-sps': 'warn', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                h('span', { style: { flex: 1, minWidth: 200 } }, `${t('workspaceFrom')}${workspaceFrom}`),
              )
            : null,

          // 作用域：三档，从具体到宽泛排列（本对话 → 本目录 → 全局默认）。
          // 顺序刻意按「影响范围递增」排，用户从左往右点就是在逐级放宽。
          h(
            'div',
            { key: 'scope', 'data-sps': 'row' },
            h(
              'div',
              { 'data-sps': 'tabs', role: 'tablist' },
              h(
                'button',
                {
                  type: 'button',
                  'data-sps': 'tab',
                  'data-on': scope === 'session' ? 'true' : 'false',
                  onClick: () => {
                    setScope('session')
                    applyPayload(status.payload, 'session')
                  },
                },
                t('scopeSession'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  'data-sps': 'tab',
                  'data-on': scope === 'workspace' ? 'true' : 'false',
                  // 没有可用目录时禁用而不是隐藏：隐藏会让用户以为插件不支持
                  // 工作区，禁用加下面的说明才告诉他「为什么这里不行」。
                  disabled: !workspaceAvailable,
                  title: workspaceAvailable ? workspacePath : t('scopeWorkspaceNoDir'),
                  onClick: () => {
                    setScope('workspace')
                    applyPayload(status.payload, 'workspace')
                  },
                },
                t('scopeWorkspace'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  'data-sps': 'tab',
                  'data-on': scope === 'global' ? 'true' : 'false',
                  onClick: () => {
                    setScope('global')
                    applyPayload(status.payload, 'global')
                  },
                },
                t('scopeGlobal'),
              ),
            ),
            scope === 'global' ? h('span', { 'data-sps': 'muted' }, t('scopeGlobalHint')) : null,
            scope === 'workspace'
              ? h(
                  'span',
                  { 'data-sps': 'muted' },
                  workspaceAvailable ? t('scopeWorkspaceHint') : t('scopeWorkspaceNoDir'),
                )
              : null,
          ),

          // 工作区路径：必须显示，否则用户无法核对「我改的是不是这个项目」。
          scope === 'workspace' && workspaceAvailable
            ? h(
                'div',
                { key: 'wspath', 'data-sps': 'row' },
                h('span', { 'data-sps': 'label' }, t('scopeWorkspacePath')),
                h(
                  'code',
                  {
                    'data-sps': 'wspath',
                    title: workspacePath,
                    style: { fontSize: 12, wordBreak: 'break-all', flex: 1, minWidth: 200 },
                  },
                  workspacePath,
                ),
                workspaceEntry === null
                  ? h('span', { 'data-sps': 'muted' }, `· ${t('workspaceEmpty')}`)
                  : null,
              )
            : null,

          // 模式
          h(
            'div',
            { key: 'mode', 'data-sps': 'mode' },
            modeRow('append', 'modeAppend', 'modeAppendHint', false),
            modeRow('replace', 'modeReplace', 'modeReplaceHint', false),
            modeRow('complete', 'modeComplete', 'modeCompleteHint', true),
          ),

          mode === 'replace'
            ? h(
                'div',
                { key: 'target', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('span', { 'data-sps': 'label' }, t('target')),
                sections === null
                  ? h('input', {
                      'data-sps': 'input',
                      value: target,
                      spellCheck: false,
                      onChange: (event) => setTarget(event.target.value),
                      placeholder: payload?.defaultTargetName ?? 'deployment:persona-suffix',
                    })
                  : h(
                      'select',
                      {
                        'data-sps': 'input',
                        value: target,
                        onChange: (event) => setTarget(event.target.value),
                      },
                      sections.map((row) =>
                        h(
                          'option',
                          { key: row.name, value: row.name },
                          `${row.name} · ${row.order ?? '?'} · ${row.chars}`,
                        ),
                      ),
                      target !== '' && !sections.some((row) => row.name === target)
                        ? h('option', { value: target }, `${target}（不在清单中，将新增）`)
                        : null,
                    ),
                h('span', { 'data-sps': 'muted' }, t('targetHint')),
              )
            : null,

          mode === 'complete'
            ? h(
                'div',
                { key: 'risk', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { 'data-sps': 'warn' }, t('modeCompleteRisk')),

                // 会丢掉哪些段：清单可读时逐条列出，读不到时如实说无法列举。
                blocked.complete
                  ? null
                  : h(
                      'div',
                      { 'data-sps': 'drops', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                      droppedSections === null
                        ? h('div', { 'data-sps': 'muted' }, t('completeDropsUnknown'))
                        : h(
                            'div',
                            null,
                            h(
                              'div',
                              { 'data-sps': 'warn' },
                              t('completeDrops')
                                .replace('{n}', String(droppedSections.dropped.length))
                                .replace('{chars}', String(droppedSections.chars)),
                            ),
                            h(
                              'ul',
                              { 'data-sps': 'droplist', style: { margin: '4px 0 0', paddingLeft: 18, maxHeight: 140, overflowY: 'auto' } },
                              droppedSections.dropped.slice(0, 24).map((row) =>
                                h(
                                  'li',
                                  { key: row.name, 'data-sps': 'dropitem' },
                                  `${row.name} · ${row.chars}`,
                                ),
                              ),
                              droppedSections.dropped.length > 24
                                ? h(
                                    'li',
                                    { key: '__more', 'data-sps': 'dropmore' },
                                    t('completeDropsMore').replace('{n}', String(droppedSections.dropped.length - 24)),
                                  )
                                : null,
                            ),
                            // 第三方插件的段被丢掉，是「装了却用不上」的来源，单独点名。
                            droppedSections.plugins.length > 0
                              ? h(
                                  'div',
                                  { 'data-sps': 'error', style: { marginTop: 4 } },
                                  t('completeDropsPlugins').replace('{n}', String(droppedSections.plugins.length)),
                                )
                              : null,
                          ),
                    ),

                blocked.complete
                  ? h('div', { 'data-sps': 'error' }, t('completeBlocked'))
                  : h(
                      'label',
                      { 'data-sps': 'row', style: { gap: 8 } },
                      h('input', {
                        type: 'checkbox',
                        checked: ack,
                        onChange: (event) => setAck(event.target.checked),
                      }),
                      h('span', { 'data-sps': 'muted' }, t('modeCompleteAck')),
                    ),
              )
            : null,

          // 正文
          h(
            'div',
            { key: 'text', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { 'data-sps': 'row' },
              h('span', { 'data-sps': 'label' }, t('body')),
              h('span', { 'data-sps': 'spacer' }),
              h('span', { 'data-sps': 'muted' }, `${text.length} ${t('chars')} / ${maxChars}`),
            ),
            h('textarea', {
              'data-sps': 'textarea',
              ref: textareaRef,
              value: text,
              spellCheck: false,
              onChange: (event) => setText(event.target.value),
            }),
            h('span', { 'data-sps': 'muted' }, t('bodyHint')),
          ),

          h(
            'label',
            { key: 'enable', 'data-sps': 'row', style: { gap: 8 } },
            h('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
            h(
              'span',
              { 'data-sps': 'muted' },
              t(scope === 'global' ? 'enableGlobal' : scope === 'workspace' ? 'enableWorkspace' : 'enable'),
            ),
          ),

          // 影响说明
          h('div', { key: 'cache', 'data-sps': 'muted' }, t('prefixCache')),

          notice.text !== ''
            ? h('div', { key: 'notice', 'data-sps': notice.kind === 'ok' ? 'ok' : 'error' }, notice.text)
            : null,

          // 只读预览：最近一次请求的系统提示词
          h(
            'details',
            { key: 'current', 'data-sps': 'details' },
            h(
              'summary',
              null,
              `${t('current')}${current === null ? ` · ${t('currentEmpty')}` : ` · ${current.chars} ${t('chars')}`}`,
            ),
            payload?.currentNote ? h('div', { 'data-sps': 'muted', style: { marginTop: 6 } }, payload.currentNote) : null,
            current !== null
              ? h('pre', { 'data-sps': 'pre' }, current.text)
              : h('div', { 'data-sps': 'muted', style: { marginTop: 6 } }, t('currentEmpty')),
            current !== null
              ? h(
                  'button',
                  { type: 'button', 'data-sps': 'button', style: { marginTop: 8 }, onClick: onCopy },
                  t('copy'),
                )
              : null,
          ),

          // 只读预览：装配到的段
          h(
            'details',
            { key: 'sections', 'data-sps': 'details' },
            h(
              'summary',
              null,
              `${t('sections')}${sections === null ? '' : ` · ${sections.length}`}${sectionsAtText === '' ? '' : ` · ${sectionsAtText}`}`,
            ),
            sections === null
              ? h('div', { 'data-sps': 'muted', style: { marginTop: 6 } }, payload?.sectionsNote ?? '')
              : h(
                  React.Fragment,
                  null,
                  // complete 模式：这份清单与实际发送内容必然不一致，必须说清。
                  payload?.sectionsComplete === true
                    ? h('div', { 'data-sps': 'warn', style: { marginTop: 8 } }, t('sectionsCompleteNote'))
                    : null,
                  // 保存后清单还没刷新：说明它来自哪一次装配。
                  payload?.sectionsStale === true
                    ? h('div', { 'data-sps': 'warn', style: { marginTop: 8 } }, t('sectionsStaleNote'))
                    : null,
                  h(
                    'table',
                    { 'data-sps': 'table' },
                    h(
                      'thead',
                      null,
                      h(
                        'tr',
                        null,
                        h('th', null, t('sectionName')),
                        h('th', null, t('sectionOrder')),
                        h('th', null, t('sectionChars')),
                      ),
                    ),
                    h(
                      'tbody',
                      null,
                      sections.map((row) =>
                        h(
                          'tr',
                          { key: row.name },
                          h('td', null, row.name),
                          h('td', { 'data-num': 'true' }, row.order ?? '—'),
                          h('td', { 'data-num': 'true' }, row.chars),
                        ),
                      ),
                    ),
                  ),
                ),
          ),

          status.error !== ''
            ? h('div', { key: 'err', 'data-sps': 'error' }, `${t('fetchFailed')}${status.error}`)
            : null,
        ),
        h(
          'div',
          { key: 'foot', 'data-sps': 'head', style: { borderBottom: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 } },
          h(
            'div',
            { 'data-sps': 'foot', style: { flex: 1 } },
            h(
              'button',
              { type: 'button', 'data-sps': 'button', disabled: busy, onClick: () => reload(scope) },
              t('refresh'),
            ),
            h(
              'button',
              { type: 'button', 'data-sps': 'button', disabled: disabled, onClick: onClear },
              t('clear'),
            ),
          ),
          h('span', { 'data-sps': 'spacer' }),
          h(
            'button',
            {
              type: 'button',
              'data-sps': 'button',
              'data-primary': 'true',
              disabled: disabled || !completeOk,
              onClick: onSave,
            },
            busy ? t('saving') : t('save'),
          ),
        ),
      ]

      const dialog = h(
        'div',
        {
          'data-sps': 'dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('title'),
          onClick: (event) => event.stopPropagation(),
        },
        children,
      )

      // 放弃改动的确认层：盖在编辑面板之上，默认焦点落在「继续编辑」。
      const discardLayer = confirmClose
        ? h(
            'div',
            {
              'data-sps': 'dialog',
              role: 'alertdialog',
              'aria-modal': 'true',
              'aria-label': t('discardTitle'),
              style: { width: 'min(420px, 100%)', maxHeight: 'none' },
              onClick: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { 'data-sps': 'head' },
              h('div', { 'data-sps': 'headmain' }, h('div', { 'data-sps': 'title' }, t('discardTitle'))),
            ),
            h(
              'div',
              { 'data-sps': 'body' },
              h('div', { 'data-sps': 'muted' }, t('discardBody')),
            ),
            h(
              'div',
              { 'data-sps': 'head', style: { borderBottom: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 } },
              h('span', { 'data-sps': 'spacer' }),
              h('button', { type: 'button', 'data-sps': 'button', onClick: cancelDiscard, autoFocus: true }, t('discardKeep')),
              h(
                'button',
                {
                  type: 'button',
                  'data-sps': 'button',
                  style: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
                  onClick: confirmDiscard,
                },
                t('discardConfirm'),
              ),
            ),
          )
        : null

      return ReactDOM.createPortal(
        h(
          'div',
          {
            'data-sps': 'backdrop',
            ref: backdropRef,
            // 遮罩点击同样走关闭保护：有未保存改动时先确认，不直接丢。
            onClick: confirmClose ? cancelDiscard : requestClose,
          },
          discardLayer ?? dialog,
        ),
        document.body,
      )
    }

    function apply(ctx, config) {
      const cfg = config !== null && typeof config === 'object' ? config : {}
      if (cfg.visible === false) return
      const t = makeText(ctx)
      const api = createApi({ hostURL: typeof cfg.hostURL === 'string' ? cfg.hostURL : '' })
      const helpers = { t, api, config: { showLabel: cfg.showLabel === true } }

      ctx.effect(() => ensureStyle())

      // 已发过消息的对话：标题栏动作槽。
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'system-prompt-studio', order: 30 },
          (props) => HeaderAction(props, helpers),
        ),
      )

      /**
       * 新空会话：欢迎区选项槽。
       *
       * 空会话是 hero 态，标题栏整行 `hideChrome`，上面那个槽不会渲染——
       * 不给这里补一个入口，「只改这个新对话」在新会话里就没有任何办法触发。
       * 用独立的 id（不是复用 header 的），两个槽各自独立、互不覆盖。
       */
      if (cfg.showOnNewConversation !== false) {
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register(
            { name: 'conversation.hero.options', id: 'system-prompt-studio-hero', order: 20 },
            (props) => HeroAction(props, helpers),
          ),
        )
      }
    }

    return { inject, apply, HeaderAction, HeroAction }
  },
})
