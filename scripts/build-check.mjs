/**
 * 按机器人构建机的做法构建一个插件，再与仓库里提交的声明清单比对。
 *
 * 用一份装好依赖、构建过的 QFlareBot（pnpm install && pnpm build）里的
 * apps/seed/scripts/plugin-build.mjs：装依赖只按插件自己的 lockfile、在子进程里打包，
 * 和机器人构建时完全一样——这里过了，装到机器人上也能构建。
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

function stableStringify(value) {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/** 下载提交的源码 tarball 并解包，返回插件目录 */
async function extractSource(fullName, sha, subdir, workDir) {
  const tgz = path.join(workDir, 'source.tar.gz')
  const res = await fetch(`https://codeload.github.com/${fullName}/tar.gz/${sha}`, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载 ${fullName}@${sha} 源码失败：HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz))
  const dest = path.join(workDir, 'src')
  await mkdir(dest)
  execFileSync('tar', ['xzf', tgz, '-C', dest])
  const top = (await readdir(dest, { withFileTypes: true })).filter((e) => e.isDirectory())
  if (top.length !== 1) throw new Error('源码 tarball 结构异常：期望单个顶层目录')
  return path.join(dest, top[0].name, subdir ?? '')
}

async function readDeclaredManifest(pluginDir) {
  for (const p of ['manifest.json', 'dist/manifest.json']) {
    try {
      return JSON.parse(await readFile(path.join(pluginDir, p), 'utf8'))
    } catch {
      // 试下一个位置
    }
  }
  return null
}

/** 构建成功返回 plugin.js 的字节数；失败抛错，错误信息直接给投稿人看 */
export async function buildCheck(qflarebot, { fullName, sha, subdir }) {
  const { installPluginDependencies, buildPluginIsolated } = await import(
    pathToFileURL(path.join(qflarebot, 'apps/seed/scripts/plugin-build.mjs')).href
  )
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'qflarebot-catalog-'))
  try {
    const pluginDir = await extractSource(fullName, sha, subdir, workDir)
    // 先读声明清单再构建：构建会往 dist/ 写新的 manifest.json，后读就成了自己跟自己比
    const declared = await readDeclaredManifest(pluginDir)
    await installPluginDependencies(pluginDir)
    const { manifest, size } = await buildPluginIsolated(pluginDir)
    if (declared && stableStringify(declared) !== stableStringify(manifest)) {
      const fields = Object.keys({ ...manifest, ...declared }).filter((k) => stableStringify(manifest[k]) !== stableStringify(declared[k]))
      throw new Error(`声明清单与源码不一致（字段：${fields.join('、') || '整体'}）：重新运行 npm run sync 并提交 manifest.json`)
    }
    return size
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
