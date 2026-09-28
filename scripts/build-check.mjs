/**
 * 按机器人构建机的做法构建一个插件，再与仓库里提交的声明清单比对。
 *
 * 用一份装好依赖、构建过的 QFlareBot（pnpm install && pnpm build）里的
 * apps/seed/scripts/plugin-build.mjs：装依赖只按插件自己的 lockfile、在子进程里打包，
 * 和机器人构建时完全一样——这里过了，装到机器人上也能构建。
 *
 * 比对也用机器人构建机的那一份（deploy-policy.mjs 的 compareDeclaredManifest），不逐字比：
 * 声明清单是作者当时的 SDK 生成的，框架后来升了契约版本、加了带默认值的字段，抽出来就和它不一样。
 * 逐字比的话，框架每升一次版本，所有已登记的插件都过不了这里；而报错让作者重新 sync，
 * 清单里的 apiVersion 会跟着升上去，老版本的机器人就装不了了
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

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
  const scripts = path.join(qflarebot, 'apps/seed/scripts')
  const { installPluginDependencies, buildPluginIsolated } = await import(pathToFileURL(path.join(scripts, 'plugin-build.mjs')).href)
  const { compareDeclaredManifest } = await import(pathToFileURL(path.join(scripts, 'deploy-policy.mjs')).href)
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'qflarebot-catalog-'))
  try {
    const pluginDir = await extractSource(fullName, sha, subdir, workDir)
    // 先读声明清单再构建：构建会往 dist/ 写新的 manifest.json，后读就成了自己跟自己比
    const declared = await readDeclaredManifest(pluginDir)
    await installPluginDependencies(pluginDir)
    const { manifest, size } = await buildPluginIsolated(pluginDir)
    if (declared) {
      const diff = compareDeclaredManifest(declared, manifest)
      for (const warning of diff.warnings) console.warn(`  ! ${warning}`)
      if (!diff.ok) {
        throw new Error(`声明清单与源码不一致（字段：${diff.fields.join('、')}）：重新运行 npm run sync 并提交 manifest.json`)
      }
    }
    return size
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
