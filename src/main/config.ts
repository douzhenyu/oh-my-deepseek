/**
 * The single configuration file the app and the build scripts share.
 * @module main/config
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Product identity and pinned runtime versions from `container.config.json`. */
export interface ContainerConfig {
  /** Displayed product name: menu bar, window titles, console heading, installers. */
  productName: string
  /** Directory under the platform application-data root that holds user data. */
  dataDirectory: string
  /** Reverse-DNS application id used by the installers. */
  appId: string
  /** npm package that provides the harness. */
  dshPackage: string
  /** Upstream Node.js version bundled as the harness runtime. */
  nodeVersion: string
  /** dsh version packaged into application resources as the offline seed. */
  dshSeedVersion: string
  /** Loopback port the harness prefers. */
  defaultPort: number
  /** Package registry used for version discovery and installation. */
  registry: string
}

let cached: ContainerConfig | undefined

/**
 * Read the shared configuration from the application root.
 * @returns The parsed configuration, read once per process.
 */
export const containerConfig = (): ContainerConfig => {
  if (cached === undefined) {
    cached = JSON.parse(readFileSync(join(app.getAppPath(), 'container.config.json'), 'utf8')) as ContainerConfig
  }
  return cached
}
