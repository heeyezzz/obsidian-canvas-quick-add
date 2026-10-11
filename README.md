# Canvas Quick Add

在安卓手机的白板（Canvas）右下角加一个「＋ 卡片」按钮，点一下就在视口正中生出一张文本卡并直接进入编辑状态，键盘自动弹起。

## 为什么需要

Obsidian 桌面端白板底部中间有卡片菜单（便利贴、笔记、链接三个按钮，可以点也可以拖）。它的样式表里有这么一条：

```css
.is-phone .canvas-card-menu { display: none; }
```

也就是说在手机上这个菜单被官方直接隐藏了，而拖拽操作在触控屏上本来也不好使。结果是手机白板没有快速建卡片的入口，每次都得绕路。这个插件补的就是这个入口。

## 安装

### 方式一：BRAT（推荐）

1. 在 Obsidian 社区插件里搜索 **BRAT**（作者 tfthacker，插件 ID 是 `obsidian42-brat`）并安装启用。
2. 打开 BRAT 的设置，添加插件仓库，地址填 `https://github.com/heeyezzz/obsidian-canvas-quick-add`。
3. BRAT 会拉取本仓库最新的 Release 并装上，之后在第三方插件列表里打开开关。

以后更新只需在 BRAT 里点这个插件的 Check for update。

### 方式二：手动

从 [Releases](https://github.com/heeyezzz/obsidian-canvas-quick-add/releases) 下载 `main.js`、`manifest.json`、`styles.css` 三个文件，放进你库里的 `.obsidian/plugins/canvas-quick-add/` 目录，然后重启 Obsidian 并在第三方插件里打开开关。

安卓 13 及以上版本的文件管理器通常写不进 `Android/data/` 下的目录，如果库在那里，建议用方式一。

## 设置

插件设置里只有一项：桌面端也显示按钮。默认关闭，因为桌面端本来就有官方卡片菜单。打开它可以在电脑上预览按钮效果。

平板不受影响：Obsidian 只在 `is-phone` 下隐藏卡片菜单，平板上官方菜单还在，所以不会出现两个入口。

## 命令

除了按钮，还注册了一条命令面板命令：在白板视口中心新建文本卡片。

## 开发

```bash
npm install
npm run build          # 产物在 ./dist
CANVAS_VAULT=/path/to/vault npm run build   # 直接构建进某个库
```

`npm run dev` 是 watch 模式。

## 实现说明和风险

Obsidian 没有公开的 Canvas 运行时 API，官方类型定义里只有 `.canvas` 文件的 JSON 格式。这个插件调用的是两个内部成员：`canvas.posCenter()` 和 `canvas.createTextNode({pos, position})`，它们和桌面端卡片菜单里便利贴按钮的点击处理用的是同一条路径。

插件只调用、不替换这些方法，所以和 Advanced Canvas 这类会 patch Canvas 内部的插件不冲突，调用到的是它们改过之后的行为。

风险是内部成员名可能随 Obsidian 版本变化。真变了不会静默失效，会弹一条提示，届时按新版本重新确认方法名即可。目前验证过的版本是 1.14.4，桌面端和安卓端（Android 15 模拟器、pixel_7）都测过，iOS 没有设备验证。
