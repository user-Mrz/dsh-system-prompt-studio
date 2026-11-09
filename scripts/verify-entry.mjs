// 安装期自检（prepare 脚本）。
//
// 本插件是**纯 JavaScript**、`lib/` 已随仓库提交，因此这里不做任何编译，只
// 确认入口与清单文件在安装后的目录里确实存在。这样在 GitHub 源码安装时，
// 一旦 `files`/`exports` 写错或产物缺失，会在安装阶段就报错，而不是等到用户
// 启动 DSH 才发现 `entry file missing`。
//
// 注意：pnpm 默认会拦截 Git 依赖的构建脚本。如果它被拦下了也不要紧——本脚本
// 只做校验、不产出文件，跳过它不会影响安装结果的可用性。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const missing = []

for (const relative of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json']) {
  if (!existsSync(join(root, relative))) missing.push(relative)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
} catch (error) {
  console.error(`[dsh-system-prompt-studio] package.json 不可读：${error.message}`)
  process.exitCode = 1
}

if (manifest !== undefined) {
  if (manifest.dsh?.bundle?.patch === undefined) missing.push('package.json: dsh.bundle.patch')
  if (manifest.dsh?.client === undefined) missing.push('package.json: dsh.client')
}

if (missing.length > 0) {
  console.error('[dsh-system-prompt-studio] 安装不完整，缺少：')
  for (const item of missing) console.error(`  - ${item}`)
  process.exitCode = 1
}
