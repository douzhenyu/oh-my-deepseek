/**
 * Native application menu.
 *
 * The menu is the container's second control surface: everything the console
 * can do that is not version-specific also has a menu item, so a user whose
 * Harness window is unresponsive can still reach the console and the backend
 * controls without a command line.
 * @module main/menu
 */

import { Menu, type MenuItemConstructorOptions } from 'electron'
import { containerConfig } from './config.ts'
import { strings } from './locale.ts'

/** Actions the menu triggers. */
export interface MenuActions {
  /** Open or focus the console window. */
  showConsole: () => void
  /** Open or focus the Harness window. */
  openHarness: () => void
  /** Restart the backend on the active version. */
  restartBackend: () => void
  /** Stop the backend. */
  stopBackend: () => void
  /** Refresh the published version list. */
  checkVersions: () => void
  /** Reveal the log directory. */
  openLogs: () => void
  /** Open the public documentation. */
  openDocumentation: () => void
}

/**
 * Build the application menu for the current platform.
 * @param actions - Callbacks for each command.
 * @returns The menu to install.
 */
export const buildMenu = (actions: MenuActions): Menu => {
  const copy = strings().menu
  const appMenu: MenuItemConstructorOptions[] = process.platform === 'darwin'
    ? [{
        label: containerConfig().productName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: copy.console, accelerator: 'CmdOrCtrl+Shift+C', click: actions.showConsole },
          { label: copy.checkVersions, click: actions.checkVersions },
          { label: copy.openLogs, click: actions.openLogs },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
    : []
  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: copy.harnessMenu,
      submenu: [
        { label: copy.openHarness, accelerator: 'CmdOrCtrl+Shift+H', click: actions.openHarness },
        { label: copy.console, ...(process.platform === 'darwin' ? {} : { accelerator: 'CmdOrCtrl+Shift+C' }), click: actions.showConsole },
        { type: 'separator' },
        { label: copy.restartBackend, accelerator: 'CmdOrCtrl+R', click: actions.restartBackend },
        { label: copy.stopBackend, click: actions.stopBackend },
        { label: copy.checkVersions, ...(process.platform === 'darwin' ? {} : { accelerator: 'CmdOrCtrl+U' }), click: actions.checkVersions },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: copy.editMenu,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: copy.viewMenu,
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: copy.windowMenu,
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' } as MenuItemConstructorOptions] : [])],
    },
    {
      label: copy.helpMenu,
      submenu: [{ label: copy.documentation, click: actions.openDocumentation }],
    },
  ]
  return Menu.buildFromTemplate(template)
}
