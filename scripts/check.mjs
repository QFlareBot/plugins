#!/usr/bin/env node
/**
 * 检查插件目录。静态规则（条目格式、撞名、保留名）每次都查全部条目；
 * 联网核对与真构建只对选中的条目做。
 *
 *   node scripts/check.mjs                         只查静态规则
 *   node scripts/check.mjs jrys pixiv              另外联网核对这几个
 *   node scripts/check.mjs --changed origin/main   联网核对相对 origin/main 新增或改过的条目（PR 里用）
 *   node scripts/check.mjs --all                   联网核对全部条目
 *   ... --build ../QFlareBot                       联网核对之外，再按机器人构建机的做法真构建一遍（见 build-check.mjs）
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCheck } from './build-check.mjs'
import { checkCatalog, checkEntry, checkSource, loadEntries } from './catalog.mjs'
import { inspect } from './github.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const opts = { names: [], changed: null, all: false, build: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--changed') opts.changed = argv[++i]
    else if (arg === '--all') opts.all = true
    else if (arg === '--build') opts.build = path.resolve(argv[++i])
    else if (arg.startsWith('--')) throw new Error(`不认识的参数 ${arg}`)
    else opts.names.push(arg)
  }
  return opts
}

/** 相对 base 新增或改过的条目（删掉的不用查） */
function changedNames(base) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`, '--', 'plugins/'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter((f) => f.startsWith('plugins/') && f.endsWith('.json'))
    .map((f) => path.basename(f, '.json'))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const entries = await loadEntries(ROOT)
  let failed = false
  const fail = (msg) => {
    failed = true
    console.error(`✗ ${msg}`)
  }

  // 静态规则：全部条目
  for (const e of entries) {
    if (e.parseError) fail(e.parseError)
    else for (const err of checkEntry(e.file, e.entry)) fail(err)
  }
  for (const err of checkCatalog(entries.filter((e) => !e.parseError))) fail(err)
  if (!failed) console.log(`✓ 静态规则：${entries.length} 个条目`)

  // 联网核对：选中的条目
  const wanted = opts.all ? entries.map((e) => e.name) : [...opts.names, ...(opts.changed ? changedNames(opts.changed) : [])]
  const selected = [...new Set(wanted)].map((name) => {
    const e = entries.find((x) => x.name === name)
    if (!e) throw new Error(`没有条目 plugins/${name}.json`)
    return e
  })
  if (selected.length === 0 && (opts.changed || opts.build)) console.log('没有改到条目，不用联网核对')

  for (const { name, entry, parseError } of selected) {
    if (parseError || checkEntry(`${name}.json`, entry).length > 0) continue // 上面已经报过
    console.log(`\n${name}（${entry.repo}${entry.subdir ? `#${entry.subdir}` : ''}）`)
    let found
    try {
      found = await inspect(entry)
    } catch (err) {
      fail(`${name}：${err.message}`)
      continue
    }
    const { errors, warnings } = checkSource({ name, entry, ...found })
    for (const w of warnings) console.log(`  ! ${w}`)
    for (const err of errors) fail(`${name}：${err}`)
    if (errors.length > 0) continue
    console.log(`  ✓ ${found.manifest.displayName ?? name} ${found.manifest.version}，提交 ${found.commit.sha.slice(0, 7)}`)

    if (opts.build) {
      try {
        const size = await buildCheck(opts.build, { fullName: found.repo.fullName, sha: found.commit.sha, subdir: entry.subdir })
        console.log(`  ✓ 构建通过（plugin.js ${(size / 1024).toFixed(1)} KB）`)
      } catch (err) {
        fail(`${name}：构建失败——${err.message}`)
      }
    }
  }

  if (failed) {
    console.error('\n检查没通过，按上面的提示改。')
    process.exit(1)
  }
  console.log('\n全部通过')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
