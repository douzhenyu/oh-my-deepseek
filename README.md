# Oh My DeepSeek 🐳

DeepSeek Harness 的 macOS 桌面客户端 —— 把本地运行的 [DeepSeek Harness](http://127.0.0.1:3080) 装进一个原生的 macOS 应用窗口。

> 正在跑 DeepSeek Harness？给它配个原生桌面壳：独立窗口、Dock 图标、主题联动、性能调优，开箱即用。
>
> ⚠️ 本项目是 **DeepSeek Harness 的第三方桌面外壳**，与 DeepSeek 官方无关联。

## ✨ 功能特性

- **原生桌面体验**：独立窗口 + Dock 图标 + 原生 macOS 菜单（复制/粘贴、缩放、全屏、⌘Q）
- **一键启动后端**：启动客户端时自动拉起 DeepSeek Harness 后端（无命令行窗口）；彻底退出客户端（⌘Q）时自动关闭**由客户端启动的**后端——你手动启动的后端不会被碰
- **启动等待界面**：后端启动期间显示转圈等待页（带计时），启动失败时给出明确错误提示
- **主题三模式联动**：网页切深色 / 浅色 / 跟随系统，原生窗口标题栏实时同步；「跟随系统」模式下窗口框架与 macOS 系统外观实时联动（修复了强制 `themeSource` 导致跟随系统失效的 bug）
- **性能调优**：CDP 时间线剖析定位到「V8 GC 停世界停顿」是卡顿根因，用 `--no-compact` 等调优把 100-150ms 的冻结降为 0（实测数据见下）
- **自动重连**：后端未启动时每 3 秒自动重连，先开后端后开 App 也能自动连上
- **外链安全**：搜索结果、引用等外部链接自动用系统默认浏览器打开
- **单实例运行**：重复打开只聚焦已有窗口
- **干净标题栏**：固定显示 `Oh My DeepSeek`，不带会话名前缀
- **自绘 App 图标**：纯 Node 脚本生成（深蓝渐变 + 火花点），无第三方依赖

## 🚀 快速开始

前置：本机已安装 DeepSeek Harness（`dsh`）。**无需手动启动后端**——客户端会自动拉起。

### 本地构建

```bash
git clone git@github.com:douzhenyu/oh-my-deepseek.git
cd oh-my-deepseek
npm install
npm run generate-icon   # 生成 App 图标（build/icon.icns）
npm run dist            # 打包 .app/.dmg 到 dist/
open dist/mac-arm64/Oh\ My\ DeepSeek.app
```

### 后端自动启动

启动客户端时：

1. 检测 `http://127.0.0.1:3080` 是否已有后端在运行——有则直接连接（不会重复启动，也不会在退出时关闭它）
2. 没有则自动用 `dsh --profile web --port 3080` 无窗口启动（不弹命令行窗口），显示等待界面，就绪后进入主界面
3. 彻底退出客户端（⌘Q）时，自动关闭由客户端启动的后端进程

后端命令解析优先级：

1. 环境变量 `DEEPSEEK_BACKEND_CMD`（例如 `DEEPSEEK_BACKEND_CMD="node /path/to/dsh/lib/bin.js"`）
2. 已知的 npx 缓存路径
3. 扫描 `~/.npm/_npx/*/node_modules/@deepseek-ai/dsh/` 取最新副本（适配 harness 升级）
4. `PATH` 中的 `dsh`（全局安装时）

### 开发模式

```bash
npm install
npm start               # 直接以开发模式加载 http://127.0.0.1:3080
```

> 可用环境变量 `DEEPSEEK_URL` 指向其他后端地址，例如 `DEEPSEEK_URL=https://your-host npm start`。

### 首次打开未签名 App

右键 App →「打开」，或执行：

```bash
xattr -dr com.apple.quarantine /path/to/Oh\ My\ DeepSeek.app
```

## 🧰 打包与发布

```bash
npm run generate-icon   # 生成图标（首次或改图标后）
npm run pack            # 仅打包 .app（dist/mac-arm64/Oh My DeepSeek.app）
npm run dist            # 打包 .app + .dmg + .zip
```

产物：

- `dist/mac-arm64/Oh My DeepSeek.app`
- `dist/Oh My DeepSeek-1.3.0-arm64.dmg`

> 本机自用无需签名；若需对外发布，请配置 Apple Developer 签名与公证后移除 `package.json` 中 `build.mac.identity: null`。

## ⚡ 性能调优：为什么滚动不卡了

通过 CDP Tracing 实测定位：网页在轨迹表、插件清单、长消息列表等重视图里**分配内存极快**，触发频繁的 V8 全量 GC，每次**停世界停顿 100-150ms** —— 表现为「首开卡一下」「滚动偶发卡顿」。渲染 / 合成 / GPU 本身全部健康。

优化配置（`src/main.ts`）：

| 配置 | 作用 |
|---|---|
| `--js-flags=--no-compact` | 跳过 major GC 最贵的搬移（evacuate）阶段，停世界停顿 ≈ 0 |
| `--js-flags=--max-semi-space-size=64` | 增大新生代，减少 minor GC 频率 |
| `backgroundThrottling: false` | 窗口被遮挡 / 失焦时不节流渲染，消除焦点切换顿挫 |

实测对比（同一脚本：轨迹页首开 + 25 次滚动）：

| 指标 | 优化前 | 优化后 |
|---|---|---|
| V8 GC 总耗时 | 1960ms | **9ms** |
| 停世界 MajorGC | 1 次 / 149ms | **0 次** |
| 滚轮事件最大延迟 | 35433ms | **14ms** |
| 轨迹视图内存 | 117MB→66MB 抖动 | 64MB 稳定 |

> 注意：`--no-compact` 会牺牲少量堆内存（不压缩碎片），实测内存占用不升反降；若遇到内存异常增长，删除 `src/main.ts` 中的 `--no-compact` 即可回退。

## 🎨 主题同步原理

客户端与 harness 之间只有 **三个可观察契约**（不调用任何内部 API）：

| 契约 | 说明 |
|---|---|
| Web GUI 地址 | `http://127.0.0.1:3080` |
| 主题 DOM 信号 | `body[data-ds-dark-theme]` + `documentElement.style.colorScheme` |
| 设置 API | `POST /api/settings.describe`（RPC 信封）的 `ui-theme.preference` 字段 |

`src/preload.ts` 监听 DOM 信号变化，并通过主进程的 settings API 读取用户偏好（`dark` / `light` / `system`），上报后由主进程设置 `nativeTheme.themeSource`。偏好为 `system` 时**保持 `themeSource = 'system'`**——这样页面里的 `prefers-color-scheme` 始终反映真实系统外观，窗口框架与系统实时联动（这是修复「跟随系统不联动」的关键）。

## 🔧 上游适配（harness 更新后）

harness 升级后跑一次自检，几秒就知道哪些契约变了、改哪里：

```bash
npm run check-compat
```

输出 PASS / WARN / FAIL，每条 FAIL 都标注对应修复位置（`src/preload.ts` / `src/main.ts` 的具体函数）。即使 DOM 信号全部改变，`readTheme()` 还有「背景亮度回退检测」兜底——只要页面深浅背景色不同就能识别。

## 📁 项目结构

```
oh-my-deepseek/
├── src/                          # TypeScript 源码
│   ├── main.ts                   # Electron 主进程：窗口、菜单、后端自动启动/清理、主题/性能调优、settings API
│   ├── preload.ts                # 沙箱 preload：DOM 主题信号检测 + 偏好上报（IPC）
│   └── scripts/
│       ├── generate-icon.ts      # 自绘 App 图标（纯 Node，零依赖）
│       └── check-harness-compat.ts # harness 上游契约自检
├── out/                          # tsc 编译产物（构建时生成，不提交）
├── loading.html                  # 后端启动等待/错误界面
├── scripts/make-icns.sh          # PNG → .icns（sips + iconutil）
├── build/                        # 生成的应用图标（icon.icns / icon_1024.png）
├── tsconfig.json                 # TypeScript 严格模式配置
└── package.json                  # electron-builder 打包配置
```

构建流程：`tsc`（`src/` → `out/`）→ electron-builder 打包 `out/` + `loading.html`。

## 🛠 技术栈

- [Electron](https://www.electronjs.org/) 43（Chromium 150）
- [electron-builder](https://www.electron.build/) 26
- [TypeScript](https://www.typescriptlang.org/) 5（strict 模式）
- V8 标志调优、CDP Tracing 性能剖析

## 📄 License

[MIT](./LICENSE)
