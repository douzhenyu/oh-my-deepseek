# oh-my-deepseek

DeepSeek Harness（`dsh`）的**跨平台桌面客户端容器**：把 harness 装进一个客户端里，用户双击打开就能用，不需要命令行、不需要 `pnpm dsh web`；关闭窗口后继续在后台运行，明确选择「退出」时才停止后台进程。

支持 **macOS** 与 **Windows**。

> ### ⚠️ 非官方项目
>
> 这是一个**第三方、非官方**的桌面封装，由社区成员独立开发，**与 DeepSeek 官方没有隶属、合作或背书关系**。
>
> - "DeepSeek"、"DeepSeek Harness" 是 DeepSeek 的商标，本项目名称与图标的使用仅用于说明它是"运行 DeepSeek Harness 的容器"，不代表官方出品。
> - 官方项目在 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；请以其官方文档与发布为准。
> - 本项目只做进程与版本管理，不修改 harness 本身：内置的 `dsh` 直接取自官方 npm 包 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)。
> - 品牌使用遵守官方的 [BRAND_GUIDELINES](https://github.com/deepseek-ai/deepseek-harness/blob/main/BRAND_GUIDELINES.md)。如官方认为本项目的命名或图标不妥，我们会立即调整。

## 下载

到 [Releases](../../releases) 页面按平台下载：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| macOS (Apple Silicon) | `oh-my-deepseek-<版本>-mac-arm64.dmg` / `.zip` | **未签名**，首次打开需右键 → 打开；内置 dsh，可离线使用 |
| Windows (x64) | `oh-my-deepseek-<版本>-win-x64.exe` | **未签名**且**未在 Windows 上实测**，首次启动需联网安装 dsh；详见该 Release 的说明 |

---

## 目录

- [1. 它解决什么问题](#1-它解决什么问题)
- [2. 用户怎么用](#2-用户怎么用)
- [3. 快速开始（开发）](#3-快速开始开发)
- [4. 运行机制](#4-运行机制)
- [5. 打包](#5-打包)
- [6. 验证](#6-验证)
- [7. 两次真实的返工记录](#7-两次真实的返工记录)
- [8. 目录结构](#8-目录结构)
- [9. 已知限制](#9-已知限制)
- [10. 安全说明](#10-安全说明)
- [11. 开发命令](#11-开发命令)

---

## 1. 它解决什么问题

官方运行方式是 `npx @deepseek-ai/dsh web` 或 `pnpm dsh web`：需要用户自己装 Node、自己开终端、自己记命令，而且关掉终端后后端进程不一定干净退出。

这个容器把这些都包起来：

| 用户的麻烦 | 容器里的做法 |
| --- | --- |
| 要自己装 Node.js | 客户端自带官方上游 Node.js 运行时，用户机器上不需要任何 Node |
| 要在终端敲 `pnpm dsh web` | 打开客户端自动启动后端，就绪后自动加载界面 |
| 关闭窗口会打断正在进行的任务 | 关闭按钮只隐藏窗口；从菜单或托盘明确退出时才回收整个后端进程组 |
| 升级 dsh 要懂 npm | 客户端内"Harness 版本"面板直接安装/切换/删除版本 |
| 安装插件要在终端执行 `dsh plugin` | 客户端内置插件市场，搜索、安装、更新、卸载都在界面完成 |
| 版本混乱 | 每个版本独立目录，随时切回旧版本；内置版本只读，升级只写用户数据目录 |

> 与官方 `apps/desktop` 的区别：官方桌面端把 **外壳与 dsh 版本绑成一个发布单元**（升级 dsh = 升级整个客户端），这是它有意的架构决定。本容器反过来：**外壳与 dsh 版本解耦**，dsh 可以独立安装、升级、回退。代价是失去官方的签名发布流水线与免端口传输，换来"只是个容器"的轻量与灵活。

---

## 2. 用户怎么用

打开客户端 → 出现控制台窗口显示启动进度 → 后端就绪后自动打开 Harness 界面。

**控制台**（`Cmd/Ctrl+Shift+C`，或菜单 Harness → 控制台）可以：

- 看到后端状态、端口、进程号、实时日志
- **打开 Harness** / 启动 / 停止 / 重启后台
- 在"Harness 版本"里：查看已安装版本（标记 `内置`/`已安装`/`运行中`）、一键 `使用`、删除用户安装的版本
- 点"检查可用版本"从 npm registry 拉取全部已发布版本，按任意版本 `安装`（安装完自动切换并重启后端）；非当前旧版本可删除，内置版本会从列表移除但保留为签名 App 的只读兜底
- 有新版本时顶部会提示 `最新发布: x.y.z — 可升级到 x.y.z`
- 在「插件市场」中搜索和筛选社区目录，一键安装、更新或卸载当前 web profile 的插件
- 高级区：在「与命令行共用数据目录」和「使用独立数据目录」之间切换（会说明各自代价）、自定义数据目录路径、开关自动启动/启动时检查更新/对话完成通知、打开日志与数据目录

### 客户端内置插件市场

插件市场是客户端自己的页面，不加载或依赖 `dshmarket` 的前端。它读取 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 的社区目录，并把每个条目与当前 Harness 数据目录下 `profiles/web/package.json` 的实际依赖对照，因此「已安装」和「可更新」状态跟随当前数据目录。

- 支持中英文描述、关键词搜索、分类，以及按收藏数、下载数、收录时间和名称排序
- 支持 npm 包、GitHub 仓库和目录中经过校验的 GitHub Release 压缩包
- 安装、更新和卸载前会停止后台，完成后恢复原先的运行状态，避免配置与正在运行的 profile 互相争用
- 包管理不调用系统 `pnpm`：客户端通过自带 Node 的 Corepack 运行固定版本的 pnpm，所以 Windows 用户也不需要先配置命令行环境
- 旧 profile 首次变更插件时会迁移到客户端自己的 pnpm Store；迁移期间保留原 `node_modules`、清单和锁文件，失败会完整恢复
- 安装完成后，客户端会根据插件 `package.json` 中的 `dsh.bundle.patch` 自动维护 `dsh.profile.bundles`

### 对话完成的系统通知

**当一轮回复结束、而你没有在看窗口时**，客户端会弹一条系统通知，标题是这段对话的标题（harness 还没生成标题时就用 workspace 目录名），点一下回到窗口。你正看着窗口时不会打扰你。

开关在「高级」里（默认开启）。

它靠**只读会话日志**实现，而不是往 harness 里塞东西：容器不参与 turn 生命周期，也不注入 harness 的 UI（那样会被 harness 的版本升级搞坏）。做法是读 `<harness home>/sessions/…/session.v3.jsonl.zstd`——这是 harness 自己写的、带版本的持久格式：

- 日志是**一串各自独立的 zstd 帧**（harness 每批持久事件追加一帧），所以容器能只解析帧结构定位边界、只解压没读过的帧，开销可以忽略
- 判定信号是 `turn/end` 事件，从中拿到轮次与结束原因
- **子代理会话被排除**：头帧里有 `delegationDepth`，非 0 的是被委派的会话，它们自己的 turn 结束不代表你的对话结束——不排除就会在你还在等的时候告诉你"完成了"
- 首次看到的日志**只作为历史记录下来、不产生通知**，所以你打开客户端时不会被历史对话刷屏

共用数据目录时，命令行 dsh 的对话也会被一并监听并提醒（因为日志在同一份 home 下）；想只监听客户端自己的对话，就切到独立数据目录。

> **为什么 macOS 上必须签名才能弹通知**
>
> Electron 42 起，macOS 通知从废弃的 `NSUserNotification` 改为 [`UNNotification`](https://www.electronjs.org/blog/electron-42-0)，后者**拒绝显示任何来自未签名应用的通知**。而且失败是**静默**的：`Notification.isSupported()` 照样返回 `true`，`show()` 不报错，只有 `failed` 事件里才有原因（`UNErrorDomain error 1`）。
>
> 更隐蔽的是，Electron 发行版**自带**的签名也不满足要求——它是链接器打的 `flags=0x20002(adhoc,linker-signed)`、identifier 为 `Electron`，`UNNotification` 不接受这一类。
>
> 所以打包流程在没有真实证书时，会用**应用自己的 identifier 做一次 ad-hoc 签名**（`flags=0x2(adhoc)`、`Info.plist` 被绑定、资源被封印）。这不是美化：不做这一步，通知在这台机器上**永远不会出现**，而且设置里也找不到这个应用。`npm run smoke --binary ...` 会断言产物的签名形态。
>
> 容器也会监听 `failed` 事件并把原因写进日志——否则"系统拒绝了"和"用户没看见"在日志里长得一模一样，这次就是踩了这个坑才查了半天。

### 客户端自身的更新

控制台顶部有一张**「客户端」**卡片，管的是**这个客户端本身**的版本，和下面的 Harness 版本互不相干：

- 启动时（可关闭）会去项目的 GitHub Releases 查一次最新版本，也可以在卡片里手动「检查客户端更新」
- 有新版会显示可更新到的版本、下载按钮，以及通往发布说明的链接
- 下载走同一个下载器：先写 `.part`，传输完成且**字节数与发布页声明的一致**才改名落地，半截文件永远不会被拿去安装

不同平台能做的事不一样，界面会照实说明：

| 平台 | 下载后 | 原因 |
| --- | --- | --- |
| **Windows** | 直接运行安装包并退出客户端，安装程序替换自身 | NSIS 不需要代码签名即可完成替换 |
| **macOS** | 打开下载好的磁盘映像，你把 App 拖进「应用程序」 | **未签名的构建无法静默自更新**：Squirrel.Mac 要求运行中的 App 已签名、且新版本签名匹配，而本项目的构建刻意不签名 |

所以 macOS 上是"下载 + 引导替换"，不是一键静默升级。**如果你以后配好 Apple Developer ID 签名与公证，把 `installRelease()` 换成 electron-updater 即可拿到真正的静默自更新**——检查、选包、下载这三段是共用的，不需要重写。

「检查客户端更新」的开关在「高级」里（默认开启）。

客户端外壳（控制台窗口、窗口背景）跟随**系统**的浅色/深色设置——和 harness UI 自身的行为一致（它的主题偏好默认就是跟随系统）。

关闭窗口不会停止 Harness：macOS 可从 Dock 或应用菜单重新打开，Windows 可单击通知区域的托盘图标重新打开，右键托盘图标还能直接进入控制台、重启/停止后台或退出。只有选择「退出」才会停止后端并回收进程树。

---

## 3. 快速开始（开发）

需要 Node.js ≥ 22 与 npm/pnpm。

```sh
npm install

# 准备随应用发布的运行时（下载并校验官方 Node.js 24.17.0 + 安装内置 dsh）
npm run prepare:app

npm start          # 构建并启动容器
npm run console    # 启动并额外打开控制台窗口
```

`prepare:app` 只需要跑一次；它把 Node.js 解压到 `resources/node/<platform>-<arch>/`，并把 `container.config.json` 里 `dshSeedVersion` 指定的 dsh 安装到 `resources/dsh-seed/`。

---

## 4. 运行机制

### 4.1 版本从哪来

启动时按顺序解析要运行的 dsh 版本：

1. `settings.json` 里记录的 `activeVersion`（用户上次选择）
2. 应用内置版本（`resources/dsh-seed`，只读）
3. 用户数据目录里最新的已安装版本
4. 以上都没有 → 用内置的 npm 安装 `dshSeedVersion`

一个版本只有在其 CLI 入口 `lib/bin.js` 真实存在时才算"已安装"，所以中断的安装永远不会被误激活。

### 4.2 后端怎么起

真正执行的命令是：

```
<bundled node> supervisor.mjs --parent <electron-pid> -- <bundled node> <dsh-entry> web --no-open --port <port>
```

- **必须用自带的上游 Node.js**，不能用 Electron 的 Node：后者带 Electron 补丁、ABI 与生命周期约束。开发态若未准备运行时，才回退到系统 `node`。
- `--port` 优先用 `settings.port`（默认 3080），被占用时用 `0` 让系统分配，避免冲突。
- **就绪判定**用官方认可的信号：`dsh web: <url>` 输出行（dsh 源码注释明确写着 supervisors 以该行为 RPC 时机）。解析出真实端口，并把这个**带一次性 token 的 URL** 交给窗口加载，走正常 303 + `Set-Cookie` 握手。
- token 是 Harness API 的凭据，因此日志与 IPC 状态里的 token 一律脱敏成 `<redacted>`。

### 4.3 进程生命周期：三层保障

"关掉客户端后台就没了"依赖三层，任何一层单独都不够：

| 层 | 触发条件 | 行为 |
| --- | --- | --- |
| Electron `before-quit` | 菜单退出、托盘退出、安装客户端更新 | 异步优雅停止：先 SIGTERM 进程组，8s 未退再 SIGKILL |
| `supervisor.mjs` 父进程轮询 | 主进程被 `SIGKILL`、崩溃，没有任何清理代码能跑 | 每 500ms 检查父进程存活（POSIX 看 `ppid` 是否被 reparent，Windows 用零信号探测），父进程消失即回收整个进程组 |
| `process.on('exit')` + 信号处理 | 主进程正常退出但没走到 `before-quit`、收到 SIGINT/SIGTERM | 同步杀进程组兜底 |

关键设计：

- 后端**从不直接 spawn**，永远经过 supervisor；supervisor 与 harness 同属一个进程组，所以"杀组"能覆盖 dsh 自己拉起的子进程（MCP server、shell 工具等）。
- 父进程死亡检测**不依赖 stdin EOF**：Electron/Chromium 的 renderer 与 GPU 辅助进程可能持有那个管道写端，实测过 EOF 不可靠（详见第 7 节验证记录），所以改成轮询 `ppid`。
- Windows 用 `taskkill /pid <pid> /T /F` 杀进程树（Windows 没有负 pid 组信号），并且用 `windowsHide` 避免闪控制台窗口。

### 4.4 数据放哪

| 内容 | 位置 |
| --- | --- |
| Harness 会话、设置、凭据、存储 | 见下面的「两种数据目录模式」 |
| 用户安装的 dsh 版本 | `<userData>/dsh/<version>/` |
| dsh 内置版本 | `<app Resources>/dsh-seed/`（只读） |
| 包管理器缓存与 npmrc | `<userData>/npm-cache`、`<userData>/corepack`、`<userData>/pnpm-store`、`<userData>/npmrc` —— 不依赖系统级包管理器 |
| 容器设置 | `<userData>/settings.json` |
| 日志 | `<userData>/logs/container.log` |

`userData` 在 macOS 是 `~/Library/Application Support/Oh My DeepSeek`，在 Windows 是 `%APPDATA%\Oh My DeepSeek`。

这个目录名由 `container.config.json` 的 `dataDirectory` **显式钉住**，与 `productName` 解耦：品牌名以后可以随便改（窗口、菜单、安装包都会跟着变），但用户已安装的 dsh 版本和设置不会被搬到新目录里、看起来像丢了数据。

### 两种数据目录模式（控制台「高级」可切）

harness 是**单根目录**设计：凭据、设置、技能、会话、存储全都在同一个 root 下，没有受支持的办法"共用凭据但分开会话"。所以容器提供两个整根模式：

| 模式 | 行为 | 代价 |
| --- | --- | --- |
| **共用**（默认） | 与命令行 `dsh` 同一个 root，历史与凭据是一份 | 同一个会话同一时刻只能在一个地方打开 |
| **独立** | 使用 `<userData>/harness-home` 自己的 root | 与命令行不再共享历史 |

切到独立模式时，会从共用 root **一次性复制**凭据（`.credentials.yaml`，并强制 `0600`）、`settings.yaml`、`skills/`、`.anonymous-user-id`；已存在的条目不覆盖，所以不需要重新登录。**会话、存储不会被复制**，这正是隔离的意义。

> **为什么会看到 `SessionAlreadyOwnedError`**
>
> 如果你在共用模式下遇到：
>
> ```
> resume failed for session "session-…": SessionAlreadyOwnedError:
> session "…" is already owned by an active write handle (gateway/internal)
> ```
>
> 这不是客户端的 bug，也不是数据损坏：dsh 对每个会话持有一个**内核写租约**（POSIX 是 `session.lock` 上的 `flock`，Windows 是对应路径派生的内核信号量），只要某个进程的写句柄还开着，另一个进程就不能续写同一个会话。
>
> 几个关键事实：
> - 租约由内核管理，**持有进程一死就自动释放**，所以不存在"上次崩溃留下的死锁"；报错一定意味着确实有另一个活着的 dsh 正打开着它。
> - 它**故意没有超时抢占**——如果允许超时夺权，一个卡住的写者恢复追加会撕裂会话日志。
> - 常见触发场景：命令行里开着某个会话，又去客户端里点开同一个会话（反之亦然）。
> - 客户端本身不受影响，它自己的会话照常工作；换一个会话或新建一个即可。
>
> 想彻底不再遇到，就在控制台「高级」里切到**独立数据目录**。

需要隔离时可在控制台"高级"里改 Harness 数据目录。

---

## 5. 打包

```sh
npm run package:mac:arm64      # Apple Silicon
npm run package:mac:x64        # Intel（需 Intel 机器或 Rosetta）
npm run package:win:x64        # 需在 Windows x64 上执行
```

产物在 `.build/<target>/`：macOS 出 `.dmg` 与 `.zip`，Windows 出 NSIS 安装包。

每个 target 会先自动 `fetch-node`、`prepare-seed`、`build`，再调用 electron-builder。

### 打包矩阵（本机实测）

| 命令 | 宿主 | 结果 |
| --- | --- | --- |
| `package:mac:arm64` | mac arm64 | ✅ dmg 233 MB + zip，**内置 seed，离线可用** |
| `package:win:x64` | mac arm64（跨平台） | ✅ NSIS 安装包 134 MB，**不含 seed，首次启动联网安装 dsh** |
| `package:mac:x64` | mac arm64（跨平台） | 可产出，同样不含 seed；要完整离线包请在 Intel 机器上打 |

- **Node 运行时可以跨平台准备**：Windows 的 `node.exe` 在 mac 上照样下载、校验 SHA-256、用 `unzip`/`ditto` 解压（已验证）。
- **dsh seed 不能跨平台**：里面含平台相关原生模块（node-pty 等）。`prepare-seed` 会把平台写入 `resources/dsh-seed/seed.json`，打包时**只有平台匹配才纳入**，否则明确告警并排除。这不是防御性猜测——第一次跨平台打包时 mac 的 seed 真的被打进了 Windows 安装包，这个标记就是为此加的。
- 不含 seed 的产物不是残缺品：应用首次启动会用内置 npm 安装 `dshSeedVersion`，只是需要一次联网（约 30s）。
- 默认**不签名**（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。签名与公证见下节；Windows 签名沿用 electron-builder 的常规输入。
- 打包有**资源校验门**（`afterPack`）：校验 supervisor、内置 Node、seed CLI 入口存在，且 seed 文件数不少于源目录。资源映射失败是静默的——不校验就会打包成功、到用户机器上才炸。实测就在这一步抓到过 seed 只复制了 2 个文件的问题。

### 图标与品牌

应用图标是黑鲸鱼：`build/icon-source.svg`（白色圆角底 + 黑色鲸鱼）是**唯一真源**，位图图标全部由它生成：

```sh
npm run icons      # icon-source.svg -> build/icon.icns / icon.png
```

渲染用 Chromium 自己的 SVG 渲染器把矢量画到 canvas 上，因此结果不依赖屏幕缩放比例，Retina 机器和 CI 上一致。electron-builder 会自动拾取 `build/icon.icns`、`build/icon.png`（Windows 端由它据此转换出 `.ico`）。要换图标只改 SVG 再跑 `npm run icons`，不要手工编辑位图。

显示名称由 `container.config.json` 的 `productName` 决定，当前是 **Oh my deepseek!**，作用于：macOS 菜单栏应用菜单、窗口标题栏、控制台顶部标题、关于面板、安装包与快捷方式。

> 品牌提示：DeepSeek 的[品牌资产使用规范](https://github.com/deepseek-ai/deepseek-harness/blob/main/BRAND_GUIDELINES.md)建议项目名不要直接使用 "DeepSeek Harness" 商标、推荐用 "DSH" 缩写，并避免让人误以为获得官方背书。个人自用没问题；若要对外分发，建议核对这份规范。

---

### macOS 签名与公证

**未签名的包能用，但每次都要用户右键→打开，而且无法静默自更新。** 要彻底解决，需要 Apple 的**付费**开发者账号：

| 需要什么 | 说明 |
| --- | --- |
| Apple Developer Program 会员 | **99 美元/年**（各地区价格不同；非营利组织、认证教育机构、政府机构可[申请豁免](https://developer.apple.com/support/fee-waiver/)） |
| **Developer ID Application** 证书 | 直接分发（dmg/zip）用这一种，不是 "Apple Distribution"（那是 Mac App Store 用的） |
| 公证凭据 | Apple ID + App 专用密码，或 App Store Connect API Key |
| Hardened Runtime + entitlements | 已在 `build/entitlements.*.plist` 里配好（Electron 的 V8 需要 JIT 相关授权，缺了会"公证通过但一启动就崩"） |

个人注册需要：开启双重认证的 Apple Account、法定姓名（用昵称/公司名会拖慢审核）、真实地址与电话。组织注册额外需要 **D-U-N-S 编号**、企业域名邮箱、可访问的官网。

拿到证书后：

```sh
# 方式一：证书已在钥匙串里（名字可从「钥匙串访问」复制，前缀会被自动去掉）
export OHMYDSH_MAC_IDENTITY='Developer ID Application: Your Name (TEAMID)'
# 方式二：直接给 .p12（CI 里通常是 base64）
export CSC_LINK=/path/to/cert.p12 CSC_KEY_PASSWORD='...'

# 公证凭据（三选一，给了才会开启公证）
export APPLE_ID='you@example.com' APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx' APPLE_TEAM_ID='TEAMID'
# 或 export APPLE_API_KEY=<base64 p8> APPLE_API_KEY_ID=... APPLE_API_ISSUER=...
# 或 export APPLE_KEYCHAIN_PROFILE=...

# 让缺少凭据时直接失败，而不是静默产出未签名的包（CI 里建议开）
export OHMYDSH_REQUIRE_SIGNING=1

npm run package:mac:arm64
```

构建会打印它实际采用的签名与公证决定，例如
`electron-builder: signing with the CSC_LINK certificate; notarization DISABLED (no APPLE_ID, ...)`。

验证产物：

```sh
spctl --assess --verbose --type exec "/path/Oh my deepseek!.app"   # 期望 accepted / Notarized Developer ID
xcrun stapler validate "/path/Oh my deepseek!.app"                 # 期望 The validate action worked!
```

> ⚠️ **还有一个已知缺口：嵌套二进制尚未签名。** 安装包里有 16 个 Mach-O 可执行文件在 `extraResources` 里——内置 Node 运行时本身（1 个）、dsh seed 里的原生模块（12 个 `.node`）与其它可执行文件（3 个）。公证要求**包里每一个可执行文件**都用同一张 Developer ID 签名并启用 hardened runtime，否则公证会以 "The executable does not have the Hardened Runtime enabled" 之类的错误被拒。
>
> 官方的 `apps/desktop` 是在**打包前**就对运行时里的原生文件逐个签名，并用 `signIgnore` 让 electron-builder 不要重复签。本项目还没有做这一步——所以现在拿到证书后，**大概率会在公证环节被拒**，而不是签出可用的包。这一步需要真实证书才能验证，等你有证书时告诉我，我按官方那套接上并实测。

## 6. 验证

两条真实端到端检查，都是在真机启动真应用，不是 mock：

```sh
npm run smoke                     # 开发态：启动 → 加载界面 → 正常退出
npm run smoke -- --install 0.1.5-rc.2   # 追加：应用内安装并切换版本
npm run smoke -- --keep           # 复用上次的用户数据（可验"重启后仍用已切换版本"）
npm run smoke -- --binary "<应用二进制路径>"   # 验证打包产物
npm run smoke -- --home separate  # 验证独立数据目录：复制凭据/技能、不复制会话、可切回
npm run verify:crash              # 主进程被 SIGKILL 后不留残留
```

`npm run smoke` 断言的内容：

- 容器进入 `ready`
- **控制台窗口通过 preload 桥真实渲染**（防止 CSP / preload 静默失效）
- **Harness 页面真的启动**（`__ModuleLoader__.mode` 离开 `queue`、body 已渲染）
- 关闭 Harness 窗口后窗口对象仍保留、后台 PID 不变，并能恢复同一页面
- 未带 cookie 的请求返回 401（服务在跑且鉴权围栏生效）
- 一次性 token URL 返回 303（交接链路生效）
- 退出码为 0
- **被监督的后端进程已消失**
- **没有任何 harness 进程存活**

### 本机实测结果（macOS 26.6.2 / arm64，Electron 44.3.0）

```
ok  容器进入 ready
ok  控制台窗口经 preload 渲染   {"mode":"live","heading":"DeepSeek Harness 客户端容器","status":"运行中"}
ok  Harness 页面已启动          {"title":"DeepSeek Harness","mode":"live","bodyLength":44778}
ok  未鉴权请求被拒              401
ok  一次性 token URL            303
ok  应用内安装并切换到 0.1.5-rc.2
ok  切换后 Harness 页面重新启动
ok  退出码 0
ok  被监督的后端进程已消失
ok  无 harness 进程残留
launch 4932ms / console 6ms / page 393ms
```

```
$ npm run verify:crash
main=77294 supervisor=77334 harness=77335
sending SIGKILL to the main process
ok  主进程已消失
ok  harness 未存活   — survived 707ms
ok  supervisor 未存活
```

其他实测结论：

- 正常退出：后端约 1s 内干净停止（SIGTERM → 退出码 0）
- 应用内升级：内置 npm 安装 519 个包约 30s，安装后自动重启后端到新版本，页面重新加载
- 重启持久化：`settings.json` 记录的版本在下次启动被正确沿用（后端从 `<userData>/dsh/…` 启动，而非内置 seed）
- 硬杀回收：后端**完全就绪**时 0.83s；若在后端**启动中途**硬杀，约 5s（dsh 在 boot 阶段对 SIGTERM 响应较慢），仍远小于 8s 强杀阈值

---

## 7. 两次真实的返工记录

### 7.1 为什么父进程检测是轮询

最初 supervisor 靠 `stdin` EOF 判断父进程死亡——这是常见写法。实测 `kill -9` Electron 主进程后：

```
supervisor alive: yes     harness alive: yes     → 残留
```

原因：Electron/Chromium 的 renderer、GPU 等辅助进程可能继承并持有那个管道写端，主进程死后管道不会 EOF。改成轮询父进程存活后：

```
+0.7s → supervisor gone, harness gone
```

这条承诺现在由 `npm run verify:crash` 持续回归。

### 7.2 为什么 seed 需要平台标记

electron-builder 会静默跳过源目录根部的 `node_modules`。第一次打包出来的 `dsh-seed` 只有 **2 个文件**（388 KB，而源目录是 280 MB）——应用装到用户机器上才会发现没有 dsh 可用。

按官方桌面端的做法显式再映射一次 `node_modules` 后文件数正常，但紧接着发现第二个问题：从 mac 打 Windows 包时，**mac 的 seed 被打进了 Windows 安装包**（平台相关的原生模块会直接错）。因此增加了 `seed.json` 平台标记 + `afterPack` 资源校验门：文件数对不上、平台对不上，构建直接失败，而不是等用户踩。

---

## 8. 目录结构

```
container.config.json          产品标识与固定版本（app 与脚本共用的唯一真源）
electron-builder.config.mjs    按 target 生成的打包配置 + afterPack 资源校验
src/
  main/
    main.ts                    应用入口、退出与信号编排
    tray.ts                    Windows 通知区域图标与后台入口
    container.ts               状态机：版本选择、启动、安装/激活/删除
    backend.ts                 启动 supervisor、解析就绪行、回收进程组
    version-store.ts           版本发现、npm 安装（staging + 原子改名）、删除
    registry.ts                npm registry 版本查询
    node-runtime.ts            自带 Node / npm / Corepack 解析
    plugin-market.ts           社区目录校验、安装状态与跨平台插件包管理
    windows.ts                 控制台窗口 + Harness 窗口
    preload.ts / ipc.ts        窄桥与校验过的 IPC 处理器
    log.ts                     有界日志 + token 脱敏
    session-log.ts             会话日志的 zstd 帧扫描与事件解码（只读）
    completion-watch.ts        轮询会话日志，产出"回合结束"事件
    notifications.ts           系统通知的判定与展示
    smoke.ts                   端到端自检场景
  supervisor/supervisor.mjs    父进程死亡检测与进程组回收
  renderer/                    控制台 UI（无框架，纯 DOM + CSP）
  shared/types.ts              三端共享契约
scripts/                       构建、运行时准备、打包、两个验证脚本
```

Vite/React 都没有：控制台是纯 HTML/CSS/DOM，所有从 registry 来的字符串都用 `textContent` 插入，不可能变成标记。

---

## 9. 已知限制

- **Windows 长路径**：dsh 的依赖树较深，装在深目录下可能触碰 260 字符上限。建议启用 Win32 长路径支持，或把应用装在较短的路径下。
- **Windows 产物的运行未在本机验证**：NSIS 安装包能在 mac 上打出来，但从 mac 无法启动 Windows 二进制。Windows 端的"打开即用/关窗即停"需要在 Windows x64 上跑 `npm run smoke` 与 `npm run verify:crash` 才算验证过。要拿到**离线可用**的 Windows 包，也必须在 Windows 上执行 `npm run prepare:seed`。
- **mac x64 的完整离线包需要在 Intel 机器上准备 seed**；在 arm64 上跨平台打包会得到首次启动联网安装的产物。
- **默认未签名**：本地产物可直接运行；分发给他人需要 Apple Developer ID + 公证，或 Windows 代码签名证书。
- **macOS 上无法静默自更新**：未签名的构建做不到（见上文），只能下载后手动替换。Windows 上是可以的。
- **Linux 未支持**（与官方桌面端一致）。
- **单实例**：同时只允许一个容器实例，避免两个进程争抢同一份 harness 数据与包目录。
- **共用模式下跨进程的会话互斥**：这是 dsh 的设计语义，不是容器能绕过的（详见 4.4）。要完全避免就切到独立数据目录。
- **共用模式下通知会覆盖命令行的对话**：因为日志在同一份 home 下。想只提醒客户端自己的对话，就用独立数据目录。
- **通知的"系统是否真的弹出"没有被自动化断言**：测试断言的是通知能力受支持、判定规则正确、以及真实会话日志能被逐帧解析；系统横幅本身只能人眼确认。

---

## 10. 安全说明

- 内置 Node.js 从 nodejs.org 下载并**校验官方 SHA-256** 后才解压（见 `scripts/fetch-node.mjs`）。
- 控制台渲染进程 `sandbox: true` + `contextIsolation: true`，没有 Node、文件系统、shell，也没有任意 pnpm 参数入口；只暴露 `window.container` 上的一组固定方法，参数在主进程侧校验。
- Harness 窗口不注入任何特权 preload，导航与 `window.open` 一律交给系统浏览器。
- 监听地址固定 `127.0.0.1`，且 dsh 本身明确拒绝 `--host 0.0.0.0`。
- 一次性 token 与 `<redacted>`：日志、IPC 状态、错误信息都不含 token。
- 安装 dsh 会执行 npm 包的安装脚本（原生模块需要），这与官方 `npx @deepseek-ai/dsh` 行为一致——请只从官方 registry 安装。

---

## 11. 开发命令

```sh
npm run typecheck        # tsc --noEmit
npm run build            # esbuild 打包 main/preload + 拷贝 renderer/supervisor
npm start                # 构建并启动
npm run icons           # 从 build/icon-source.svg 重新生成平台图标
npm run prepare:app      # 准备 Node 运行时 + 内置 dsh seed
npm run smoke            # 端到端自检
npm run verify:crash     # 硬杀后的残留检查
npm run package:mac:arm64 / package:mac:x64 / package:win:x64
```

## 许可与第三方组件

本项目自身以 [MIT](LICENSE) 授权，Copyright (c) 2026 douzhenyu。

**发布出来的安装包内还包含第三方组件**，各自保留其原始许可（安装包内已随附对应的 LICENSE 文件，实测 macOS 包内含 161 份依赖许可 + Node.js 自身的 LICENSE）：

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`） | MIT | 容器管理的对象，未做任何修改 |
| [Node.js](https://nodejs.org/) 24.17.0 | MIT 及其附带的第三方许可 | 作为 harness 运行时随包分发 |
| npm 依赖树（519 个包） | 各自许可 | 由 `@deepseek-ai/dsh` 的生产依赖展开 |
| [Electron](https://www.electronjs.org/) | MIT | 外壳运行时 |
| DeepSeek 鲸鱼图标 | DeepSeek 商标资产 | 仅用于标识"运行 DeepSeek Harness"，见顶部非官方声明 |

本仓库**不包含**上述任何二进制：`resources/node/`、`resources/dsh-seed/`、`.build/` 均在 `.gitignore` 中，由 `npm run prepare:app` 在本地按需获取，或由 Releases 提供预构建产物。
