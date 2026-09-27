# QFlareBot 插件目录

[QFlareBot](https://github.com/QFlareBot/QFlareBot) 的插件登记处。这里登记的插件出现在[插件市场](https://qflarebot.github.io/market)里，数据发布在 <https://qflarebot.github.io/plugins/index.json>。

完整说明见文档站的[发布插件](https://qflarebot.github.io/publish)，下面是提交时要知道的。

## 登记一个插件

在 `plugins/` 下加一个 `<name>.json`，文件名就是插件的 `name`（`definePlugin({ name })` 里那个），然后提 PR：

```json
{
  "repo": "me/qflarebot-plugin-hello",
  "tags": ["娱乐"]
}
```

| 字段 | 说明 |
| --- | --- |
| `repo` | 必填，GitHub 仓库 `owner/repo`，必须公开 |
| `subdir` | 选填，插件在仓库子目录里时写相对路径，例如 `packages/hello` |
| `tags` | 选填，最多 5 个，每个不超过 12 个字 |

名称、版本、描述、权限、命令都不在这里写，从你仓库里提交的 `manifest.json` 读。插件发新版本不用再提 PR，目录每 6 小时重读一次各仓库的默认分支。

## 规则

- 仓库名 = 包名 = `qflarebot-plugin-<name>`。单仓库放多个插件时仓库名不限，每个插件的包名照样要守。
- 插件目录下提交了 `npm run sync` 生成的 `manifest.json`，与源码一致；有第三方依赖要提交 lockfile。
- `name` 先登记的先得。比较时 `-` 当成 `_`：`my-plugin` 与 `my_plugin` 的 D1 表前缀相同，一个机器人里装不到一起。
- 保留名：`sid`、`t2i`（内置插件），以及 `qqbot`、`qflarebot`、`core`、`admin`、`system`、`runtime`。
- 建议带 LICENSE，并给仓库加 topic `qflarebot-plugin`。

PR 上的 CI 会检查条目格式与撞名，读你仓库默认分支的最新提交核对名字与清单，再用机器人构建机同一套脚本把插件真构建一遍。本地可以先跑：

```bash
node scripts/check.mjs <name>                     # 格式 + 联网核对
node scripts/check.mjs <name> --build ../QFlareBot  # 再加真构建，要一份 pnpm install && pnpm build 过的 QFlareBot
```

## 目录不是安全审核

插件与框架核心跑在同一个 isolate 里，没有沙箱。目录只检查登记那一刻的代码能构建、名字不冲突；之后的每次更新都直接来自作者的默认分支，不经过这里。装之前请自己看一眼仓库。
