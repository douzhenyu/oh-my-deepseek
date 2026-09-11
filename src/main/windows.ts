/**
 * Window ownership.
 *
 * Two windows exist. The Harness window is a plain Chromium view of the
 * loopback backend and gets no container privileges; the console window is the
 * only renderer that talks to the main process, and it does so through the
 * narrow preload bridge.
 * @module main/windows
 */

import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { consoleBackground } from './appearance.ts'
import { containerConfig } from './config.ts'
import { strings } from './locale.ts'
import { paths } from './paths.ts'

/** Creates, focuses, and disposes the container's windows. */
export class WindowManager {
  private harnessWindow: BrowserWindow | undefined
  private consoleWindow: BrowserWindow | undefined
  private splash = false

  /**
   * @param options - `headless` creates windows without ever showing them, which
   *   is what an automated smoke run needs.
   */
  constructor(private readonly options: { headless: boolean } = { headless: false }) {
    // A window already on screen keeps its old background unless it is told; the
    // system scheme can flip at any time while the container is open.
    nativeTheme.on('updated', () => { this.applyAppearance() })
  }

  /** Repaint both windows for the current system scheme. */
  private applyAppearance(): void {
    const background = consoleBackground()
    for (const window of [this.consoleWindow, this.harnessWindow]) {
      if (window !== undefined && !window.isDestroyed()) window.setBackgroundColor(background)
    }
  }

  /** Whether a console window is open. */
  get consoleOpen(): boolean {
    return this.consoleWindow !== undefined && !this.consoleWindow.isDestroyed()
  }

  /** Whether the open console was opened as the startup splash. */
  get consoleIsSplash(): boolean {
    return this.consoleOpen && this.splash
  }

  /** Whether a Harness window is open. */
  get harnessOpen(): boolean {
    return this.harnessWindow !== undefined && !this.harnessWindow.isDestroyed()
  }

  /**
   * Open the console window, or focus the one already open.
   * @param options - `splash` marks the window that startup closes once the
   *   backend is ready.
   */
  showConsole(options: { splash: boolean } = { splash: false }): void {
    if (this.consoleOpen) {
      this.consoleWindow?.show()
      this.consoleWindow?.focus()
      return
    }
    const window = new BrowserWindow({
      width: 900,
      height: 780,
      minWidth: 720,
      minHeight: 560,
      title: `${containerConfig().productName} — ${strings().consoleTitle}`,
      backgroundColor: consoleBackground(),
      show: false,
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: {
        preload: join(paths().appRoot, 'lib', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.consoleWindow = window
    this.splash = options.splash
    window.once('ready-to-show', () => { if (!this.options.headless) window.show() })
    window.on('closed', () => {
      this.consoleWindow = undefined
      this.splash = false
    })
    void window.loadFile(join(paths().appRoot, 'lib', 'renderer', 'console.html'))
  }

  /** Close the console window when it is the startup splash. */
  closeSplashConsole(): void {
    if (this.consoleIsSplash) this.consoleWindow?.close()
  }

  /**
   * Load a ready backend into the Harness window, creating it on first use.
   * @param url - Authenticated loopback URL, including its one-time token.
   * @returns Completion once the URL has been committed.
   */
  async openHarness(url: string): Promise<void> {
    const existing = this.harnessWindow
    if (existing !== undefined && !existing.isDestroyed()) {
      await existing.loadURL(url)
      existing.show()
      existing.focus()
      return
    }
    const window = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: containerConfig().productName,
      backgroundColor: consoleBackground(),
      show: false,
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: {
        // A persistent partition keeps the Harness UI's own storage across launches.
        partition: 'persist:dsh',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    this.harnessWindow = window
    window.once('ready-to-show', () => { if (!this.options.headless) window.show() })
    window.on('closed', () => { this.harnessWindow = undefined })
    // The Harness page sets its own document title. The container owns the
    // window chrome, so the native title bar keeps showing the product name.
    window.on('page-title-updated', (event) => { event.preventDefault() })
    // The Harness UI is the only content allowed in this window; anything it
    // tries to navigate or open elsewhere belongs to the user's own browser.
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      void shell.openExternal(target)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin === new URL(url).origin) return
      event.preventDefault()
      void shell.openExternal(target)
    })
    await window.loadURL(url)
  }

  /**
   * Send a message to the console renderer.
   *
   * The Harness window is deliberately excluded: it renders content this
   * container does not own, and container state carries local paths, process ids,
   * and log lines that have no business reaching it.
   * @param channel - IPC channel name.
   * @param payload - Serializable payload.
   */
  broadcast(channel: string, payload: unknown): void {
    if (this.consoleOpen && this.consoleWindow !== undefined) this.consoleWindow.webContents.send(channel, payload)
  }

  /** Close every window, used while quitting. */
  closeAll(): void {
    for (const window of [this.consoleWindow, this.harnessWindow]) {
      if (window !== undefined && !window.isDestroyed()) window.destroy()
    }
    this.consoleWindow = undefined
    this.harnessWindow = undefined
  }

  /**
   * Run a script inside the Harness window.
   * @param script - JavaScript evaluated in the page.
   * @returns The script's result.
   * @throws When no Harness window is open.
   */
  evaluateHarness<T>(script: string): Promise<T> {
    if (!this.harnessOpen || this.harnessWindow === undefined) throw new Error('the Harness window is not open')
    return this.harnessWindow.webContents.executeJavaScript(script, true) as Promise<T>
  }

  /**
   * Run a script inside the console window.
   * @param script - JavaScript evaluated in the page.
   * @returns The script's result.
   * @throws When no console window is open.
   */
  evaluateConsole<T>(script: string): Promise<T> {
    if (!this.consoleOpen || this.consoleWindow === undefined) throw new Error('the console window is not open')
    return this.consoleWindow.webContents.executeJavaScript(script, true) as Promise<T>
  }

  /** Focus the Harness window when open. @returns Whether it was focused. */
  focusHarness(): boolean {
    if (!this.harnessOpen) return false
    this.harnessWindow?.show()
    this.harnessWindow?.focus()
    return true
  }
}
