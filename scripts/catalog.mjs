/**
 * 插件目录的登记规则与索引记录。除 loadEntries 读文件外都是纯函数，catalog.test.mjs 覆盖。
 *
 * 一个插件一个条目文件 plugins/<name>.json，文件名就是插件 name。条目只写「仓库在哪」，
 * 名称、版本、描述、权限、命令都从仓库里提交的 manifest.json 读——不在这里再写一份，也就不会对不上。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/** 与 @qqbot/sdk 的 NAME_PATTERN 一致：name 同时是 KV 前缀、D1 表前缀与路由 /p/<name>/ */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/
export const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
export const PACKAGE_PREFIX = 'qflarebot-plugin-'

/**
 * 保留名：前六个是框架内置插件（装上同名的会顶掉内置那一份），其余容易被当成框架自己的组件。
 * 比较时走 nameKey，`multi_reply` 也算撞上 `multi-reply`。
 */
export const RESERVED_NAMES = ['echo', 'multi-reply', 'image', 'keyboard', 'sid', 't2i', 'qqbot', 'qflarebot', 'core', 'admin', 'system', 'runtime']

const ENTRY_KEYS = new Set(['repo', 'subdir', 'tags'])
export const MAX_TAGS = 5
export const MAX_TAG_LENGTH = 12

/**
 * 撞名比较用的键，与运行时的 D1 表前缀同一个算法（packages/runtime/src/sqlScope.ts 的 tablePrefix）：
 * `my-plugin` 与 `my_plugin` 落到同一个 `p_my_plugin_`，在一个机器人里装不到一起。
 */
export function nameKey(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function isSubdir(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    value.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && /^[A-Za-z0-9._-]+$/.test(seg))
  )
}

/** 校验单个条目文件，返回错误列表（空数组即通过） */
export function checkEntry(fileName, entry) {
  if (!fileName.endsWith('.json')) return [`${fileName}：条目文件要命名为 <name>.json`]
  const name = fileName.slice(0, -'.json'.length)
  const errors = []
  if (!NAME_PATTERN.test(name)) {
    errors.push(`${fileName}：文件名就是插件 name，只能用小写字母、数字、-、_，以字母或数字开头，最长 64 个字符`)
  }
  if (RESERVED_NAMES.some((r) => nameKey(r) === nameKey(name))) errors.push(`${fileName}：${name} 是保留名，换一个`)

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [...errors, `${fileName}：内容必须是 JSON 对象`]
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) errors.push(`${fileName}：不认识的字段 ${key}（只能写 repo、subdir、tags）`)
  }
  if (typeof entry.repo !== 'string' || !REPO_PATTERN.test(entry.repo)) {
    errors.push(`${fileName}：repo 写成 owner/repo，例如 "me/${PACKAGE_PREFIX}${name}"`)
  }
  if (entry.subdir !== undefined && !isSubdir(entry.subdir)) {
    errors.push(`${fileName}：subdir 是仓库里的相对路径，例如 "packages/${name}"，不能以 / 开头或结尾、不能含 . 和 ..`)
  }
  if (entry.tags !== undefined) {
    if (!Array.isArray(entry.tags) || !entry.tags.every((t) => typeof t === 'string' && t.trim() === t && t.length > 0)) {
      errors.push(`${fileName}：tags 是非空字符串数组，前后不要带空格`)
    } else {
      if (entry.tags.length > MAX_TAGS) errors.push(`${fileName}：tags 最多 ${MAX_TAGS} 个`)
      const long = entry.tags.filter((t) => [...t].length > MAX_TAG_LENGTH)
      if (long.length > 0) errors.push(`${fileName}：每个标签最长 ${MAX_TAG_LENGTH} 个字：${long.join('、')}`)
      if (new Set(entry.tags).size !== entry.tags.length) errors.push(`${fileName}：tags 有重复`)
    }
  }
  return errors
}

/** 条目之间的冲突：撞名（按 nameKey）、同一个仓库目录登记了两次 */
export function checkCatalog(entries) {
  const errors = []
  const byKey = new Map()
  const bySource = new Map()
  for (const { name, entry } of entries) {
    const key = nameKey(name)
    if (byKey.has(key)) errors.push(`${name} 与 ${byKey.get(key)} 撞名：两者的 D1 表前缀相同，一个机器人里装不到一起`)
    else byKey.set(key, name)

    if (typeof entry?.repo !== 'string') continue
    const source = `${entry.repo.toLowerCase()}#${entry.subdir ?? ''}`
    if (bySource.has(source)) errors.push(`${name} 与 ${bySource.get(source)} 指向同一个仓库目录`)
    else bySource.set(source, name)
  }
  return errors
}

/** 由包名去掉 scope：`@me/qflarebot-plugin-hello` → `qflarebot-plugin-hello` */
function unscoped(pkgName) {
  return pkgName.startsWith('@') ? pkgName.slice(pkgName.indexOf('/') + 1) : pkgName
}

/**
 * 核对仓库里的东西与条目对得上。repo 是 GitHub API 返回的仓库信息（已跟随改名重定向），
 * manifest / pkg 是登记提交里的 manifest.json 与 package.json（没有就是 null）。
 */
export function checkSource({ name, entry, repo, manifest, pkg }) {
  const errors = []
  const warnings = []
  const expected = `${PACKAGE_PREFIX}${name}`

  if (repo.private) errors.push('仓库是私有的：机器人只能安装公开的 GitHub 仓库')
  if (repo.archived) warnings.push('仓库已归档，不会再更新')
  if (repo.fullName.toLowerCase() !== entry.repo.toLowerCase()) {
    warnings.push(`仓库已改名为 ${repo.fullName}，把条目的 repo 改成新地址`)
  }
  // 单仓库多插件时仓库名管不住，只约束包名
  if (!entry.subdir && repo.fullName.split('/')[1].toLowerCase() !== expected) {
    errors.push(`仓库名要是 ${expected}，现在是 ${repo.fullName.split('/')[1]}`)
  }
  if (!repo.license) warnings.push('仓库没有 LICENSE：别人不清楚能不能用、能不能改')

  if (!manifest) {
    errors.push('没有提交声明清单：运行 npm run sync，把生成的 manifest.json 提交到插件目录的根下')
  } else if (manifest.name !== name) {
    errors.push(`manifest.json 里的 name 是 ${manifest.name}，条目文件名是 ${name}，两者要一样`)
  }

  if (!pkg) {
    errors.push('没有 package.json')
  } else if (typeof pkg.name !== 'string' || unscoped(pkg.name) !== expected) {
    errors.push(`包名要是 ${expected}（或 @scope/${expected}），现在是 ${pkg.name ?? '空'}`)
  }
  return { errors, warnings }
}

/** GitHub 上的安装地址，粘贴到面板「安装插件」即可；单仓库多插件时带上分支与子目录 */
export function installUrl(fullName, defaultBranch, subdir) {
  return subdir ? `https://github.com/${fullName}/tree/${defaultBranch}/${subdir}` : `https://github.com/${fullName}`
}

/** 生成索引里的一条记录 */
export function catalogRecord({ name, entry, repo, commit, manifest }) {
  return {
    name,
    repo: repo.fullName,
    ...(entry.subdir ? { subdir: entry.subdir } : {}),
    installUrl: installUrl(repo.fullName, repo.defaultBranch, entry.subdir),
    author: repo.fullName.split('/')[0],
    displayName: manifest.displayName ?? name,
    description: manifest.description ?? repo.description ?? '',
    version: manifest.version,
    ...(manifest.coreRange ? { coreRange: manifest.coreRange } : {}),
    tags: entry.tags ?? [],
    permissions: manifest.permissions ?? [],
    commands: (manifest.commands ?? []).map((c) => ({ name: c.name, ...(c.description ? { description: c.description } : {}) })),
    // 面板批量安装按它排顺序：提供服务的先写进清单，依赖它的才过得了校验
    depends: Object.keys(manifest.depends ?? {}),
    services: manifest.services ?? [],
    durableObjects: manifest.durableObjects ?? [],
    hasUi: Boolean(manifest.ui),
    license: repo.license,
    stars: repo.stars,
    sha: commit.sha,
    updatedAt: commit.date,
  }
}

/** 读 plugins/ 下的全部条目；JSON 解析失败的也返回，由调用方报错 */
export async function loadEntries(root) {
  const dir = path.join(root, 'plugins')
  const files = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort()
  const entries = []
  for (const file of files) {
    const text = await readFile(path.join(dir, file), 'utf8')
    let entry
    let parseError
    try {
      entry = JSON.parse(text)
    } catch (err) {
      parseError = `${file}：不是合法的 JSON（${err.message}）`
    }
    entries.push({ file, name: file.replace(/\.json$/, ''), entry, parseError })
  }
  return entries
}
