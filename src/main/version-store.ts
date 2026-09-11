/**
 * The dsh version store.
 *
 * Two read roots feed one list. `bundled` is the version packaged inside the
 * application and is never written to; `installed` is the version directory in
 * user data that this container creates, updates, and deletes. A version is
 * only reported as available once its CLI entry point actually exists, so a
 * half-finished package operation can never be activated.
 * @module main/version-store
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import type { InstalledVersion } from '../shared/types.ts'
import { containerConfig } from './config.ts'
import { packageEnvironment, packageManager } from './node-runtime.ts'
import { paths } from './paths.ts'

/** Absolute directory of a specific installed version. */
const versionDirectory = (version: string, source: InstalledVersion['source']): string =>
  join(source === 'bundled' ? paths().seedRoot : paths().dshVersions, version)

/** Absolute path of the harness package inside a version directory. */
const packageDirectory = (root: string): string =>
  join(root, 'node_modules', ...containerConfig().dshPackage.split('/'))

/** Absolute path of the harness CLI entry point inside a version directory. */
const entryPoint = (root: string): string => join(packageDirectory(root), 'lib', 'bin.js')

/**
 * Read a version directory's metadata.
 * @param root - Absolute version directory.
 * @returns The declared version when the directory is a complete install.
 */
const inspect = (root: string): string | undefined => {
  try {
    if (!existsSync(entryPoint(root))) return undefined
    const manifest = JSON.parse(readFileSync(join(packageDirectory(root), 'package.json'), 'utf8')) as { version?: string }
    return manifest.version
  } catch {
    return undefined
  }
}

/** The version packaged into application resources, when one was prepared. */
export const bundledVersion = (): string | undefined => inspect(paths().seedRoot)

/**
 * Every version this container can start, newest first.
 * @returns Bundled and user-installed versions, de-duplicated by version.
 */
export const listInstalled = (): InstalledVersion[] => {
  const found = new Map<string, InstalledVersion>()
  const seed = bundledVersion()
  if (seed !== undefined) found.set(seed, { version: seed, source: 'bundled', root: paths().seedRoot })
  let entries: string[] = []
  try {
    entries = readdirSync(paths().dshVersions)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (name.startsWith('.') || name.includes('.staging-')) continue
    const root = join(paths().dshVersions, name)
    const version = inspect(root)
    if (version === undefined) continue
    // A user-installed copy of the bundled version is what activation selects, so it wins.
    found.set(version, { version, source: 'installed', root })
  }
  return [...found.values()].sort((left, right) => semver.rcompare(left.version, right.version))
}

/**
 * Resolve where a version lives.
 * @param version - Exact version to locate.
 * @returns Its directory and origin, or `undefined` when it is not available.
 */
export const resolveVersion = (version: string): InstalledVersion | undefined =>
  listInstalled().find((candidate) => candidate.version === version)

/**
 * Resolve the CLI entry point of a version.
 * @param version - Exact version to locate.
 * @returns Absolute path of `bin.js`, or `undefined` when the version is missing.
 */
export const entryFor = (version: string): string | undefined => {
  const resolved = resolveVersion(version)
  return resolved === undefined ? undefined : entryPoint(resolved.root)
}

/** One line of package-manager output. */
export type PackageLog = (text: string) => void

/**
 * Install one published version into user data.
 *
 * The package manager writes into a staging directory that is renamed into
 * place only after the CLI entry point exists, so an interrupted transfer
 * leaves no version that could be activated.
 * @param version - Exact published version.
 * @param log - Receives package-manager output.
 * @param signal - Cancels the install; staging is removed on cancellation.
 * @returns Completion once the version is available.
 */
export const installVersion = async (version: string, log: PackageLog, signal?: AbortSignal): Promise<void> => {
  if (semver.valid(version) === null) throw new Error(`not a valid version: ${version}`)
  if (resolveVersion(version) !== undefined) return
  const target = join(paths().dshVersions, version)
  const staging = `${target}.staging-${String(process.pid)}`
  rmSync(staging, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const manager = packageManager()
  const args = [
    ...manager.argsPrefix,
    'install',
    '--prefix',
    staging,
    '--no-audit',
    '--no-fund',
    '--loglevel',
    'error',
    `${containerConfig().dshPackage}@${version}`,
  ]
  log(`running ${manager.source} package manager: npm install ${containerConfig().dshPackage}@${version}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(manager.command, args, {
        cwd: staging,
        env: packageEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(signal === undefined ? {} : { signal }),
      })
      child.stdout?.on('data', (chunk: Buffer) => { log(chunk.toString()) })
      child.stderr?.on('data', (chunk: Buffer) => { log(chunk.toString()) })
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`npm exited with code ${String(code)}`))
      })
    })
    if (inspect(staging) === undefined) throw new Error('installed package has no CLI entry point')
    mkdirSync(paths().dshVersions, { recursive: true })
    renameSync(staging, target)
    log(`installed dsh ${version}`)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * Delete a version installed in user data.
 * @param version - Exact version to delete.
 * @throws When the version is the bundled one or is not installed by this container.
 */
export const removeVersion = (version: string): void => {
  const resolved = resolveVersion(version)
  if (resolved === undefined) throw new Error(`dsh ${version} is not installed`)
  if (resolved.source === 'bundled') throw new Error('the bundled dsh version cannot be deleted')
  rmSync(resolved.root, { recursive: true, force: true })
}
