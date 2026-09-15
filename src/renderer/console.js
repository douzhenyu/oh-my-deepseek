/**
 * Console renderer.
 *
 * Lifecycle controls are a view over {@link ContainerState}; the plugin market
 * keeps only local filters and its on-demand market snapshot. Every external
 * string is inserted with `textContent`, never as markup.
 */

/** Console copy. The Harness UI owns its own language; this is only the container shell. */
const COPY = {
  en: {
    tagline: 'The harness runs inside this application. Closing it stops the backend.',
    backend: 'Backend',
    client: 'Client',
    clientCurrent: 'Installed',
    clientLatest: 'Latest',
    clientCheck: 'Check for updates',
    clientChecking: 'Checking…',
    clientDownload: 'Download update',
    clientDownloading: 'Downloading…',
    clientInstall: 'Install and restart',
    clientOpen: 'Open the disk image',
    clientReveal: 'Show the file',
    clientPage: 'Release notes',
    clientUpToDate: 'You are running the newest release.',
    clientAvailable: (version) => `Version ${version} is available.`,
    clientUnknown: 'Not checked yet.',
    clientManual: 'This build is unsigned, so macOS will not let the client replace itself. The update downloads, then you drag the app onto Applications — your sessions and settings stay in place.',
    clientInstaller: 'The installer runs and the client quits so it can replace itself.',
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
    checkClientOnLaunch: 'Check for a new client version on launch',
    notifyOnTurnEnd: 'Notify me when a conversation finishes',
    testNotification: 'Send a test',
    testSent: 'Test notification sent.',
    testUnsupported: 'This system does not support notifications.',
    bundled: 'bundled',
    installedBadge: 'installed',
    activeBadge: 'active',
    latest: 'Newest published',
    updateAvailable: (version) => `Version ${version} is available.`,
    upToDate: 'This is the newest published version.',
    noInstalled: 'No version installed yet.',
    noRemote: 'No published versions loaded yet.',
    unknown: '—',
    overviewTab: 'Overview',
    pluginsTab: 'Plugin market',
    marketTitle: 'Plugin market',
    marketSubtitle: 'Browse and manage community plugins for the active Harness profile. Changes restart Harness automatically.',
    marketInstalled: 'installed',
    marketUpdates: 'updates',
    marketSearch: 'Search plugins, authors, or descriptions',
    marketScopeAll: 'All plugins',
    marketScopeInstalled: 'Installed',
    marketScopeUpdates: 'Updates',
    marketCategoryAll: 'All categories',
    marketSortStars: 'Most starred',
    marketSortDownloads: 'Most downloaded',
    marketSortNewest: 'Newest',
    marketSortName: 'Name',
    marketRefresh: 'Refresh catalog',
    marketRefreshing: 'Loading catalog…',
    marketReady: (shown, total) => `${shown} of ${total} matching plugins`,
    marketEmpty: 'No plugins match these filters.',
    marketLoadMore: (count) => `Show ${count} more`,
    marketInstall: 'Install',
    marketRepair: 'Repair',
    marketUpdate: 'Update',
    marketRemove: 'Remove',
    marketDetails: 'Details',
    marketInstalledVersion: (version) => `Installed ${version}`,
    marketDeclaredVersion: (version) => `Declared ${version} · files missing`,
    marketNeedsRepair: 'needs repair',
    marketLatestVersion: (version) => `Latest ${version}`,
    marketConfirmRemove: (name) => `Remove ${name} from this Harness profile?`,
    marketWorking: 'Applying the plugin change and restarting Harness…',
    marketNoCatalog: 'Open the market to load the community catalog.',
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
    client: '客户端',
    clientCurrent: '当前版本',
    clientLatest: '最新版本',
    clientCheck: '检查客户端更新',
    clientChecking: '检查中…',
    clientDownload: '下载更新',
    clientDownloading: '下载中…',
    clientInstall: '安装并重启',
    clientOpen: '打开安装镜像',
    clientReveal: '打开所在文件夹',
    clientPage: '发布说明',
    clientUpToDate: '当前已是最新发布的客户端版本。',
    clientAvailable: (version) => `可更新到 ${version}。`,
    clientUnknown: '尚未检查。',
    clientManual: '当前构建未签名，macOS 不允许客户端自行替换自己。下载完成后把 App 拖进「应用程序」即可——会话与设置都会保留。',
    clientInstaller: '将运行安装程序并退出客户端，以便它替换自身。',
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
    checkClientOnLaunch: '启动时检查新的客户端版本',
    notifyOnTurnEnd: '对话完成后发送系统通知',
    testNotification: '发送测试',
    testSent: '测试通知已发送。',
    testUnsupported: '当前系统不支持通知。',
    bundled: '内置',
    installedBadge: '已安装',
    activeBadge: '运行中',
    latest: '最新发布',
    updateAvailable: (version) => `可升级到 ${version}。`,
    upToDate: '当前已是最新发布版本。',
    noInstalled: '还没有安装任何版本。',
    noRemote: '尚未获取可安装版本列表。',
    unknown: '—',
    overviewTab: '运行管理',
    pluginsTab: '插件市场',
    marketTitle: '插件市场',
    marketSubtitle: '浏览并管理当前 Harness 配置中的社区插件。安装、更新或卸载后会自动重启 Harness。',
    marketInstalled: '已安装',
    marketUpdates: '可更新',
    marketSearch: '搜索插件、作者或功能描述',
    marketScopeAll: '全部插件',
    marketScopeInstalled: '已安装',
    marketScopeUpdates: '可更新',
    marketCategoryAll: '全部分类',
    marketSortStars: '最多收藏',
    marketSortDownloads: '最多下载',
    marketSortNewest: '最近收录',
    marketSortName: '名称',
    marketRefresh: '刷新目录',
    marketRefreshing: '正在加载插件目录…',
    marketReady: (shown, total) => `匹配 ${total} 个插件，当前显示 ${shown} 个`,
    marketEmpty: '没有符合当前筛选条件的插件。',
    marketLoadMore: (count) => `再显示 ${count} 个`,
    marketInstall: '安装',
    marketRepair: '修复',
    marketUpdate: '更新',
    marketRemove: '卸载',
    marketDetails: '详情',
    marketInstalledVersion: (version) => `已安装 ${version}`,
    marketDeclaredVersion: (version) => `声明版本 ${version} · 文件缺失`,
    marketNeedsRepair: '需要修复',
    marketLatestVersion: (version) => `最新版 ${version}`,
    marketConfirmRemove: (name) => `确定从当前 Harness 配置中卸载 ${name} 吗？`,
    marketWorking: '正在应用插件变更并重启 Harness…',
    marketNoCatalog: '打开插件市场后会加载社区插件目录。',
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

let marketState = { catalogLoaded: false, categories: [], plugins: [], installedCount: 0, updateCount: 0 }
let marketLoading = false
let marketBusyId = ''
let marketError = ''
let marketVisibleLimit = 60

const marketLocale = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
const compactNumber = new Intl.NumberFormat(marketLocale === 'zh' ? 'zh-CN' : 'en', { notation: 'compact', maximumFractionDigits: 1 })

/** Replace a select's options without losing its current valid choice. */
const setOptions = (select, options) => {
  const selected = select.value
  select.replaceChildren(...options.map((option) => {
    const element = node('option', '', option.label)
    element.value = option.value
    return element
  }))
  if (options.some((option) => option.value === selected)) select.value = selected
}

/** Current market rows after search, scope, category, and sort. */
const filteredMarketPlugins = () => {
  const query = el('market-search').value.trim().toLocaleLowerCase()
  const scope = el('market-scope').value
  const category = el('market-category').value
  const sort = el('market-sort').value
  const filtered = marketState.plugins.filter((plugin) => {
    if (scope === 'installed' && plugin.installedPackage === undefined) return false
    if (scope === 'updates' && !plugin.updateAvailable) return false
    if (category !== 'all' && !plugin.categories.includes(category)) return false
    if (query === '') return true
    return [plugin.name, plugin.owner, plugin.description.en, plugin.description.zh]
      .some((value) => value.toLocaleLowerCase().includes(query))
  })
  const compareNumber = (field) => (left, right) => (right[field] ?? -1) - (left[field] ?? -1)
  if (sort === 'downloads') filtered.sort(compareNumber('downloads'))
  else if (sort === 'newest') filtered.sort((left, right) => (right.added ?? '').localeCompare(left.added ?? ''))
  else if (sort === 'name') filtered.sort((left, right) => left.name.localeCompare(right.name))
  else filtered.sort(compareNumber('stars'))
  return filtered
}

/** Install, update, or remove one plugin and surface failures inside the market. */
const mutateMarket = async (plugin, action) => {
  if (action === 'remove' && !window.confirm(t.marketConfirmRemove(plugin.name))) return
  marketBusyId = plugin.id
  marketError = ''
  renderMarket()
  try {
    marketState = action === 'remove'
      ? await window.container.removePlugin(plugin.id)
      : await window.container.installPlugin(plugin.id)
  } catch (error) {
    marketError = String(error && error.message ? error.message : error)
    try {
      marketState = await window.container.pluginMarketSnapshot()
    } catch {
      // Keep the last usable catalog when even the follow-up snapshot fails.
    }
  } finally {
    marketBusyId = ''
    renderMarket()
  }
}

/** Build one native market row. */
const marketRow = (plugin) => {
  const article = node('article', 'plugin-row')
  const content = node('div', 'plugin-content')
  const heading = node('div', 'plugin-heading')
  heading.append(node('h3', 'plugin-name', plugin.name))
  if (plugin.repairRequired) heading.append(node('span', 'badge tag', t.marketNeedsRepair))
  else if (plugin.updateAvailable) heading.append(node('span', 'badge tag', t.marketUpdates))
  else if (plugin.installedPackage !== undefined) heading.append(node('span', 'badge ok', t.marketInstalled))
  content.append(heading)
  content.append(node('p', 'plugin-description', plugin.description[marketLocale] || plugin.description.en || plugin.description.zh))
  const metadata = node('div', 'plugin-meta')
  if (plugin.owner !== '') metadata.append(node('span', '', `@${plugin.owner}`))
  if (plugin.stars !== undefined) metadata.append(node('span', '', `★ ${compactNumber.format(plugin.stars)}`))
  if (plugin.downloads !== undefined) metadata.append(node('span', '', `↓ ${compactNumber.format(plugin.downloads)}`))
  if (plugin.installedVersion !== undefined) {
    metadata.append(node(
      'span',
      'installed-version',
      plugin.repairRequired ? t.marketDeclaredVersion(plugin.installedVersion) : t.marketInstalledVersion(plugin.installedVersion),
    ))
  }
  else if (plugin.version !== undefined) metadata.append(node('span', '', t.marketLatestVersion(plugin.version)))
  content.append(metadata)
  article.append(content)

  const actions = node('div', 'plugin-actions')
  if (plugin.catalogued) {
    const details = node('button', '', t.marketDetails)
    details.type = 'button'
    details.addEventListener('click', () => {
      void window.container.openPluginPage(plugin.id).catch((error) => {
        marketError = String(error && error.message ? error.message : error)
        renderMarket()
      })
    })
    actions.append(details)
  }
  const busy = marketBusyId !== ''
  if (plugin.installedPackage === undefined) {
    const install = node('button', 'primary', marketBusyId === plugin.id ? '…' : t.marketInstall)
    install.type = 'button'
    install.disabled = busy
    install.addEventListener('click', () => { void mutateMarket(plugin, 'install') })
    actions.append(install)
  } else {
    if (plugin.repairRequired || plugin.updateAvailable) {
      const label = plugin.repairRequired ? t.marketRepair : t.marketUpdate
      const update = node('button', 'primary', marketBusyId === plugin.id ? '…' : label)
      update.type = 'button'
      update.disabled = busy
      update.addEventListener('click', () => { void mutateMarket(plugin, 'install') })
      actions.append(update)
    }
    const remove = node('button', 'danger', marketBusyId === plugin.id ? '…' : t.marketRemove)
    remove.type = 'button'
    remove.disabled = busy
    remove.addEventListener('click', () => { void mutateMarket(plugin, 'remove') })
    actions.append(remove)
  }
  article.append(actions)
  return article
}

/** Render the market from its independent, on-demand IPC snapshot. */
const renderMarket = () => {
  setOptions(el('market-scope'), [
    { value: 'all', label: t.marketScopeAll },
    { value: 'installed', label: t.marketScopeInstalled },
    { value: 'updates', label: t.marketScopeUpdates },
  ])
  setOptions(el('market-category'), [
    { value: 'all', label: t.marketCategoryAll },
    ...marketState.categories.map((category) => ({ value: category.id, label: category[marketLocale] ?? category.en })),
  ])
  setOptions(el('market-sort'), [
    { value: 'stars', label: t.marketSortStars },
    { value: 'downloads', label: t.marketSortDownloads },
    { value: 'newest', label: t.marketSortNewest },
    { value: 'name', label: t.marketSortName },
  ])
  el('market-installed-count').textContent = String(marketState.installedCount)
  el('market-update-count').textContent = String(marketState.updateCount)
  const error = el('market-error')
  error.hidden = marketError === ''
  error.textContent = marketError
  el('market-refresh').textContent = marketLoading ? t.marketRefreshing : t.marketRefresh
  el('market-refresh').disabled = marketLoading || marketBusyId !== ''

  const plugins = filteredMarketPlugins()
  const visible = plugins.slice(0, marketVisibleLimit)
  const list = el('market-list')
  list.replaceChildren(...visible.map(marketRow))
  if (marketLoading && marketState.plugins.length === 0) list.append(node('div', 'market-empty', t.marketRefreshing))
  else if (!marketLoading && visible.length === 0) list.append(node('div', 'market-empty', t.marketEmpty))

  const status = el('market-status')
  if (marketBusyId !== '') status.textContent = t.marketWorking
  else if (marketLoading) status.textContent = t.marketRefreshing
  else if (!marketState.catalogLoaded) status.textContent = t.marketNoCatalog
  else status.textContent = t.marketReady(visible.length, plugins.length)

  const more = el('market-more')
  const remaining = plugins.length - visible.length
  more.hidden = remaining <= 0
  more.textContent = t.marketLoadMore(Math.min(60, remaining))
}

/** Read installed state, optionally followed by a fresh catalog fetch. */
const loadMarket = async (refresh) => {
  marketLoading = true
  marketError = ''
  renderMarket()
  try {
    marketState = refresh
      ? await window.container.refreshPluginMarket()
      : await window.container.pluginMarketSnapshot()
    if (!refresh && !marketState.catalogLoaded) marketState = await window.container.refreshPluginMarket()
  } catch (error) {
    marketError = String(error && error.message ? error.message : error)
  } finally {
    marketLoading = false
    renderMarket()
  }
}

/** Swap between the lifecycle console and the native plugin market. */
const showPanel = (name) => {
  const market = name === 'plugins'
  el('overview-panel').hidden = market
  el('plugins-panel').hidden = !market
  el('overview-tab').classList.toggle('active', !market)
  el('plugins-tab').classList.toggle('active', market)
  el('overview-tab').setAttribute('aria-selected', String(!market))
  el('plugins-tab').setAttribute('aria-selected', String(market))
  if (market) void loadMarket(false)
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
  el('overview-tab').textContent = t.overviewTab
  el('plugins-tab').textContent = t.pluginsTab
  const status = el('status')
  status.textContent = t.phase[state.phase] ?? state.phase
  status.dataset.phase = state.phase

  el('backend-title').textContent = t.backend
  el('client-title').textContent = t.client
  el('client-current-label').textContent = t.clientCurrent
  el('client-latest-label').textContent = t.clientLatest
  el('version-title').textContent = t.versions
  el('advanced-title').textContent = t.advanced
  el('log-title').textContent = t.log
  el('installed-title').textContent = t.installed
  el('published-title').textContent = t.published
  el('running-label').textContent = t.running
  el('home-label').textContent = t.home
  el('auto-start-label').textContent = t.autoStart
  el('check-on-launch-label').textContent = t.checkOnLaunch
  el('check-client-on-launch-label').textContent = t.checkClientOnLaunch
  el('check-client-on-launch').checked = state.checkClientUpdatesOnLaunch
  el('notify-on-turn-end-label').textContent = t.notifyOnTurnEnd
  el('test-notification').textContent = t.testNotification
  el('notify-on-turn-end').checked = state.notifyOnTurnEnd
  el('save-home').textContent = t.saveHome
  el('home-shared').textContent = t.homeShared
  el('home-separate').textContent = t.homeSeparate
  el('home-custom-label').textContent = t.homeCustom
  el('home-shared').disabled = state.harnessHomeMode === 'shared'
  el('home-separate').disabled = state.harnessHomeMode === 'separate'

  const client = state.client
  el('client-current-value').textContent = client.currentVersion
  el('client-latest-value').textContent = client.latest?.version ?? t.unknown
  el('client-check').textContent = client.checking ? t.clientChecking : t.clientCheck
  el('client-check').disabled = client.checking || client.downloading
  const canDownload = client.available && client.downloadedPath === undefined && !client.downloading
  el('client-download').textContent = client.downloading ? t.clientDownloading : t.clientDownload
  el('client-download').disabled = !canDownload
  el('client-download').hidden = client.available === false
  el('client-install').textContent = client.installMode === 'installer' ? t.clientInstall : t.clientOpen
  el('client-install').hidden = client.downloadedPath === undefined
  el('client-install').disabled = client.downloadedPath === undefined
  el('client-reveal').textContent = t.clientReveal
  el('client-reveal').hidden = client.downloadedPath === undefined
  el('client-page').textContent = t.clientPage
  el('client-page').hidden = client.latest === undefined
  // The note describes the state; a failure is reported by the error block below
  // rather than by replacing the explanation of what this platform can do.
  const clientNote = el('client-note')
  const platformHint = client.installMode === 'manual' ? t.clientManual : t.clientInstaller
  if (client.available) clientNote.textContent = `${t.clientAvailable(client.latest?.version ?? '')} ${platformHint}`
  else if (client.latest === undefined) clientNote.textContent = t.clientUnknown
  else clientNote.textContent = t.clientUpToDate
  if (client.downloadedPath !== undefined) clientNote.textContent = `${clientNote.textContent} ${platformHint}`
  const clientProgress = el('client-progress')
  clientProgress.hidden = !client.downloading
  const fill = clientProgress.firstElementChild
  if (fill !== null) fill.style.width = client.progress === undefined ? '35%' : `${Math.round(client.progress * 100)}%`
  const clientError = el('client-error')
  clientError.hidden = client.error === undefined
  clientError.textContent = client.error ?? ''

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
    if (entry.source === 'installed' || state.activeVersion !== entry.version) {
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

el('market-title').textContent = t.marketTitle
el('market-subtitle').textContent = t.marketSubtitle
el('market-installed-label').textContent = t.marketInstalled
el('market-update-label').textContent = t.marketUpdates
el('market-search').placeholder = t.marketSearch
el('overview-tab').addEventListener('click', () => { showPanel('overview') })
el('plugins-tab').addEventListener('click', () => { showPanel('plugins') })
el('market-search').addEventListener('input', () => { marketVisibleLimit = 60; renderMarket() })
for (const id of ['market-scope', 'market-category', 'market-sort']) {
  el(id).addEventListener('change', () => { marketVisibleLimit = 60; renderMarket() })
}
el('market-refresh').addEventListener('click', () => { void loadMarket(true) })
el('market-more').addEventListener('click', () => { marketVisibleLimit += 60; renderMarket() })

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
el('client-check').addEventListener('click', () => { void call(() => window.container.checkClientUpdate()) })
el('client-download').addEventListener('click', () => { void call(() => window.container.downloadClientUpdate()) })
el('client-install').addEventListener('click', () => { void call(() => window.container.installClientUpdate()) })
el('client-reveal').addEventListener('click', () => { void call(() => window.container.revealClientUpdate()) })
el('client-page').addEventListener('click', () => { void call(() => window.container.openClientRelease()) })
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
el('check-client-on-launch').addEventListener('change', (event) => {
  void call(() => window.container.updateSettings({ checkClientUpdatesOnLaunch: event.target.checked }))
})
el('test-notification').addEventListener('click', (event) => {
  // The button sits inside the toggle's label, so the click must not flip the setting.
  event.preventDefault()
  void call(async () => {
    const shown = await window.container.testNotification()
    setTransient(shown ? t.testSent : t.testUnsupported)
  })
})
el('notify-on-turn-end').addEventListener('change', (event) => {
  void call(() => window.container.updateSettings({ notifyOnTurnEnd: event.target.checked }))
})

window.container.subscribe(render)
renderMarket()
void window.container.snapshot().then((state) => {
  render(state)
  document.documentElement.dataset.consoleReady = 'true'
})
