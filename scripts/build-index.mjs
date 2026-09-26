#!/usr/bin/env node
/**
 * 生成 index.json：逐个读条目仓库的默认分支最新提交与声明清单，汇成一个静态文件，
 * 由 GitHub Pages 发布到 https://qflarebot.github.io/plugins/index.json。
 *
 *   node scripts/build-index.mjs --out site/index.json [--previous <上一版 index.json 的 URL>]
 *
 * 某个插件这次读不到（仓库打不开、清单坏了）不会从目录里消失：沿用上一版里它的数据，
 * 标上 status 与 error。插件从没成功读到过的，也照样列出，只有 name、repo 与状态。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogRecord, checkEntry, checkSource, loadEntries } from './catalog.mjs'
import { inspect } from './github.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_VERSION = 1

function parseArgs(argv) {
  const opts = { out: null, previous: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = path.resolve(argv[++i])
    else if (argv[i] === '--previous') opts.previous = argv[++i]
    else throw new Error(`不认识的参数 ${argv[i]}`)
  }
  if (!opts.out) throw new Error('用法：node scripts/build-index.mjs --out <文件> [--previous <URL>]')
  return opts
}

/** 上一版索引，按 name 索引；第一次发布或下载失败返回空表 */
async function loadPrevious(url) {
  if (!url) return new Map()
  try {
    const res = await fetch(url)
    if (!res.ok) return new Map()
    const data = await res.json()
    return new Map((data.plugins ?? []).map((p) => [p.name, p]))
  } catch {
    return new Map()
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const previous = await loadPrevious(opts.previous)
  const entries = await loadEntries(ROOT)
  const plugins = []

  for (const { file, name, entry, parseError } of entries) {
    // 静态规则在 PR 上就拦了，这里再过滤一遍，防止直接推到 main 的坏条目进索引
    if (parseError || checkEntry(file, entry).length > 0) {
      console.error(`跳过 ${file}：条目不合规`)
      continue
    }
    const checkedAt = new Date().toISOString()
    let problem
    try {
      const found = await inspect(entry)
      const { errors } = checkSource({ name, entry, ...found })
      if (errors.length === 0) {
        plugins.push({ ...catalogRecord({ name, entry, ...found }), status: 'ok', checkedAt })
        console.log(`✓ ${name} ${found.manifest.version}`)
        continue
      }
      problem = errors.join('；')
    } catch (err) {
      problem = err.message
    }
    console.error(`✗ ${name}：${problem}`)
    const last = previous.get(name)
    plugins.push({
      ...(last ?? { name, repo: entry.repo, tags: entry.tags ?? [] }),
      status: 'error',
      error: problem,
      checkedAt,
    })
  }

  const index = { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), plugins }
  await mkdir(path.dirname(opts.out), { recursive: true })
  await writeFile(opts.out, `${JSON.stringify(index, null, 2)}\n`)
  console.log(`\n写入 ${path.relative(process.cwd(), opts.out)}：${plugins.length} 个插件`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
