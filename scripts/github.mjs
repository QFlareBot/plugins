/**
 * 读 GitHub：仓库信息、默认分支的最新提交、某个提交下的文件。
 * 在 Actions 里带上 GITHUB_TOKEN（每小时 1000 次），本地不带也能跑（每小时 60 次）。
 */
const API = 'https://api.github.com'

function apiHeaders() {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return headers
}

async function api(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: apiHeaders(), redirect: 'follow' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${pathname} 返回 HTTP ${res.status}`)
  return res.json()
}

/** 仓库信息；仓库不存在（或是私有的、匿名看不到）返回 null。改过名的仓库 API 会重定向，fullName 是新名字 */
export async function getRepo(repo) {
  const data = await api(`/repos/${repo}`)
  if (!data) return null
  return {
    fullName: data.full_name,
    private: data.private,
    archived: data.archived,
    defaultBranch: data.default_branch,
    description: data.description ?? '',
    stars: data.stargazers_count,
    license: data.license?.spdx_id && data.license.spdx_id !== 'NOASSERTION' ? data.license.spdx_id : data.license ? 'Other' : null,
  }
}

/** 分支的最新提交：{ sha, date } */
export async function getHeadCommit(fullName, branch) {
  const data = await api(`/repos/${fullName}/commits/${encodeURIComponent(branch)}`)
  if (!data?.sha) throw new Error(`读不到 ${fullName} 分支 ${branch} 的最新提交`)
  return { sha: data.sha, date: data.commit?.committer?.date ?? data.commit?.author?.date ?? null }
}

/** 某个提交下的 JSON 文件；文件不存在返回 null，内容不是 JSON 抛错 */
export async function getRawJson(fullName, sha, filePath) {
  const res = await fetch(`https://raw.githubusercontent.com/${fullName}/${sha}/${filePath}`, { redirect: 'follow' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`下载 ${fullName}@${sha.slice(0, 7)} 的 ${filePath} 失败：HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${fullName}@${sha.slice(0, 7)} 的 ${filePath} 不是合法的 JSON`)
  }
}

/** 声明清单：插件目录下的 manifest.json 优先，dist/manifest.json 兜底——与机器人安装、构建时的读法一致 */
export async function getDeclaredManifest(fullName, sha, subdir) {
  const base = subdir ? `${subdir}/` : ''
  return (await getRawJson(fullName, sha, `${base}manifest.json`)) ?? (await getRawJson(fullName, sha, `${base}dist/manifest.json`))
}

/** 读一个条目在 GitHub 上的现状：仓库、最新提交、声明清单与 package.json */
export async function inspect(entry) {
  const repo = await getRepo(entry.repo)
  if (!repo) throw new Error(`仓库 ${entry.repo} 不存在，或者是私有的`)
  const commit = await getHeadCommit(repo.fullName, repo.defaultBranch)
  const base = entry.subdir ? `${entry.subdir}/` : ''
  const [manifest, pkg] = await Promise.all([
    getDeclaredManifest(repo.fullName, commit.sha, entry.subdir),
    getRawJson(repo.fullName, commit.sha, `${base}package.json`),
  ])
  return { repo, commit, manifest, pkg }
}
