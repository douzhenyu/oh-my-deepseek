/**
 * Automated end-to-end verification of the container.
 *
 * A real launch is the only honest test of the promises this application makes:
 * that opening it produces a working Harness page without a command line, and
 * that quitting it leaves no harness process behind. `--smoke` therefore runs
 * the normal startup path, asserts against the live backend and the live page,
 * writes a JSON report, and then quits through the normal quit path so the
 * caller can verify the process group is gone.
 * @module main/smoke
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib'
import { isNewer, sizeOf } from './client-update.ts'
import { CompletionWatcher } from './completion-watch.ts'
import { notificationsSupported, shouldNotify } from './notifications.ts'
import { listSessionLogs, scanFrames, type TurnCompletion } from './session-log.ts'
import { containerConfig } from './config.ts'
import type { Container } from './container.ts'
import type { WindowManager } from './windows.ts'

/** What the harness page reports about itself once it has booted. */
interface PageProbe {
  /** Document title. */
  title: string
  /** Module-loader mode; the boot script starts in `queue` and leaves it once the app mounts. */
  mode?: string
  /** Serialized length of the body, a cheap proxy for "the app rendered". */
  bodyLength: number
}

/** What the console window reports about itself. */
interface ConsoleProbe {
  /** Whether the console script finished its first render. */
  ready: boolean
  /** Heading text, which proves the page shell rendered. */
  heading: string
  /** Status pill text, which proves the state arrived over IPC. */
  status: string
  /** Client update card text, which proves the new card rendered. */
  clientNote: string
  /** Label of the on-demand notification button. */
  testNotification: string
}

/** What the console window reports about its own appearance. */
interface AppearanceProbe {
  /** Whether the system is asking for a dark interface. */
  dark: boolean
  /** The console's computed body background. */
  background: string
}

/**
 * Perceived luminance of a CSS `rgb(...)` colour, used to check that the console
 * agrees with the system scheme without pinning exact palette values.
 * @param color - A computed CSS colour.
 * @returns 0-255 luminance, or `NaN` when the value is not a colour.
 */
const luminance = (color: string): number => {
  const inner = /rgba?\(([^)]+)\)/.exec(color)?.[1]
  if (inner === undefined) return Number.NaN
  const channels = inner.split(',').map((value) => Number(value.trim()))
  const [red = Number.NaN, green = Number.NaN, blue = Number.NaN] = channels
  if ([red, green, blue].some((channel) => Number.isNaN(channel))) return Number.NaN
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Result of the automated run. */
export interface SmokeReport {
  ok: boolean
  error?: string
  phase: string
  activeVersion?: string
  port?: number
  backendPid?: number
  mainPid: number
  page?: PageProbe
  console?: ConsoleProbe
  consoleAppearance?: AppearanceProbe
  background?: {
    windowRetained: boolean
    backendRetained: boolean
    restored: boolean
  }
  http?: { rootWithoutCookie: number; tokenHandoff: number }
  launchMs: number
  home?: {
    mode: string
    ok: boolean
    activeVersion?: string
    phase?: string
    backendPid?: number
    returnedToShared?: boolean
    error?: string
  }
  notifications?: {
    ok: boolean
    historySuppressed?: boolean
    detected?: number
    delegatedIgnored?: boolean
    title?: string
    turn?: number
    sinkCalls?: number
    supported?: boolean
    decision?: { focused: boolean; unfocused: boolean; disabled: boolean }
    realLogFrames?: number
    realLogDecoded?: number
    error?: string
  }
  clientUpdate?: {
    ok: boolean
    currentVersion?: string
    latest?: string
    available?: boolean
    assetName?: string
    downloadedBytes?: number
    cleanedUp?: boolean
    /** Decision-table results, so the offer logic is checked without a newer release existing. */
    comparison?: { newer: boolean; equal: boolean; older: boolean; prerelease: boolean }
    error?: string
  }
  pluginMarket?: {
    ok: boolean
    catalogCount?: number
    plugin?: string
    catalogVersion?: string
    installedVersion?: string
    installedBundle?: boolean
    removed?: boolean
    restarted?: boolean
    repairOffered?: boolean
    rollbackRestored?: boolean
    error?: string
  }
  unlistedPlugin?: { visible?: boolean; removed?: boolean; error?: string }
  install?: {
    version: string
    ok: boolean
    activeVersion?: string
    phase?: string
    pageAfterSwitch?: PageProbe
    error?: string
  }
  timings: Record<string, number>
}

/** Wait between page probes. */
const POLL_MS = 400

/**
 * Poll the Harness page until its application has mounted.
 * @param windows - Window layer holding the page.
 * @param timeoutMs - How long to wait before giving up.
 * @returns The last probe.
 * @throws When the page never leaves its boot state.
 */
const waitForBoot = async (windows: WindowManager, timeoutMs: number): Promise<PageProbe> => {
  const deadline = Date.now() + timeoutMs
  let last: PageProbe = { title: '', bodyLength: 0 }
  while (Date.now() < deadline) {
    last = await windows.evaluateHarness<PageProbe>(
      '({ title: document.title, mode: globalThis.__ModuleLoader__ && globalThis.__ModuleLoader__.mode, bodyLength: document.body ? document.body.innerHTML.length : 0 })',
    )
    if (last.mode !== undefined && last.mode !== 'queue' && last.bodyLength > 500) return last
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`the Harness page did not finish booting (last probe: ${JSON.stringify(last)})`)
}

/**
 * Poll the console window until its first render completes.
 * @param windows - Window layer holding the console page.
 * @param timeoutMs - How long to wait before giving up.
 * @returns The last probe.
 * @throws When the console never renders, which means the preload bridge or the
 *   page's content security policy is broken.
 */
const waitForConsole = async (windows: WindowManager, timeoutMs: number): Promise<ConsoleProbe> => {
  const deadline = Date.now() + timeoutMs
  let last: ConsoleProbe = { ready: false, heading: '', status: '', clientNote: '', testNotification: '' }
  while (Date.now() < deadline) {
    try {
      last = await windows.evaluateConsole<ConsoleProbe>(
        "({ ready: document.documentElement.dataset.consoleReady === 'true', heading: (document.getElementById('heading') || {}).textContent || '', status: (document.getElementById('status') || {}).textContent || '', clientNote: (document.getElementById('client-note') || {}).textContent || '', testNotification: (document.getElementById('test-notification') || {}).textContent || '' })",
      )
      if (last.ready) return last
    } catch {
      // The page has not committed yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`the console window never rendered (last probe: ${JSON.stringify(last)})`)
}

/**
 * Verify the running backend over HTTP.
 * @param container - Container holding the authenticated URL.
 * @returns The status codes that prove the server is up and its auth fence is active.
 */
const probeHttp = async (container: Container): Promise<{ rootWithoutCookie: number; tokenHandoff: number }> => {
  const info = container.backendInfo
  if (info === undefined) throw new Error('no backend is running')
  const unauthorised = await fetch(`http://127.0.0.1:${String(info.port)}/`, { redirect: 'manual' })
  const handoff = await fetch(info.url, { redirect: 'manual' })
  return { rootWithoutCookie: unauthorised.status, tokenHandoff: handoff.status }
}

/**
 * Exercise the completion-notification pipeline.
 *
 * Three things have to hold, and each is checked separately: a session log that
 * already contains finished turns must not be reported as news, a turn that ends
 * after watching starts must be reported once, and a delegated session's turn
 * must never be reported at all. The frame scanner is also run over a real
 * session log from the user's own harness home, because the fixtures are written
 * by this process and would happily agree with a wrong scanner.
 * @returns The scenario result, never throwing.
 */
const exerciseNotifications = (): NonNullable<SmokeReport['notifications']> => {
  const result: NonNullable<SmokeReport['notifications']> = { ok: false }
  try {
    // The isolated user data directory of this run, so the fixture is cleaned up
    // with everything else.
    const home = join(app.getPath('userData'), 'notify-fixture')
    const userLog = join(home, 'sessions', '--fixture--', 'session-user', 'session.v3.jsonl.zstd')
    const childLog = join(home, 'sessions', '--fixture--', 'session-child', 'session.v3.jsonl.zstd')
    mkdirSync(dirname(userLog), { recursive: true })
    mkdirSync(dirname(childLog), { recursive: true })
    const frame = (event: unknown): Buffer => zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`))
    writeFileSync(userLog, Buffer.concat([
      frame({ type: 'session', version: 3, id: 'session-user', cwd: '/fixture/project', delegationDepth: 0 }),
      frame({ type: 'session/title', seq: 1, data: { title: 'Fixture conversation' } }),
      frame({ type: 'turn/start', seq: 2, data: { turn: 1 } }),
      frame({ type: 'turn/end', seq: 3, time: 1000, data: { turn: 1, reason: { kind: 'completed' } } }),
    ]))
    writeFileSync(childLog, Buffer.concat([
      frame({ type: 'session', version: 3, id: 'session-child', cwd: '/fixture/project', delegationDepth: 1 }),
      frame({ type: 'turn/end', seq: 2, time: 1100, data: { turn: 1, reason: { kind: 'completed' } } }),
    ]))

    const seen: TurnCompletion[] = []
    const watcher = new CompletionWatcher({ home: () => home, onComplete: (completion) => { seen.push(completion) } })
    result.historySuppressed = watcher.poll().length === 0

    appendFileSync(userLog, frame({ type: 'turn/end', seq: 9, time: 2000, data: { turn: 2, reason: { kind: 'completed' } } }))
    const detected = watcher.poll()
    result.detected = detected.length
    result.title = detected[0]?.title
    result.turn = detected[0]?.turn

    appendFileSync(childLog, frame({ type: 'turn/end', seq: 9, time: 2100, data: { turn: 2, reason: { kind: 'completed' } } }))
    result.delegatedIgnored = watcher.poll().length === 0
    watcher.stop()
    result.sinkCalls = seen.length
    result.supported = notificationsSupported()
    result.decision = {
      focused: shouldNotify({ focused: true, enabled: true }),
      unfocused: shouldNotify({ focused: false, enabled: true }),
      disabled: shouldNotify({ focused: false, enabled: false }),
    }

    // Real data: a fixture this process wrote would agree with a broken scanner.
    const realHome = join(homedir(), '.dsh')
    const realLogs = existsSync(realHome) ? listSessionLogs(realHome, 1) : []
    if (realLogs[0] !== undefined) {
      const buffer = readFileSync(realLogs[0])
      const scan = scanFrames(buffer)
      result.realLogFrames = scan.frames.length
      let decoded = 0
      for (const range of scan.frames) {
        zstdDecompressSync(buffer.subarray(range.start, range.end))
        decoded += 1
      }
      result.realLogDecoded = decoded
    }

    result.ok = result.historySuppressed === true
      && result.detected === 1
      && result.delegatedIgnored === true
      && result.title === 'Fixture conversation'
      && result.sinkCalls === 1
      && result.decision.focused === false
      && result.decision.disabled === false
      && result.decision.unfocused === result.supported
      && result.realLogFrames !== undefined
      && result.realLogFrames === result.realLogDecoded
  } catch (error) {
    result.error = error instanceof Error ? `${error.message}` : String(error)
  }
  return result
}

/**
 * Exercise the client's own update path against the real release feed.
 *
 * It checks, resolves the asset for this platform, downloads it through the same
 * code the console uses, and then removes it: the point is that the transfer
 * verified byte-for-byte, not that a 200 MB installer is left in the user's
 * downloads folder.
 * @param container - The running container.
 * @returns The scenario result, never throwing.
 */
const exerciseClientUpdate = async (container: Container): Promise<NonNullable<SmokeReport['clientUpdate']>> => {
  const result: NonNullable<SmokeReport['clientUpdate']> = { ok: false }
  try {
    // The feed currently holds this same version, so the "newer" branch cannot be
    // reached from it; check the decision table directly instead.
    result.comparison = {
      newer: isNewer('0.1.2', '0.1.1'),
      equal: isNewer('0.1.1', '0.1.1'),
      older: isNewer('0.1.0', '0.1.1'),
      prerelease: isNewer('0.1.1-rc.1', '0.1.1'),
    }
    if (result.comparison.newer !== true || result.comparison.equal !== false
      || result.comparison.older !== false || result.comparison.prerelease !== false) {
      throw new Error(`the update decision table is wrong: ${JSON.stringify(result.comparison)}`)
    }
    await container.checkClientUpdate()
    const checked = container.snapshot().client
    result.currentVersion = checked.currentVersion
    result.latest = checked.latest?.version
    result.available = checked.available
    result.assetName = checked.latest?.assetName
    if (checked.error !== undefined) throw new Error(`check failed: ${checked.error}`)
    if (checked.latest === undefined) throw new Error('no release was resolved')
    if (checked.latest.assetName === undefined) {
      throw new Error(`the newest release has no build for ${process.platform}-${process.arch}`)
    }
    await container.downloadClientUpdate()
    const downloaded = container.snapshot().client
    if (downloaded.error !== undefined) throw new Error(`download failed: ${downloaded.error}`)
    if (downloaded.downloadedPath === undefined) throw new Error('no file was produced')
    result.downloadedBytes = sizeOf(downloaded.downloadedPath)
    if (result.downloadedBytes <= 0) throw new Error(`the downloaded file is empty: ${downloaded.downloadedPath}`)
    rmSync(downloaded.downloadedPath, { force: true })
    result.cleanedUp = true
    result.ok = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/**
 * Switch the harness home through the container's own control and prove the
 * backend actually restarted onto it.
 * @param container - The running container.
 * @param windows - Window layer used to inspect the reloaded page.
 * @param mode - `shared` or `separate`.
 * @returns The scenario result, never throwing.
 */
const switchHome = async (
  container: Container,
  windows: WindowManager,
  mode: string,
): Promise<NonNullable<SmokeReport['home']>> => {
  const result: NonNullable<SmokeReport['home']> = { mode, ok: false }
  try {
    const before = container.snapshot()
    await container.setHarnessHome(mode === 'separate' ? 'separate' : 'shared')
    const after = container.snapshot()
    result.phase = after.phase
    result.activeVersion = after.activeVersion
    result.backendPid = after.backendPid
    if (after.phase !== 'ready') throw new Error(after.error ?? `the container is in phase ${after.phase} after switching home`)
    if (after.harnessHomeMode !== (mode === 'separate' ? 'separate' : 'shared')) {
      throw new Error(`expected harness home mode ${mode}, got ${after.harnessHomeMode}`)
    }
    if (after.backendPid === before.backendPid) throw new Error('the backend was not restarted on the selected home')
    const page = await waitForBoot(windows, 60_000)
    if (page.mode === 'queue') throw new Error('the Harness page did not reboot after the home switch')
    // Switching back must work, or a user who chose the independent home could
    // never return to the shared one.
    if (mode === 'separate') {
      await container.setHarnessHome('shared')
      const returned = container.snapshot()
      if (returned.phase !== 'ready' || returned.harnessHomeMode !== 'shared') {
        throw new Error(`could not switch back to the shared home (phase ${returned.phase}, mode ${returned.harnessHomeMode})`)
      }
      result.returnedToShared = true
    }
    result.ok = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/**
 * Install a published version through the container's own update path and prove
 * the backend actually restarted onto it.
 * @param container - The running container.
 * @param windows - Window layer used to inspect the reloaded page.
 * @param version - Version to install and activate.
 * @returns The scenario result, never throwing.
 */
const installAndSwitch = async (
  container: Container,
  windows: WindowManager,
  version: string,
): Promise<NonNullable<SmokeReport['install']>> => {
  const result: NonNullable<SmokeReport['install']> = { version, ok: false }
  try {
    const before = container.snapshot()
    // Installing through the container is what the console's Install button does:
    // it installs when needed and then runs the backend on that version.
    await container.install(version)
    const after = container.snapshot()
    result.phase = after.phase
    result.activeVersion = after.activeVersion
    if (after.phase !== 'ready') throw new Error(after.error ?? `the container is in phase ${after.phase} after switching`)
    if (after.activeVersion !== version) throw new Error(`expected the active version to become ${version}, got ${String(after.activeVersion)}`)
    // The version must be served by a backend that started after the request, so
    // an already-active version still proves the restart path rather than a no-op.
    if (after.backendPid === before.backendPid) throw new Error('the backend was not restarted on the selected version')
    if (before.activeVersion !== undefined && before.activeVersion !== version && before.activeVersion === after.activeVersion) {
      throw new Error('the switch did not change the active version')
    }
    const page = await waitForBoot(windows, 60_000)
    result.pageAfterSwitch = page
    if (page.mode === 'queue') throw new Error('the Harness page did not reboot after the version switch')
    const bundled = after.installed.find((entry) => entry.source === 'bundled')
    if (bundled !== undefined && bundled.version !== version) {
      await container.remove(bundled.version)
      const cleaned = container.snapshot()
      if (cleaned.installed.some((entry) => entry.version === bundled.version)) {
        throw new Error(`the old bundled version ${bundled.version} remained selectable after removal`)
      }
      if (cleaned.activeVersion !== version || cleaned.phase !== 'ready') {
        throw new Error('removing the old bundled version disturbed the active Harness')
      }
    }
    result.ok = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/**
 * Exercise the native market's full package lifecycle in the isolated smoke
 * home: catalog → install → bundle reconciliation → restart → remove → restart.
 */
const exercisePluginMarket = async (
  container: Container,
  scenario: { name: string; updateFrom?: string; missing?: boolean; expectMigrationFailure?: boolean },
): Promise<NonNullable<SmokeReport['pluginMarket']>> => {
  const pluginName = scenario.name
  const updateFrom = scenario.updateFrom
  const result: NonNullable<SmokeReport['pluginMarket']> = { ok: false, plugin: pluginName }
  try {
    const catalog = await container.refreshPluginMarket()
    result.catalogCount = catalog.plugins.length
    const plugin = catalog.plugins.find((entry) => entry.name === pluginName)
    if (plugin === undefined) throw new Error(`the catalog has no plugin named ${pluginName}`)
    result.catalogVersion = plugin.version
    if (scenario.missing === true) result.repairOffered = plugin.repairRequired === true
    if (updateFrom === undefined && plugin.installedPackage !== undefined) {
      throw new Error(`${pluginName} was already installed in the isolated smoke home`)
    }
    if (updateFrom !== undefined && plugin.installedVersion !== updateFrom) {
      throw new Error(`expected ${pluginName} ${updateFrom} before the update, got ${String(plugin.installedVersion)}`)
    }
    const beforePid = container.snapshot().backendPid
    if (scenario.expectMigrationFailure === true) {
      const profile = join(container.harnessHomePath(), 'profiles', 'web')
      const packageFile = join(profile, 'package.json')
      const lockFile = join(profile, 'pnpm-lock.yaml')
      const workspaceFile = join(profile, 'pnpm-workspace.yaml')
      const beforePackage = readFileSync(packageFile, 'utf8')
      const beforeLock = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : undefined
      const beforeWorkspace = existsSync(workspaceFile) ? readFileSync(workspaceFile, 'utf8') : undefined
      try {
        await container.installPlugin(plugin.id)
        throw new Error('the deliberately invalid migration unexpectedly succeeded')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('原文件已恢复')) throw error
      }
      const installed = JSON.parse(readFileSync(join(profile, 'node_modules', pluginName, 'package.json'), 'utf8')) as { version?: string }
      result.rollbackRestored = readFileSync(packageFile, 'utf8') === beforePackage
        && (existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : undefined) === beforeLock
        && (existsSync(workspaceFile) ? readFileSync(workspaceFile, 'utf8') : undefined) === beforeWorkspace
        && installed.version === updateFrom
        && !existsSync(join(profile, '.oh-my-deepseek-pnpm-migration'))
      result.restarted = container.snapshot().backendPid !== beforePid && container.snapshot().phase === 'ready'
      result.ok = result.rollbackRestored === true && result.restarted === true
      return result
    }
    const installed = await container.installPlugin(plugin.id)
    const installedEntry = installed.plugins.find((entry) => entry.id === plugin.id)
    result.installedVersion = installedEntry?.installedVersion
    const dependency = installedEntry?.installedPackage
    if (dependency === undefined) throw new Error('the installed package was not detected in the profile')
    const profileManifest = readFileSync(join(container.harnessHomePath(), 'profiles', 'web', 'package.json'), 'utf8')
    const profile = JSON.parse(profileManifest) as { dsh?: { profile?: { bundles?: string[] } } }
    result.installedBundle = profile.dsh?.profile?.bundles?.includes(dependency) === true
    const installedPid = container.snapshot().backendPid
    const removed = await container.removePlugin(plugin.id)
    result.removed = removed.plugins.find((entry) => entry.id === plugin.id)?.installedPackage === undefined
    const removedPid = container.snapshot().backendPid
    result.restarted = beforePid !== installedPid && installedPid !== removedPid
    result.ok = (result.catalogCount ?? 0) > 1000
      && result.installedVersion !== undefined
      && result.installedBundle === true
      && result.removed === true
      && result.restarted === true
      && (scenario.missing !== true || result.repairOffered === true)
      && container.snapshot().phase === 'ready'
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/** Verify that an installed direct dependency remains manageable after leaving the catalog. */
const exerciseUnlistedPlugin = async (
  container: Container,
  packageName: string,
): Promise<NonNullable<SmokeReport['unlistedPlugin']>> => {
  const result: NonNullable<SmokeReport['unlistedPlugin']> = {}
  try {
    const market = await container.refreshPluginMarket()
    const entry = market.plugins.find((plugin) => plugin.installedPackage === packageName)
    result.visible = entry?.catalogued === false
    if (entry === undefined) throw new Error(`${packageName} was absent from the installed plugin list`)
    const removed = await container.removePlugin(entry.id)
    result.removed = !removed.plugins.some((plugin) => plugin.installedPackage === packageName)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/**
 * Run the container verification and write its report.
 * @param container - A container that has already attempted to launch.
 * @param windows - Window layer used to inspect the Harness page.
 * @param reportPath - File to write the JSON report to.
 * @param options - `install` additionally installs a published version and
 *   switches the backend onto it, which is the update path users exercise.
 * @param options.notifications - Whether to exercise completion notification.
 * @param options.clientUpdate - Whether to exercise the client's own update path.
 * @param options.install - Version to install and activate, when requested.
 * @param options.plugin - Catalog plugin scenario to exercise in the isolated smoke home.
 * @param options.unlistedPlugin - Installed package omitted from the catalog.
 * @param options.homeMode - Harness home to switch to, when requested.
 * @param options.launchMs - How long the initial launch took, measured by the caller.
 * @returns Completion after the report is on disk; the caller then quits.
 */
export const runSmoke = async (
  container: Container,
  windows: WindowManager,
  reportPath: string,
  options: { install?: string; plugin?: { name: string; updateFrom?: string; missing?: boolean; expectMigrationFailure?: boolean }; unlistedPlugin?: string; homeMode?: string; clientUpdate?: boolean; notifications?: boolean; launchMs: number },
): Promise<void> => {
  const started = Date.now()
  const state = container.snapshot()
  const report: SmokeReport = {
    ok: false,
    phase: state.phase,
    mainPid: process.pid,
    launchMs: options.launchMs,
    timings: {},
    ...(state.activeVersion === undefined ? {} : { activeVersion: state.activeVersion }),
    ...(state.port === undefined ? {} : { port: state.port }),
    ...(state.backendPid === undefined ? {} : { backendPid: state.backendPid }),
  }
  try {
    if (state.phase !== 'ready') throw new Error(state.error ?? `the container did not become ready (phase: ${state.phase})`)
    report.timings['ready'] = Date.now() - started
    // The console is verified even though it is never shown in an automated run:
    // a broken preload bridge or content security policy would otherwise go
    // unnoticed until a user opened it.
    const console_ = await waitForConsole(windows, 30_000)
    report.console = console_
    report.timings['consoleBoot'] = Date.now() - started
    if (console_.heading.trim() === '') throw new Error('the console window rendered no heading')
    if (console_.clientNote.trim() === '') throw new Error('the client update card rendered no status line')
    if (console_.testNotification.trim() === '') throw new Error('the notification test button rendered no label')
    const brand = containerConfig().productName
    if (console_.heading.trim() !== brand) throw new Error(`the console heading is "${console_.heading}", expected the product name "${brand}"`)
    const page = await waitForBoot(windows, 60_000)
    report.page = page
    report.timings['pageBoot'] = Date.now() - started
    const http = await probeHttp(container)
    report.http = http
    if (http.rootWithoutCookie !== 401) throw new Error(`an unauthenticated request returned ${String(http.rootWithoutCookie)}, expected 401`)
    if (http.tokenHandoff !== 303) throw new Error(`the token hand-off returned ${String(http.tokenHandoff)}, expected 303`)
    if (page.title.trim() === '') throw new Error('the Harness page has no title')
    // The native close button is a background action. Exercise the actual
    // BrowserWindow close event, prove it neither destroys the window nor stops
    // the backend, then restore the same window through its authenticated URL.
    const backgroundPid = container.snapshot().backendPid
    windows.closeHarness()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const windowRetained = windows.harnessOpen
    const backendRetained = container.backendRunning && container.snapshot().backendPid === backgroundPid
    const restoreInfo = container.backendInfo
    if (restoreInfo !== undefined) await windows.openHarness(restoreInfo.url)
    const restored = windowRetained && (await waitForBoot(windows, 30_000)).bodyLength > 500
    report.background = { windowRetained, backendRetained, restored }
    if (!windowRetained || !backendRetained || !restored) throw new Error('closing the Harness window did not preserve and restore the background session')
    // The client chrome must follow the operating system's scheme: a dark panel
    // under a light menu bar was the reported defect.
    const appearance = await windows.evaluateConsole<AppearanceProbe>(
      "({ dark: matchMedia('(prefers-color-scheme: dark)').matches, background: getComputedStyle(document.body).backgroundColor })",
    )
    report.consoleAppearance = appearance
    const value = luminance(appearance.background)
    if (Number.isNaN(value)) throw new Error(`the console background is not a colour: ${appearance.background}`)
    if (appearance.dark && value > 96) throw new Error(`the system is dark but the console renders a light background (${appearance.background})`)
    if (!appearance.dark && value < 160) throw new Error(`the system is light but the console renders a dark background (${appearance.background})`)
    if (options.notifications === true) report.notifications = exerciseNotifications()
    if (options.clientUpdate === true) report.clientUpdate = await exerciseClientUpdate(container)
    if (options.homeMode !== undefined) report.home = await switchHome(container, windows, options.homeMode)
    if (options.install !== undefined) report.install = await installAndSwitch(container, windows, options.install)
    if (options.plugin !== undefined) report.pluginMarket = await exercisePluginMarket(container, options.plugin)
    if (options.unlistedPlugin !== undefined) report.unlistedPlugin = await exerciseUnlistedPlugin(container, options.unlistedPlugin)
    report.ok = (report.install === undefined || report.install.ok)
      && (report.pluginMarket === undefined || report.pluginMarket.ok)
      && (report.unlistedPlugin === undefined || (report.unlistedPlugin.visible === true && report.unlistedPlugin.removed === true))
    if (!report.ok) report.error = report.install?.error ?? report.pluginMarket?.error ?? 'an optional smoke scenario failed'
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}` : String(error)
  }
  report.timings['total'] = Date.now() - started
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
