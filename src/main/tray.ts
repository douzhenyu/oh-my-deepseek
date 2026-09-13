/**
 * Windows notification-area entry for an application with hidden windows.
 *
 * Closing a window keeps Harness running, so Windows needs a discoverable way
 * back into the application that does not depend on remembering a shortcut.
 * @module main/tray
 */

import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { containerConfig } from './config.ts'
import { strings } from './locale.ts'
import { paths } from './paths.ts'

/** Commands exposed from the tray menu. */
export interface TrayActions {
  openHarness: () => void
  showConsole: () => void
  restartBackend: () => void
  stopBackend: () => void
  quit: () => void
}

/** Owns the Windows tray icon for the lifetime of the Electron process. */
export class TrayController {
  private tray: Tray | undefined
  private announced = false

  constructor(private readonly actions: TrayActions) {}

  /** Create the tray icon on Windows; other platforms use their native Dock. */
  start(): void {
    if (process.platform !== 'win32' || this.tray !== undefined) return
    const iconPath = app.isPackaged
      ? join(paths().resources, 'tray-icon.png')
      : join(paths().appRoot, 'build', 'icon.png')
    const source = nativeImage.createFromPath(iconPath)
    if (source.isEmpty()) throw new Error(`could not load the tray icon: ${iconPath}`)
    const tray = new Tray(source.resize({ width: 16, height: 16, quality: 'best' }))
    const copy = strings()
    tray.setToolTip(containerConfig().productName)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: copy.menu.openHarness, click: this.actions.openHarness },
      { label: copy.menu.console, click: this.actions.showConsole },
      { type: 'separator' },
      { label: copy.menu.restartBackend, click: this.actions.restartBackend },
      { label: copy.menu.stopBackend, click: this.actions.stopBackend },
      { type: 'separator' },
      { label: copy.menu.quit, click: this.actions.quit },
    ]))
    tray.on('click', this.actions.openHarness)
    this.tray = tray
  }

  /** Explain the first transition to the background instead of disappearing. */
  announceBackground(): void {
    if (this.tray === undefined || this.announced) return
    this.announced = true
    const copy = strings()
    this.tray.displayBalloon({
      title: copy.backgroundTitle,
      content: copy.backgroundBody,
      iconType: 'info',
      noSound: true,
    })
  }

  /** Remove the native icon while a deliberate quit is shutting Harness down. */
  destroy(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}
