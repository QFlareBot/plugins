import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogRecord, checkCatalog, checkEntry, checkSource, installUrl, nameKey } from './catalog.mjs'

describe('checkEntry', () => {
  it('合规的条目没有错误', () => {
    assert.deepEqual(checkEntry('jrys.json', { repo: 'me/qflarebot-plugin-jrys', tags: ['娱乐'] }), [])
    assert.deepEqual(checkEntry('foo.json', { repo: 'me/tools', subdir: 'packages/foo' }), [])
  })

  it('文件名就是 name，要符合 name 规则', () => {
    assert.match(checkEntry('Foo.json', { repo: 'me/x' })[0], /文件名就是插件 name/)
    assert.match(checkEntry('-foo.json', { repo: 'me/x' })[0], /文件名就是插件 name/)
    assert.match(checkEntry('foo.yaml', { repo: 'me/x' })[0], /<name>\.json/)
  })

  it('内置插件和框架组件的名字保留，去掉的演示插件名可以登记', () => {
    assert.match(checkEntry('t2i.json', { repo: 'me/x' })[0], /保留名/)
    assert.match(checkEntry('qflarebot.json', { repo: 'me/x' })[0], /保留名/)
    assert.deepEqual(checkEntry('multi_reply.json', { repo: 'me/x' }), [])
  })

  it('只认 repo、subdir、tags', () => {
    assert.match(checkEntry('foo.json', { repo: 'me/x', desc: '…' })[0], /不认识的字段 desc/)
    assert.match(checkEntry('foo.json', [])[0], /JSON 对象/)
  })

  it('repo 必须是 owner/repo', () => {
    for (const repo of ['https://github.com/me/x', 'me', 'me/x/y', undefined]) {
      assert.match(checkEntry('foo.json', { repo }).join(), /owner\/repo/, String(repo))
    }
  })

  it('subdir 不能越出仓库', () => {
    for (const subdir of ['/abs', 'a/', '../up', 'a/../b', 'a/./b', '']) {
      assert.match(checkEntry('foo.json', { repo: 'me/x', subdir }).join(), /subdir/, subdir)
    }
  })

  it('tags 限数量、长度、不重复', () => {
    assert.match(checkEntry('foo.json', { repo: 'me/x', tags: 'a' }).join(), /字符串数组/)
    assert.match(checkEntry('foo.json', { repo: 'me/x', tags: [' a'] }).join(), /空格/)
    assert.match(checkEntry('foo.json', { repo: 'me/x', tags: ['1', '2', '3', '4', '5', '6'] }).join(), /最多 5 个/)
    assert.match(checkEntry('foo.json', { repo: 'me/x', tags: ['一二三四五六七八九十一二三'] }).join(), /最长 12 个字/)
    assert.match(checkEntry('foo.json', { repo: 'me/x', tags: ['a', 'a'] }).join(), /重复/)
  })
})

describe('checkCatalog', () => {
  it('- 与 _ 落到同一个表前缀，算撞名', () => {
    assert.equal(nameKey('my-plugin'), nameKey('my_plugin'))
    const errors = checkCatalog([
      { name: 'my-plugin', entry: { repo: 'a/qflarebot-plugin-my-plugin' } },
      { name: 'my_plugin', entry: { repo: 'b/qflarebot-plugin-my_plugin' } },
    ])
    assert.match(errors[0], /my_plugin 与 my-plugin 撞名/)
  })

  it('同一个仓库目录不能登记两次，大小写不敏感', () => {
    const errors = checkCatalog([
      { name: 'a', entry: { repo: 'Me/Tools', subdir: 'x' } },
      { name: 'b', entry: { repo: 'me/tools', subdir: 'x' } },
      { name: 'c', entry: { repo: 'me/tools', subdir: 'y' } },
    ])
    assert.deepEqual(errors, ['b 与 a 指向同一个仓库目录'])
  })
})

const REPO = {
  fullName: 'me/qflarebot-plugin-jrys',
  private: false,
  archived: false,
  defaultBranch: 'main',
  description: '仓库描述',
  stars: 3,
  license: 'MIT',
}
const MANIFEST = {
  name: 'jrys',
  version: '0.1.0',
  displayName: '今日运势',
  description: '抽运势',
  permissions: ['kv'],
  commands: [{ name: 'jrys', description: '抽一张', aliases: ['运势'] }, { name: 'raw' }],
  depends: { t2i: '*' },
  durableObjects: [],
}
const source = (over = {}) => ({
  name: 'jrys',
  entry: { repo: 'me/qflarebot-plugin-jrys' },
  repo: REPO,
  manifest: MANIFEST,
  pkg: { name: 'qflarebot-plugin-jrys' },
  ...over,
})

describe('checkSource', () => {
  it('对得上就没有错误', () => {
    assert.deepEqual(checkSource(source()), { errors: [], warnings: [] })
    assert.deepEqual(checkSource(source({ pkg: { name: '@me/qflarebot-plugin-jrys' } })).errors, [])
  })

  it('改名前的包名前缀不能登记', () => {
    assert.match(checkSource(source({ pkg: { name: 'qqbot-plugin-jrys' } })).errors[0], /包名要是 qflarebot-plugin-jrys/)
  })

  it('仓库名要跟包名一样；单仓库多插件时不管', () => {
    const renamed = { ...REPO, fullName: 'me/jrys' }
    assert.match(checkSource(source({ entry: { repo: 'me/jrys' }, repo: renamed })).errors[0], /仓库名要是 qflarebot-plugin-jrys/)
    assert.deepEqual(checkSource(source({ entry: { repo: 'me/jrys', subdir: 'p' }, repo: renamed })).errors, [])
  })

  it('manifest 的 name 要等于文件名', () => {
    assert.match(checkSource(source({ manifest: { ...MANIFEST, name: 'other' } })).errors[0], /两者要一样/)
    assert.match(checkSource(source({ manifest: null })).errors[0], /npm run sync/)
  })

  it('仓库改过名、归档、没 LICENSE 只提醒', () => {
    const { errors, warnings } = checkSource(
      source({ entry: { repo: 'me/qqbot-plugin-jrys' }, repo: { ...REPO, archived: true, license: null } }),
    )
    assert.deepEqual(errors, [])
    assert.equal(warnings.length, 3)
    assert.match(warnings.join(), /已改名为 me\/qflarebot-plugin-jrys/)
  })
})

describe('catalogRecord', () => {
  it('从清单取展示信息，作者是仓库 owner', () => {
    const record = catalogRecord({
      name: 'jrys',
      entry: { repo: 'me/qflarebot-plugin-jrys', tags: ['娱乐'] },
      repo: REPO,
      commit: { sha: 'a'.repeat(40), date: '2026-09-26T00:00:00Z' },
      manifest: MANIFEST,
    })
    assert.deepEqual(record, {
      name: 'jrys',
      repo: 'me/qflarebot-plugin-jrys',
      installUrl: 'https://github.com/me/qflarebot-plugin-jrys',
      author: 'me',
      displayName: '今日运势',
      description: '抽运势',
      version: '0.1.0',
      tags: ['娱乐'],
      permissions: ['kv'],
      commands: [{ name: 'jrys', description: '抽一张' }, { name: 'raw' }],
      depends: ['t2i'],
      services: [],
      durableObjects: [],
      hasUi: false,
      license: 'MIT',
      stars: 3,
      sha: 'a'.repeat(40),
      updatedAt: '2026-09-26T00:00:00Z',
    })
  })

  it('子目录插件的安装地址带分支', () => {
    assert.equal(installUrl('me/tools', 'master', 'packages/foo'), 'https://github.com/me/tools/tree/master/packages/foo')
  })
})
