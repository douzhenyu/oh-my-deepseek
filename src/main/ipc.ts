/**
 * IPC surface of the console window.
 *
 * Every handler validates its arguments here rather than trusting the renderer,
 * and every handler returns a plain value so a failure surfaces in the console
 * as a rejected promise instead of a silent no-op.
 * @module main/ipc
 */

import { ipcMain } from 'electron'
import { CHANNELS, type HarnessHomeMode, type RevealTarget, type SettingsPatch } from '../shared/types.ts'
import type { Container } from './container.ts'

/** Reject anything that is not a non-empty string. @param value - Renderer argument. */
const asString = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('expected a non-empty string')
  return value
}

/** Accept only the reveal targets the container can open. @param value - Renderer argument. */
const asRevealTarget = (value: unknown): RevealTarget => {
  if (value !== 'logs' && value !== 'data' && value !== 'versions') throw new Error(`unknown reveal target: ${String(value)}`)
  return value
}

/** Accept only the two supported home modes. @param value - Renderer argument. */
const asHomeMode = (value: unknown): HarnessHomeMode => {
  if (value !== 'shared' && value !== 'separate') throw new Error(`unknown harness home mode: ${String(value)}`)
  return value
}

/** Keep only the settings fields the container understands. @param value - Renderer argument. */
const asSettingsPatch = (value: unknown): SettingsPatch => {
  if (typeof value !== 'object' || value === null) throw new Error('expected a settings object')
  const source = value as Record<string, unknown>
  const patch: SettingsPatch = {}
  if (typeof source.activeVersion === 'string') patch.activeVersion = source.activeVersion
  if (typeof source.port === 'number' && Number.isInteger(source.port) && source.port >= 0 && source.port <= 65535) patch.port = source.port
  if (typeof source.autoStart === 'boolean') patch.autoStart = source.autoStart
  if (typeof source.checkUpdatesOnLaunch === 'boolean') patch.checkUpdatesOnLaunch = source.checkUpdatesOnLaunch
  if (typeof source.checkClientUpdatesOnLaunch === 'boolean') patch.checkClientUpdatesOnLaunch = source.checkClientUpdatesOnLaunch
  if (typeof source.notifyOnTurnEnd === 'boolean') patch.notifyOnTurnEnd = source.notifyOnTurnEnd
  if (typeof source.dshHome === 'string') patch.dshHome = source.dshHome
  return patch
}

/**
 * Register every console channel.
 * @param container - The container the channels act on.
 * @param hooks - Window-level actions the container does not own.
 */
export const registerIpc = (container: Container, hooks: { openHarness: () => void; testNotification: () => boolean }): void => {
  ipcMain.handle(CHANNELS.snapshot, () => container.snapshot())
  ipcMain.handle(CHANNELS.openHarness, () => { hooks.openHarness() })
  ipcMain.handle(CHANNELS.refreshRemote, async () => { await container.refreshRemote() })
  ipcMain.handle(CHANNELS.install, async (_event, version: unknown) => { await container.install(asString(version)) })
  ipcMain.handle(CHANNELS.activate, async (_event, version: unknown) => { await container.activate(asString(version)) })
  ipcMain.handle(CHANNELS.remove, async (_event, version: unknown) => { await container.remove(asString(version)) })
  ipcMain.handle(CHANNELS.start, async () => { await container.startBackendNow() })
  ipcMain.handle(CHANNELS.stop, async () => { await container.stopBackend() })
  ipcMain.handle(CHANNELS.reveal, async (_event, target: unknown) => { await container.reveal(asRevealTarget(target)) })
  ipcMain.handle(CHANNELS.updateSettings, (_event, patch: unknown) => { container.applySettings(asSettingsPatch(patch)) })
  ipcMain.handle(CHANNELS.setHarnessHome, async (_event, mode: unknown) => { await container.setHarnessHome(asHomeMode(mode)) })
  ipcMain.handle(CHANNELS.checkClientUpdate, async () => { await container.checkClientUpdate() })
  ipcMain.handle(CHANNELS.downloadClientUpdate, async () => { await container.downloadClientUpdate() })
  ipcMain.handle(CHANNELS.installClientUpdate, async () => { await container.installClientUpdate() })
  ipcMain.handle(CHANNELS.revealClientUpdate, () => { container.revealClientUpdate() })
  ipcMain.handle(CHANNELS.openClientRelease, async () => { await container.openClientRelease() })
  ipcMain.handle(CHANNELS.testNotification, () => hooks.testNotification())
  ipcMain.handle(CHANNELS.pluginMarketSnapshot, () => container.pluginMarketSnapshot())
  ipcMain.handle(CHANNELS.refreshPluginMarket, async () => await container.refreshPluginMarket())
  ipcMain.handle(CHANNELS.installPlugin, async (_event, id: unknown) => await container.installPlugin(asString(id)))
  ipcMain.handle(CHANNELS.removePlugin, async (_event, id: unknown) => await container.removePlugin(asString(id)))
  ipcMain.handle(CHANNELS.openPluginPage, async (_event, id: unknown) => { await container.openPluginPage(asString(id)) })
}
