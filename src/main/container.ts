/**
 * Container state machine.
 *
 * One object owns the lifecycle: which dsh version is active, whether the
 * backend is running, which package operation is in flight, and what the
 * console should show. Every mutating entry point is serialized through a
 * single queue so a button press can never interleave with a launch that is
 * already starting the backend.
 * @module main/container
 */

import { app, shell } from 'electron'
import semver from 'semver'
import type { ContainerSettings, ContainerState, HarnessHomeMode, InstalledVersion, RevealTarget } from '../shared/types.ts'
import { BackendService, resolvePort, type BackendInfo } from './backend.ts'
import { containerConfig } from './config.ts'
import { homeForMode, modeOf, seedSeparateHome } from './harness-home.ts'
import { strings } from './locale.ts'
import type { ContainerLog } from './log.ts'
import { paths } from './paths.ts'
import { fetchVersions } from './registry.ts'
import { loadSettings, updateSettings } from './settings.ts'
import { entryFor, installVersion, listInstalled, removeVersion } from './version-store.ts'

/** What the container needs from the window layer. */
export interface ContainerEvents {
  /** A new state is available for every renderer. */
  onChange: (state: ContainerState) => void
  /** A backend reached readiness and the Harness window should load it. */
  onReady: (info: BackendInfo) => void
}

/** Owns the harness version, the backend process, and the console-visible state. */
export class Container {
  private readonly backend: BackendService
  private installed: InstalledVersion[] = []
  private state: ContainerState
  private queue: Promise<unknown> = Promise.resolve()
  private remoteTags = new Map<string, string[]>()
  private emitTimer: NodeJS.Timeout | undefined

  /**
   * @param log - Shared container log.
   * @param events - Window-layer callbacks.
   */
  constructor(
    private readonly log: ContainerLog,
    private readonly events: ContainerEvents,
  ) {
    this.backend = new BackendService(log, (unexpected, detail) => {
      this.patch({ phase: unexpected ? 'error' : 'stopped', ...(unexpected && detail !== undefined ? { error: detail } : {}) })
    })
    this.log.onAppend(() => { this.scheduleEmit() })
    this.state = {
      phase: 'checking',
      installed: [],
      remote: [],
      checkingRemote: false,
      dshHome: this.homeLabel(),
      dshHomeOverride: this.effectiveHome() ?? '',
      harnessHomeMode: modeOf(this.effectiveHome()),
      logs: [],
      appVersion: app.getVersion(),
      productName: containerConfig().productName,
      platform: process.platform,
      autoStart: true,
      checkUpdatesOnLaunch: true,
      updateAvailable: false,
    }
  }

  /** Current state at call time. */
  snapshot(): ContainerState {
    return { ...this.state, installed: [...this.installed], logs: this.log.tail() }
  }

  /**
   * Whether the registry's newest version is ahead of a given version.
   * @param active - Version to compare; defaults to the state's active version.
   * @returns `true` when an upgrade is worth offering.
   */
  private computeUpdateAvailable(active: string | undefined = this.state.activeVersion ?? this.chooseVersion()): boolean {
    const latest = this.state.latestVersion
    if (active === undefined || latest === undefined) return false
    return semver.valid(active) !== null && semver.valid(latest) !== null && semver.gt(latest, active)
  }

  /** The running backend, absent when none is running. */
  get backendInfo(): BackendInfo | undefined {
    return this.backend.info
  }

  /** Whether the backend process is alive. */
  get backendRunning(): boolean {
    return this.backend.running
  }

  /** Effective harness home, absent when the product default applies. */
  private effectiveHome(): string | undefined {
    const configured = loadSettings().dshHome
    return configured === undefined || configured === '' ? undefined : configured
  }

  /** Harness home as the console should label it. */
  private homeLabel(): string {
    return this.effectiveHome() ?? strings().defaultHome
  }

  /**
   * Serialize an operation behind every operation already queued.
   * @param operation - Work to run exclusively.
   * @returns The operation's result.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Publish the current state without changing it. */
  private emit(): void {
    this.events.onChange(this.snapshot())
  }

  /** Publish a state patch. @param patch - Fields to replace. */
  private patch(patch: Partial<ContainerState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  /**
   * Republish at most a few times a second while output is arriving, so a chatty
   * package manager cannot flood the renderer with IPC messages.
   */
  private scheduleEmit(): void {
    if (this.emitTimer !== undefined) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emit()
    }, 250)
  }

  /** Refresh the installed list and publish it. */
  private refreshInstalled(): void {
    this.installed = listInstalled()
    this.patch({ installed: [...this.installed] })
  }

  /**
   * Start the container: choose a version, make sure it exists, then run it.
   * @returns Completion once the backend is ready, stopped, or failed.
   */
  async launch(): Promise<void> {
    const settings = loadSettings()
    this.patch({
      phase: 'checking',
      autoStart: settings.autoStart,
      checkUpdatesOnLaunch: settings.checkUpdatesOnLaunch,
      dshHome: this.homeLabel(),
      dshHomeOverride: this.effectiveHome() ?? '',
      harnessHomeMode: modeOf(this.effectiveHome()),
    })
    this.refreshInstalled()
    const bundled = this.installed.find((candidate) => candidate.source === 'bundled')?.version
    this.patch({ ...(bundled === undefined ? {} : { bundledVersion: bundled }) })
    if (settings.checkUpdatesOnLaunch) void this.refreshRemote()
    if (!settings.autoStart) {
      const active = this.chooseVersion()
      this.patch({ phase: 'stopped', ...(active === undefined ? {} : { activeVersion: active }) })
      return
    }
    try {
      const version = await this.ensureVersion()
      await this.startBackend(version)
    } catch (error) {
      this.fail(error)
    }
  }

  /**
   * Pick the version to start: the stored choice, then the bundled version,
   * then the newest installed one.
   * @returns The version, or `undefined` when nothing is installed yet.
   */
  private chooseVersion(): string | undefined {
    const stored = loadSettings().activeVersion
    if (stored !== undefined && entryFor(stored) !== undefined) return stored
    const bundled = this.installed.find((candidate) => candidate.source === 'bundled')?.version
    if (bundled !== undefined) return bundled
    return this.installed[0]?.version
  }

  /**
   * Resolve a startable version, installing the pinned seed version when the
   * container has none at all.
   * @returns The version to start.
   * @throws When nothing can be installed.
   */
  private async ensureVersion(): Promise<string> {
    const chosen = this.chooseVersion()
    if (chosen !== undefined) return chosen
    const seed = containerConfig().dshSeedVersion
    this.patch({ phase: 'installing', detail: `dsh ${seed}`, progress: { label: strings().install } })
    this.log.push('container', `no dsh version available; installing ${seed}`)
    await installVersion(seed, (text) => { this.log.push('npm', text) }, undefined)
    this.refreshInstalled()
    const installed = this.chooseVersion()
    if (installed === undefined) throw new Error(`could not install dsh ${seed}`)
    updateSettings({ activeVersion: installed })
    return installed
  }

  /**
   * Run one version and hand its URL to the window layer.
   * @param version - Version to start.
   */
  private async startBackend(version: string): Promise<void> {
    if (this.backend.running) await this.backend.stop()
    this.patch({ phase: 'starting', activeVersion: version, detail: `dsh ${version}`, error: undefined })
    const port = await resolvePort(loadSettings().port)
    const home = this.effectiveHome()
    const info = await this.backend.start({ version, port, ...(home === undefined ? {} : { dshHome: home }) })
    this.patch({
      phase: 'ready',
      activeVersion: version,
      backendUrl: `http://127.0.0.1:${String(info.port)}/`,
      backendPid: info.pid,
      port: info.port,
      updateAvailable: this.computeUpdateAvailable(),
      detail: undefined,
      error: undefined,
      progress: undefined,
    })
    this.events.onReady(info)
  }

  /**
   * Report a failure without discarding the state the user needs to recover.
   * @param error - The failure.
   */
  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.log.push('container', `error: ${message}`)
    this.patch({ phase: 'error', error: message, detail: undefined, progress: undefined })
  }

  /**
   * Query the registry for published versions.
   * @returns Completion once the state carries the result.
   */
  async refreshRemote(): Promise<void> {
    this.patch({ checkingRemote: true, remoteError: undefined })
    try {
      const listing = await fetchVersions()
      this.remoteTags = new Map(listing.versions.map((entry) => [entry.version, entry.tags]))
      const latest = listing.latest ?? listing.versions[0]?.version
      this.patch({
        remote: listing.versions,
        checkingRemote: false,
        ...(latest === undefined ? {} : { latestVersion: latest }),
        updateAvailable: false,
      })
      this.patch({ updateAvailable: this.computeUpdateAvailable() })
    } catch (error) {
      this.patch({ checkingRemote: false, remoteError: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Install a published version and start it.
   * @param version - Exact version to install.
   * @returns Completion once the backend runs it, or the install failed.
   */
  install(version: string): Promise<void> {
    return this.enqueue(async () => {
      const tags = this.remoteTags.get(version) ?? []
      this.patch({
        phase: 'installing',
        detail: `dsh ${version}${tags.length === 0 ? '' : ` (${tags.join(', ')})`}`,
        progress: { label: strings().install },
        error: undefined,
      })
      try {
        await installVersion(version, (text) => { this.log.push('npm', text) }, undefined)
        this.refreshInstalled()
        updateSettings({ activeVersion: version })
        await this.startBackend(version)
      } catch (error) {
        this.fail(error)
      }
    })
  }

  /**
   * Make an installed version active and restart the backend on it.
   * @param version - Exact version to activate.
   * @returns Completion once the backend runs it, or the switch failed.
   */
  activate(version: string): Promise<void> {
    return this.enqueue(async () => {
      if (entryFor(version) === undefined) {
        this.fail(new Error(`dsh ${version} is not installed`))
        return
      }
      updateSettings({ activeVersion: version })
      try {
        await this.startBackend(version)
      } catch (error) {
        this.fail(error)
      }
    })
  }

  /**
   * Delete a version installed in user data, restarting when it was running.
   * @param version - Exact version to delete.
   * @returns Completion once the version is gone.
   */
  remove(version: string): Promise<void> {
    return this.enqueue(async () => {
      try {
        const wasActive = this.state.activeVersion === version
        if (wasActive && this.backend.running) await this.backend.stop()
        removeVersion(version)
        this.log.push('container', `deleted dsh ${version}`)
        if (wasActive) updateSettings({ activeVersion: undefined })
        this.refreshInstalled()
        if (wasActive) {
          const next = this.chooseVersion()
          if (next === undefined) {
            this.patch({ phase: 'stopped', activeVersion: undefined, backendUrl: undefined, backendPid: undefined })
          } else {
            await this.startBackend(next)
          }
        }
      } catch (error) {
        this.fail(error)
      }
    })
  }

  /**
   * Stop the backend.
   * @returns Completion once the process group is gone.
   */
  stopBackend(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.backend.running) {
        this.patch({ phase: 'stopped' })
        return
      }
      await this.backend.stop()
      this.patch({ phase: 'stopped', backendUrl: undefined, backendPid: undefined })
      this.log.push('container', 'backend stopped')
    })
  }

  /**
   * Start the backend on the active version.
   * @returns Completion once it is ready or failed.
   */
  startBackendNow(): Promise<void> {
    return this.enqueue(async () => {
      try {
        const version = this.chooseVersion() ?? (await this.ensureVersion())
        await this.startBackend(version)
      } catch (error) {
        this.fail(error)
      }
    })
  }

  /**
   * Stop the backend without queueing, for use during quit.
   * @returns Completion once the process group is gone.
   */
  async shutdown(): Promise<void> {
    await this.backend.stop()
  }

  /** Kill the backend synchronously for a `process.on('exit')` fallback. */
  shutdownSync(): void {
    if (this.emitTimer !== undefined) clearTimeout(this.emitTimer)
    this.emitTimer = undefined
    this.backend.stopSync()
  }

  /**
   * Persist a settings patch and apply the parts that take effect immediately.
   * @param patch - Fields to change.
   * @returns The settings after the patch.
   */
  applySettings(patch: Partial<ContainerSettings>): ContainerSettings {
    const next = updateSettings(patch)
    this.patch({
      autoStart: next.autoStart,
      checkUpdatesOnLaunch: next.checkUpdatesOnLaunch,
      dshHome: this.homeLabel(),
      dshHomeOverride: this.effectiveHome() ?? '',
      harnessHomeMode: modeOf(this.effectiveHome()),
    })
    return next
  }

  /**
   * Switch between the shared harness home and this client's own one.
   *
   * Moving to the independent home copies the credentials, settings, and skills a
   * first run needs, so the switch does not require signing in again.
   * @param mode - `shared` or `separate`.
   * @returns Completion once the backend runs on the selected home.
   */
  setHarnessHome(mode: HarnessHomeMode): Promise<void> {
    return this.enqueue(async () => {
      try {
        const setting = mode === 'separate' ? seedSeparateHome((text) => { this.log.push('home', text) }) : undefined
        updateSettings({ dshHome: setting })
        this.patch({
          dshHome: this.homeLabel(),
          dshHomeOverride: this.effectiveHome() ?? '',
          harnessHomeMode: modeOf(this.effectiveHome()),
        })
        const version = this.chooseVersion() ?? (await this.ensureVersion())
        await this.startBackend(version)
      } catch (error) {
        this.fail(error)
      }
    })
  }

  /** Settings as the console should display them. */
  settings(): ContainerSettings {
    return loadSettings()
  }

  /**
   * Open a container directory in the platform file manager.
   * @param target - Which directory to reveal.
   */
  async reveal(target: RevealTarget): Promise<void> {
    const directory = target === 'logs' ? paths().logs : target === 'data' ? paths().userData : paths().dshVersions
    await shell.openPath(directory)
  }
}
