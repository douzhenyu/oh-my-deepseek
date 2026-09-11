/** Shared build-time helpers: the single configuration file, target descriptors, and small utilities. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file's location. */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** Parsed `container.config.json`: product identity and pinned runtime versions. */
export const config = JSON.parse(readFileSync(join(ROOT, 'container.config.json'), 'utf8'))

/**
 * A packaging target. `platform` and `arch` are Node platform names so they map
 * directly onto Node.js release archive names and electron-builder targets.
 * @typedef {{ id: string, platform: 'darwin'|'win32', arch: 'arm64'|'x64', label: string }} Target
 */

/** Every target this container can be packaged for. Windows targets build on Windows only. */
export const TARGETS = /** @type {Record<string, Target>} */ ({
  'mac-arm64': { id: 'mac-arm64', platform: 'darwin', arch: 'arm64', label: 'macOS arm64' },
  'mac-x64': { id: 'mac-x64', platform: 'darwin', arch: 'x64', label: 'macOS x64' },
  'win-x64': { id: 'win-x64', platform: 'win32', arch: 'x64', label: 'Windows x64' },
})

/**
 * The target matching the host platform, or `undefined` when packaging is unsupported here.
 * @returns {Target | undefined}
 */
export const hostTarget = () => {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : undefined
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  if (platform === undefined || arch === undefined) return undefined
  return Object.values(TARGETS).find((t) => t.platform === platform && t.arch === arch)
}

/**
 * Node.js release archive properties for a target.
 * @param {Target} target - Target to describe.
 * @param {string} version - Node.js version without the leading `v`.
 */
export const nodeArchive = (target, version) => {
  const folder = `node-v${version}-${target.platform === 'win32' ? 'win' : 'darwin'}-${target.arch}`
  return {
    folder,
    archive: target.platform === 'win32' ? `${folder}.zip` : `${folder}.tar.gz`,
    releaseRoot: `https://nodejs.org/download/release/v${version}`,
  }
}

/** Absolute path inside the repository. @param {...string} parts - Path segments. */
export const at = (...parts) => join(ROOT, ...parts)

/** Whether a path exists. @param {string} path - Absolute path to test. */
export const exists = (path) => existsSync(path)
