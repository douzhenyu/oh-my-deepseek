/**
 * Application entry point.
 *
 * The wiring here is deliberately small: create the log, the windows, and the
 * container, then make sure that every way this process can end — a closed
 * window, a menu quit, a signal, an unhandled `exit` — stops the harness
 * process group first.
 * @module main
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, Menu, nativeTheme, shell } from 'electron'
import { followSystemAppearance } from './appearance.ts'
import { containerConfig } from './config.ts'
import { CompletionWatcher } from './completion-watch.ts'
import { Container } from './container.ts'
import { registerIpc } from './ipc.ts'
import { ContainerLog } from './log.ts'
import { showCompletion, showTest, shouldNotify } from './notifications.ts'
import { strings } from './locale.ts'
import { buildMenu } from './menu.ts'
import { overridePaths, paths } from './paths.ts'
import { runSmoke } from './smoke.ts'
import { WindowManager } from './windows.ts'
import { CHANNELS } from '../shared/types.ts'

/** Whether a command-line switch is present. @param name - Switch name, including dashes. */
const has = (name: string): boolean => process.argv.includes(name)

/**
 * Read a switch's value.
 * @param name - Switch name, including dashes.
 * @returns The following argument, or `undefined` when the switch is absent.
 */
const value = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const smokeReport = value('--smoke-report')
const smoke = smokeReport !== undefined
const smokeUserData = value('--smoke-user-data')

app.setName(containerConfig().productName)
// The client chrome follows the operating system's light/dark setting. An
// automated run can force one scheme, because a machine only ever exercises one
// of the two palettes.
followSystemAppearance()
const forcedTheme = value('--smoke-theme')
if (forcedTheme === 'dark' || forcedTheme === 'light') nativeTheme.themeSource = forcedTheme

// User data lives in a directory named for the product, not for the current
// brand: the displayed name is free to change, but moving where a user's harness
// versions and settings live would silently look like data loss.
app.setPath('userData', smokeUserData ?? join(app.getPath('appData'), containerConfig().dataDirectory))

// An automated run must never share state with a real one, and that includes
// where it writes a downloaded update.
if (smokeUserData !== undefined) {
  const downloads = join(smokeUserData, 'downloads')
  mkdirSync(downloads, { recursive: true })
  app.setPath('downloads', downloads)
  overridePaths({ userData: smokeUserData })
}

// A container is one window set per user: two copies would fight over the same
// harness home and the same package directory.
if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const log = new ContainerLog(join(paths().logs, 'container.log'))
  let container: Container | undefined
  let windows: WindowManager | undefined
  let watcher: CompletionWatcher | undefined
  let quitting = false

  const main = async (): Promise<void> => {
    log.open()
    app.setAboutPanelOptions({ applicationName: containerConfig().productName, applicationVersion: app.getVersion() })
    log.push('container', `${containerConfig().productName} ${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node})`)
    windows = new WindowManager({ headless: smoke })
    container = new Container(log, {
      onChange: (state) => { windows?.broadcast(CHANNELS.state, state) },
      onReady: (info) => {
        void windows?.openHarness(info.url).then(
          () => { windows?.closeSplashConsole() },
          (error: unknown) => { log.push('container', `could not open the Harness window: ${String(error)}`) },
        )
      },
    })
    const active = container
    registerIpc(active, {
      openHarness: () => { windows?.focusHarness() },
      testNotification: () => {
        const shown = showTest(strings().turnCompleteTest, {
          onClick: () => { windows?.focusHarness() },
          onFailed: (reason) => {
            // A silent refusal is the whole failure mode here, so it is logged
            // rather than swallowed.
            log.push('notify', `test notification refused by the system: ${reason}`)
          },
        })
        log.push('notify', shown ? 'test notification submitted to the system' : 'the platform does not support notifications')
        return shown
      },
    })
    Menu.setApplicationMenu(buildMenu({
      showConsole: () => { windows?.showConsole() },
      openHarness: () => { windows?.focusHarness() },
      restartBackend: () => { void active.startBackendNow() },
      stopBackend: () => { void active.stopBackend() },
      checkVersions: () => { void active.refreshRemote() },
      openLogs: () => { void active.reveal('logs') },
      openDocumentation: () => { void shell.openExternal('https://deepseek-harness.github.io/deepseek-harness/') },
    }))
    // Finished turns are read from the session logs rather than from the harness,
    // so a conversation that ends while the window is in the background still
    // reaches the user.
    watcher = new CompletionWatcher({
      home: () => active.harnessHomePath(),
      onComplete: (completion) => {
        const enabled = active.settings().notifyOnTurnEnd
        const focused = windows?.isHarnessFocused() === true
        // Recorded whether or not a notification follows, so "why was I not told"
        // and "why was I told" are both answerable from the log.
        log.push(
          'notify',
          `turn ${String(completion.turn)} finished in ${completion.sessionId} (${completion.reason}); ` +
            (enabled ? (focused ? 'window was focused, so nothing was raised' : 'raising a notification') : 'notifications are switched off'),
        )
        if (!shouldNotify({ focused, enabled })) return
        showCompletion(completion, strings().turnComplete, {
          onClick: () => { windows?.focusHarness() },
          onFailed: (reason) => {
            log.push('notify', `the system refused the notification: ${reason}`)
            log.push('notify', 'on macOS this means the app is unsigned: UNNotification will not display anything from a bundle without a valid signature')
          },
        })
      },
    })
    watcher.start()

    if (smoke) windows.showConsole()
    else windows.showConsole({ splash: true })
    const launchStarted = Date.now()
    await active.launch()
    const launchMs = Date.now() - launchStarted
    if (has('--console') && !smoke) windows.showConsole()
    if (smokeReport !== undefined) {
      const install = value('--smoke-install')
      const homeMode = value('--smoke-home-mode')
      await runSmoke(active, windows, smokeReport, {
        launchMs,
        ...(install === undefined ? {} : { install }),
        ...(homeMode === undefined ? {} : { homeMode }),
        ...(has('--smoke-client-update') ? { clientUpdate: true } : {}),
        ...(has('--smoke-notifications') ? { notifications: true } : {}),
      })
      app.quit()
    }
  }

  // Closing the client closes the backend. The container deliberately does not
  // keep running with a live backend after its last window is gone, not even on
  // macOS, because a windowless process still holding a harness would be
  // indistinguishable from a leak.
  app.on('window-all-closed', () => { app.quit() })

  app.on('before-quit', (event) => {
    if (quitting || container === undefined) return
    quitting = true
    event.preventDefault()
    watcher?.stop()
    void container.shutdown().finally(() => {
      log.push('container', 'backend stopped; quitting')
      log.close()
      app.quit()
    })
  })

  app.on('second-instance', () => {
    windows?.focusHarness()
    windows?.showConsole()
  })

  const emergencyStop = (reason: string): void => {
    log.push('container', `${reason}; stopping the backend`)
    container?.shutdownSync()
    log.close()
  }
  process.on('exit', () => { emergencyStop('process exiting') })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      emergencyStop(`received ${signal}`)
      app.exit(0)
    })
  }
  process.on('uncaughtException', (error) => {
    log.push('container', `uncaught exception: ${error.stack ?? error.message}`)
    emergencyStop('uncaught exception')
    app.exit(1)
  })

  void app.whenReady().then(main).catch((error: unknown) => {
    log.push('container', `startup failed: ${String(error)}`)
    emergencyStop('startup failed')
    app.exit(1)
  })
}
