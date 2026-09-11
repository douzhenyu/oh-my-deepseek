/**
 * Every filesystem location the container owns, resolved once per process.
 *
 * Two roots matter and they are deliberately different: `resources` is
 * read-only application content that ships with the install, while `userData`
 * is the writable directory that survives upgrades and is the only place a
 * package operation ever writes.
 * @module main/paths
 */

import { join } from 'node:path'
import { app } from 'electron'

/** Absolute directories the container reads from and writes to. */
export interface ContainerPaths {
  /** Application root; holds `container.config.json` and the development `lib/`. */
  appRoot: string
  /** Read-only resource root: `Resources/` when packaged, `resources/` in development. */
  resources: string
  /** Bundled upstream Node.js directory for the host platform and architecture. */
  nodeDir: string
  /** Read-only dsh version bundled into the application, when one was prepared. */
  seedRoot: string
  /** Writable user data root. */
  userData: string
  /** Root of every dsh version installed by this container. */
  dshVersions: string
  /** Log directory. */
  logs: string
  /** Package-manager cache, kept inside user data so the user's own cache is untouched. */
  npmCache: string
  /** Package-manager user configuration file, kept inside user data. */
  npmUserConfig: string
  /** Supervisor script that outlives the main process only long enough to reap the backend. */
  supervisor: string
}

let overrides: { userData?: string; resources?: string } = {}
let cached: ContainerPaths | undefined

/**
 * Override roots before first resolution. Used by tests and the smoke entry
 * point so an automated run never touches real user data.
 * @param next - Absolute roots to substitute.
 */
export const overridePaths = (next: { userData?: string; resources?: string }): void => {
  overrides = { ...overrides, ...next }
  cached = undefined
}

/**
 * Resolve the container's directories.
 * @returns The resolved paths, computed once per process.
 */
export const paths = (): ContainerPaths => {
  if (cached !== undefined) return cached
  const appRoot = app.getAppPath()
  const packaged = app.isPackaged
  const resources = overrides.resources ?? (packaged ? process.resourcesPath : join(appRoot, 'resources'))
  const userData = overrides.userData ?? app.getPath('userData')
  cached = {
    appRoot,
    resources,
    nodeDir: join(resources, 'node', `${process.platform}-${process.arch}`),
    seedRoot: join(resources, 'dsh-seed'),
    userData,
    dshVersions: join(userData, 'dsh'),
    logs: join(userData, 'logs'),
    npmCache: join(userData, 'npm-cache'),
    npmUserConfig: join(userData, 'npmrc'),
    supervisor: packaged ? join(resources, 'supervisor.mjs') : join(appRoot, 'lib', 'supervisor.mjs'),
  }
  return cached
}
