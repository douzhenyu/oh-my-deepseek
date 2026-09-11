/**
 * The only bridge between the console renderer and the main process.
 *
 * The renderer is sandboxed and gets no Node.js, no filesystem, and no raw IPC:
 * it receives one frozen object whose methods are exactly the operations the
 * container implements.
 * @module preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ContainerBridge, type ContainerState, type HarnessHomeMode, type RevealTarget, type SettingsPatch } from '../shared/types.ts'

/** The object published as `window.container`. */
const bridge: ContainerBridge = {
  snapshot: () => ipcRenderer.invoke(CHANNELS.snapshot) as Promise<ContainerState>,
  subscribe: (listener) => {
    const handler = (_event: unknown, state: ContainerState): void => { listener(state) }
    ipcRenderer.on(CHANNELS.state, handler)
    return () => { ipcRenderer.off(CHANNELS.state, handler) }
  },
  refreshRemote: () => ipcRenderer.invoke(CHANNELS.refreshRemote) as Promise<void>,
  install: (version: string) => ipcRenderer.invoke(CHANNELS.install, version) as Promise<void>,
  activate: (version: string) => ipcRenderer.invoke(CHANNELS.activate, version) as Promise<void>,
  remove: (version: string) => ipcRenderer.invoke(CHANNELS.remove, version) as Promise<void>,
  start: () => ipcRenderer.invoke(CHANNELS.start) as Promise<void>,
  stop: () => ipcRenderer.invoke(CHANNELS.stop) as Promise<void>,
  openHarness: () => ipcRenderer.invoke(CHANNELS.openHarness) as Promise<void>,
  reveal: (target: RevealTarget) => ipcRenderer.invoke(CHANNELS.reveal, target) as Promise<void>,
  updateSettings: (patch: SettingsPatch) => ipcRenderer.invoke(CHANNELS.updateSettings, patch) as Promise<void>,
  setHarnessHome: (mode: HarnessHomeMode) => ipcRenderer.invoke(CHANNELS.setHarnessHome, mode) as Promise<void>,
  checkClientUpdate: () => ipcRenderer.invoke(CHANNELS.checkClientUpdate) as Promise<void>,
  downloadClientUpdate: () => ipcRenderer.invoke(CHANNELS.downloadClientUpdate) as Promise<void>,
  installClientUpdate: () => ipcRenderer.invoke(CHANNELS.installClientUpdate) as Promise<void>,
  revealClientUpdate: () => ipcRenderer.invoke(CHANNELS.revealClientUpdate) as Promise<void>,
  openClientRelease: () => ipcRenderer.invoke(CHANNELS.openClientRelease) as Promise<void>,
}

contextBridge.exposeInMainWorld('container', bridge)
