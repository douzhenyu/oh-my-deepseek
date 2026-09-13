/**
 * Shell copy in the application's language.
 *
 * The console and native dialogs use the same strings. Only the shell is
 * translated: the Harness UI carries its own language setting.
 * @module main/locale
 */

import { app } from 'electron'

/** Every localized string the container shell shows. */
interface Strings {
  /** Window and dialog product suffix. */
  consoleTitle: string
  /** Secondary heading line. */
  tagline: string
  /** Backend status section title. */
  backendSection: string
  /** Harness version section title. */
  versionSection: string
  /** Advanced section title. */
  advancedSection: string
  /** Log section title. */
  logSection: string
  /** Button: open the Harness window. */
  openHarness: string
  /** Button: start the backend. */
  start: string
  /** Button: stop the backend. */
  stop: string
  /** Button: restart the backend. */
  restart: string
  /** Button: refresh the published version list. */
  refresh: string
  /** Button: install a version. */
  install: string
  /** Button: activate a version. */
  activate: string
  /** Button: delete an installed version. */
  uninstall: string
  /** Button: open the log directory. */
  openLogs: string
  /** Button: open the data directory. */
  openData: string
  /** Button: copy the container log to the clipboard. */
  copyLog: string
  /** Label: currently running version. */
  running: string
  /** Label: version shipped inside the application. */
  bundled: string
  /** Label: version installed by the user. */
  installedLabel: string
  /** Label: latest published version. */
  latest: string
  /** Label: upgrade available. */
  upgradeAvailable: string
  /** Label: no upgrade available. */
  upToDate: string
  /** Progress text while a profile plugin is being installed or updated. */
  pluginInstalling: string
  /** Progress text while a profile plugin is being removed. */
  pluginRemoving: string
  /** Label: harness home directory. */
  dshHome: string
  /** Value shown when the harness home is the product default. */
  defaultHome: string
  /** Label: settings toggles. */
  autoStart: string
  /** Label: check for new versions on launch. */
  checkOnLaunch: string
  /** Label: notify when a conversation finishes. */
  notifyOnTurnEnd: string
  /** Body of the notification raised when a conversation finishes. */
  turnComplete: string
  /** Body of an on-demand test notification. */
  turnCompleteTest: string
  /** Status text per lifecycle phase. */
  phase: Record<string, string>
  /** Native menu labels. */
  menu: {
    console: string
    openHarness: string
    restartBackend: string
    stopBackend: string
    checkVersions: string
    openLogs: string
    harnessMenu: string
    editMenu: string
    viewMenu: string
    windowMenu: string
    helpMenu: string
    documentation: string
  }
}

const en: Strings = {
  consoleTitle: 'Console',
  tagline: 'The harness runs inside this application. Closing it stops the backend.',
  backendSection: 'Backend',
  versionSection: 'Harness version',
  advancedSection: 'Advanced',
  logSection: 'Log',
  openHarness: 'Open Harness',
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  refresh: 'Check published versions',
  install: 'Install',
  activate: 'Use',
  uninstall: 'Delete',
  openLogs: 'Open log folder',
  openData: 'Open data folder',
  copyLog: 'Copy log',
  running: 'Running',
  bundled: 'bundled',
  installedLabel: 'installed',
  latest: 'latest',
  upgradeAvailable: 'Update available',
  upToDate: 'Up to date',
  pluginInstalling: 'Installing plugin…',
  pluginRemoving: 'Removing plugin…',
  dshHome: 'Harness home',
  defaultHome: 'Default (DSH_HOME or ~/.dsh)',
  autoStart: 'Start the backend when the container opens',
  checkOnLaunch: 'Check for new harness versions on launch',
  notifyOnTurnEnd: 'Notify me when a conversation finishes',
  turnComplete: 'The reply is ready.',
  turnCompleteTest: 'Test notification — if you can see this, notifications work.',
  phase: {
    checking: 'Preparing…',
    installing: 'Installing…',
    starting: 'Starting the backend…',
    ready: 'Running',
    error: 'Failed',
    stopped: 'Stopped',
  },
  menu: {
    console: 'Console',
    openHarness: 'Open Harness',
    restartBackend: 'Restart Backend',
    stopBackend: 'Stop Backend',
    checkVersions: 'Check Harness Versions',
    openLogs: 'Open Log Folder',
    harnessMenu: 'Harness',
    editMenu: 'Edit',
    viewMenu: 'View',
    windowMenu: 'Window',
    helpMenu: 'Help',
    documentation: 'DeepSeek Harness Documentation',
  },
}

const zh: Strings = {
  consoleTitle: '控制台',
  tagline: 'Harness 运行在本客户端内。关闭客户端会同时结束后台进程。',
  backendSection: '后台服务',
  versionSection: 'Harness 版本',
  advancedSection: '高级',
  logSection: '日志',
  openHarness: '打开 Harness',
  start: '启动',
  stop: '停止',
  restart: '重启',
  refresh: '检查可用版本',
  install: '安装',
  activate: '使用',
  uninstall: '删除',
  openLogs: '打开日志目录',
  openData: '打开数据目录',
  copyLog: '复制日志',
  running: '运行中',
  bundled: '内置',
  installedLabel: '已安装',
  latest: '最新',
  upgradeAvailable: '有新版本可用',
  upToDate: '已是最新',
  pluginInstalling: '正在安装插件…',
  pluginRemoving: '正在卸载插件…',
  dshHome: 'Harness 数据目录',
  defaultHome: '默认（DSH_HOME 或 ~/.dsh）',
  autoStart: '打开容器时自动启动后台',
  checkOnLaunch: '启动时检查新的 Harness 版本',
  notifyOnTurnEnd: '对话完成后发送系统通知',
  turnComplete: '回复已完成。',
  turnCompleteTest: '这是一条测试通知——能看到就说明通知正常。',
  phase: {
    checking: '准备中…',
    installing: '安装中…',
    starting: '正在启动后台…',
    ready: '运行中',
    error: '启动失败',
    stopped: '已停止',
  },
  menu: {
    console: '控制台',
    openHarness: '打开 Harness',
    restartBackend: '重启后台服务',
    stopBackend: '停止后台服务',
    checkVersions: '检查 Harness 版本',
    openLogs: '打开日志目录',
    harnessMenu: 'Harness',
    editMenu: '编辑',
    viewMenu: '视图',
    windowMenu: '窗口',
    helpMenu: '帮助',
    documentation: 'DeepSeek Harness 文档',
  },
}

let cached: Strings | undefined

/**
 * Localized shell copy for the current application locale.
 * @returns Chinese for a Chinese locale, English otherwise.
 */
export const strings = (): Strings => {
  if (cached === undefined) cached = app.getLocale().toLowerCase().startsWith('zh') ? zh : en
  return cached
}
