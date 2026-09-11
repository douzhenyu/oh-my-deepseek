/**
 * Console renderer.
 *
 * The renderer is a pure view over {@link ContainerState}: it holds no state of
 * its own beyond the last snapshot, every list is rebuilt from that snapshot,
 * and every string taken from the state is inserted with `textContent` so a
 * version string from the registry can never become markup.
 */

/** Console copy. The Harness UI owns its own language; this is only the container shell. */
const COPY = {
  en: {
    tagline: 'The harness runs inside this application. Closing it stops the backend.',
    backend: 'Backend',
    versions: 'Harness version',
    advanced: 'Advanced',
    log: 'Log',
    installed: 'Installed',
    published: 'Published',
    openHarness: 'Open Harness',
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    refresh: 'Check published versions',
    refreshBusy: 'Checking…',
    install: 'Install',
    use: 'Use',
    delete: 'Delete',
    openLogs: 'Open log folder',
    openData: 'Open data folder',
    copyLog: 'Copy log',
    running: 'Running version',
    pid: 'Process id',
    url: 'Address',
    home: 'Harness home',
    app: 'Container',
    homeHint: '/absolute/path to a harness home',
    homeShared: 'Share with the dsh command line',
    homeSeparate: 'Use an independent home',
    homeSharedNote: 'Sharing means one history and one set of credentials, but a conversation can only be open in one place at a time: dsh holds a write lock per session, so resuming one that the other dsh process has open fails with SessionAlreadyOwnedError. That is expected, not corruption.',
    homeSeparateNote: 'An independent home never contends with your command-line dsh. Credentials, settings, and skills are copied on first switch, so there is nothing to sign in again.',
    homeCustom: 'Use a custom path',
    saveHome: 'Save and restart',
    autoStart: 'Start the backend when the container opens',
    checkOnLaunch: 'Check for new harness versions on launch',
    bundled: 'bundled',
    installedBadge: 'installed',
    activeBadge: 'active',
    latest: 'Newest published',
    updateAvailable: (version) => `Version ${version} is available.`,
    upToDate: 'This is the newest published version.',
    noInstalled: 'No version installed yet.',
    noRemote: 'No published versions loaded yet.',
    unknown: '—',
    phase: {
      checking: 'Preparing…',
      installing: 'Installing…',
      starting: 'Starting backend…',
      ready: 'Running',
      error: 'Failed',
      stopped: 'Stopped',
    },
  },
  zh: {
    tagline: 'Harness 运行在本客户端内。关闭客户端会同时结束后台进程。',
    backend: '后台服务',
    versions: 'Harness 版本',
    advanced: '高级',
    log: '日志',
    installed: '已安装',
    published: '可安装',
    openHarness: '打开 Harness',
    start: '启动',
    stop: '停止',
    restart: '重启',
    refresh: '检查可用版本',
    refreshBusy: '检查中…',
    install: '安装',
    use: '使用',
    delete: '删除',
    openLogs: '打开日志目录',
    openData: '打开数据目录',
    copyLog: '复制日志',
    running: '运行版本',
    pid: '进程号',
    url: '地址',
    home: 'Harness 数据目录',
    app: '容器版本',
    homeHint: '/绝对路径',
    homeShared: '与命令行共用数据目录',
    homeSeparate: '使用独立数据目录',
    homeSharedNote: '共用意味着同一份历史与同一份凭据，但一个会话同一时刻只能在一个地方打开：dsh 对每个会话持有写锁，所以续写另一个 dsh 进程已打开的会话会报 SessionAlreadyOwnedError。这是预期行为，不是数据损坏。',
    homeSeparateNote: '独立数据目录不会与命令行的 dsh 冲突。首次切换会自动复制凭据、设置与技能，无需重新登录。',
    homeCustom: '使用自定义路径',
    saveHome: '保存并重启',
    autoStart: '打开容器时自动启动后台',
    checkOnLaunch: '启动时检查新的 Harness 版本',
    bundled: '内置',
    installedBadge: '已安装',
    activeBadge: '运行中',
    latest: '最新发布',
    updateAvailable: (version) => `可升级到 ${version}。`,
    upToDate: '当前已是最新发布版本。',
    noInstalled: '还没有安装任何版本。',
    noRemote: '尚未获取可安装版本列表。',
    unknown: '—',
    phase: {
      checking: '准备中…',
      installing: '安装中…',
      starting: '正在启动后台…',
      ready: '运行中',
      error: '启动失败',
      stopped: '已停止',
    },
  },
}

const t = navigator.language.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en

/** Look up an element the page is expected to contain. @param {string} id - Element id. */
const el = (id) => {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`console.html is missing #${id}`)
  return found
}

/** Build an element with optional text and class. */
const node = (tag, className, text) => {
  const created = document.createElement(tag)
  if (className) created.className = className
  if (text !== undefined) created.textContent = text
  return created
}

/** Run a bridge call, surfacing a rejection in the log line rather than swallowing it. */
const call = async (operation) => {
  try {
    await operation()
  } catch (error) {
    setTransient(String(error && error.message ? error.message : error))
  }
}

let transient = ''

/** Show a one-off message under the backend facts. @param {string} message - Text to show. */
const setTransient = (message) => {
  transient = message
  el('detail').textContent = message
}

/** Render one version row. */
const versionRow = (version, options) => {
  const row = node('li', 'row')
  const main = node('div', 'row-main')
  main.append(node('span', 'version', version))
  for (const badge of options.badges) main.append(node('span', `badge ${badge.kind ?? ''}`, badge.text))
  row.append(main)
  const actions = node('div', 'row-actions')
  for (const action of options.actions) {
    const button = node('button', action.kind ?? '', action.label)
    button.type = 'button'
    button.addEventListener('click', () => { void call(action.run) })
    actions.append(button)
  }
  row.append(actions)
  return row
}

/** Render the whole console from one snapshot. @param {object} state - Container state. */
const render = (state) => {
  document.title = `${state.productName} ${state.appVersion}`
  el('heading').textContent = state.productName
  el('tagline').textContent = t.tagline
  const status = el('status')
  status.textContent = t.phase[state.phase] ?? state.phase
  status.dataset.phase = state.phase

  el('backend-title').textContent = t.backend
  el('version-title').textContent = t.versions
  el('advanced-title').textContent = t.advanced
  el('log-title').textContent = t.log
  el('installed-title').textContent = t.installed
  el('published-title').textContent = t.published
  el('running-label').textContent = t.running
  el('home-label').textContent = t.home
  el('auto-start-label').textContent = t.autoStart
  el('check-on-launch-label').textContent = t.checkOnLaunch
  el('save-home').textContent = t.saveHome
  el('home-shared').textContent = t.homeShared
  el('home-separate').textContent = t.homeSeparate
  el('home-custom-label').textContent = t.homeCustom
  el('home-shared').disabled = state.harnessHomeMode === 'shared'
  el('home-separate').disabled = state.harnessHomeMode === 'separate'

  const ready = state.phase === 'ready'
  const busy = state.phase === 'installing' || state.phase === 'starting' || state.phase === 'checking'
  el('open-harness').textContent = t.openHarness
  el('open-harness').disabled = !ready
  el('start').textContent = t.start
  el('start').disabled = ready || busy
  el('stop').textContent = t.stop
  el('stop').disabled = !ready
  el('restart').textContent = t.restart
  el('restart').disabled = busy || state.activeVersion === undefined
  el('refresh').textContent = state.checkingRemote ? t.refreshBusy : t.refresh
  el('refresh').disabled = state.checkingRemote || busy
  el('open-logs').textContent = t.openLogs
  el('open-data').textContent = t.openData
  el('copy-log').textContent = t.copyLog

  el('running-value').textContent = state.activeVersion ?? t.unknown
  el('pid-value').textContent = state.backendPid === undefined ? t.unknown : String(state.backendPid)
  el('url-value').textContent = state.backendUrl ?? t.unknown
  el('home-value').textContent = state.dshHome
  const homeNote = el('home-note')
  homeNote.textContent = state.harnessHomeMode === 'shared' ? t.homeSharedNote : t.homeSeparateNote
  homeNote.className = state.harnessHomeMode === 'shared' ? 'note warn' : 'note'
  const homeInput = el('home-input')
  homeInput.placeholder = t.homeHint
  // Do not fight the user's cursor while they are typing a path.
  if (document.activeElement !== homeInput) homeInput.value = state.dshHomeOverride
  el('app-value').textContent = `${state.appVersion} · ${state.platform}`

  const detail = el('detail')
  detail.textContent = transient !== '' ? transient : (state.detail ?? (ready ? t.phase.ready : ''))

  const error = el('error')
  error.hidden = state.error === undefined
  error.textContent = state.error ?? ''

  el('progress').hidden = !busy

  const latest = el('latest')
  if (state.latestVersion === undefined) latest.textContent = ''
  else if (state.updateAvailable) latest.textContent = `${t.latest}: ${state.latestVersion} — ${t.updateAvailable(state.latestVersion)}`
  else latest.textContent = `${t.latest}: ${state.latestVersion} — ${t.upToDate}`

  const installedList = el('installed')
  installedList.replaceChildren()
  if (state.installed.length === 0) installedList.append(node('li', 'empty', t.noInstalled))
  for (const entry of state.installed) {
    const badges = []
    if (entry.source === 'bundled') badges.push({ text: t.bundled })
    if (state.activeVersion === entry.version) badges.push({ text: t.activeBadge, kind: 'ok' })
    const actions = []
    if (state.activeVersion !== entry.version || !ready) {
      actions.push({ label: t.use, kind: 'primary', run: () => window.container.activate(entry.version) })
    }
    if (entry.source === 'installed') {
      actions.push({ label: t.delete, kind: 'danger', run: () => window.container.remove(entry.version) })
    }
    installedList.append(versionRow(entry.version, { badges, actions }))
  }

  const remoteList = el('remote')
  remoteList.replaceChildren()
  if (state.remote.length === 0) remoteList.append(node('li', 'empty', t.noRemote))
  for (const entry of state.remote) {
    const isInstalled = state.installed.some((candidate) => candidate.version === entry.version)
    const badges = entry.tags.map((tag) => ({ text: tag, kind: 'tag' }))
    if (isInstalled) badges.push({ text: t.installedBadge })
    const actions = isInstalled ? [] : [{ label: t.install, kind: 'primary', run: () => window.container.install(entry.version) }]
    remoteList.append(versionRow(entry.version, { badges, actions }))
  }

  el('auto-start').checked = state.autoStart
  el('check-on-launch').checked = state.checkUpdatesOnLaunch

  const log = el('log')
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 24
  log.textContent = state.logs.join('\n')
  if (atBottom) log.scrollTop = log.scrollHeight
}

el('open-harness').addEventListener('click', () => { void call(() => window.container.openHarness()) })
el('start').addEventListener('click', () => { void call(() => window.container.start()) })
el('stop').addEventListener('click', () => { void call(() => window.container.stop()) })
el('restart').addEventListener('click', () => { void call(() => window.container.start()) })
el('refresh').addEventListener('click', () => { void call(() => window.container.refreshRemote()) })
el('open-logs').addEventListener('click', () => { void call(() => window.container.reveal('logs')) })
el('open-data').addEventListener('click', () => { void call(() => window.container.reveal('data')) })
el('copy-log').addEventListener('click', () => {
  void call(async () => {
    const state = await window.container.snapshot()
    await navigator.clipboard.writeText(state.logs.join('\n'))
    setTransient('log copied')
  })
})
el('home-shared').addEventListener('click', () => { void call(() => window.container.setHarnessHome('shared')) })
el('home-separate').addEventListener('click', () => { void call(() => window.container.setHarnessHome('separate')) })
el('save-home').addEventListener('click', () => {
  void call(async () => {
    await window.container.updateSettings({ dshHome: el('home-input').value.trim() })
    await window.container.start()
  })
})
el('auto-start').addEventListener('change', (event) => {
  void call(() => window.container.updateSettings({ autoStart: event.target.checked }))
})
el('check-on-launch').addEventListener('change', (event) => {
  void call(() => window.container.updateSettings({ checkUpdatesOnLaunch: event.target.checked }))
})

window.container.subscribe(render)
void window.container.snapshot().then((state) => {
  render(state)
  document.documentElement.dataset.consoleReady = 'true'
})
