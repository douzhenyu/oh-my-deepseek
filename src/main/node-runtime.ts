/**
 * The bundled Node.js runtime and its package manager.
 *
 * The harness must never run under Electron's own Node.js: that binary carries
 * Electron patches, its own ABI, and a lifecycle that ends with the window.
 * Every harness and package-manager process therefore runs under an upstream
 * Node.js that ships with the application, and falls back to the developer's
 * `node`/`npm` only in an unpackaged development run.
 * @module main/node-runtime
 */

import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { containerConfig } from './config.ts'
import { paths } from './paths.ts'

/** A command to spawn plus the arguments that must precede the operation's own. */
export interface RuntimeCommand {
  /** Executable to spawn. */
  command: string
  /** Fixed leading arguments, for example the path of `npm-cli.js`. */
  argsPrefix: string[]
  /** Whether the executable came from application resources or the host system. */
  source: 'bundled' | 'system'
}

/** Absolute path of the bundled Node.js executable. */
const bundledNode = (): string => join(paths().nodeDir, process.platform === 'win32' ? 'node.exe' : join('bin', 'node'))

/** Absolute path of the bundled `npm-cli.js`, whose layout differs per platform archive. */
const bundledNpmCli = (): string =>
  join(
    paths().nodeDir,
    process.platform === 'win32' ? join('node_modules', 'npm', 'bin', 'npm-cli.js') : join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  )

/** Absolute path of Corepack's JavaScript entry inside the bundled Node runtime. */
const bundledCorepackCli = (): string =>
  join(
    paths().nodeDir,
    process.platform === 'win32'
      ? join('node_modules', 'corepack', 'dist', 'corepack.js')
      : join('lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
  )

/**
 * Whether a prepared Node.js runtime is present in application resources.
 * @returns `true` when the bundled executable exists.
 */
export const hasBundledNode = (): boolean => existsSync(bundledNode())

/**
 * Resolve the Node.js executable used to run the harness.
 * @returns The bundled runtime when prepared, otherwise the system `node`.
 */
export const nodeRuntime = (): RuntimeCommand => {
  if (hasBundledNode()) return { command: bundledNode(), argsPrefix: [], source: 'bundled' }
  return { command: 'node', argsPrefix: [], source: 'system' }
}

/**
 * Resolve the package manager used to install and update dsh.
 * @returns Bundled `npm` when a runtime is prepared, otherwise the system `npm`.
 */
export const packageManager = (): RuntimeCommand => {
  if (hasBundledNode() && existsSync(bundledNpmCli())) {
    return { command: bundledNode(), argsPrefix: [bundledNpmCli()], source: 'bundled' }
  }
  return { command: 'npm', argsPrefix: [], source: 'system' }
}

/**
 * Resolve the pnpm command used for Harness profile plugins.
 *
 * Corepack belongs to the same upstream Node distribution as the runtime, so
 * this works in a Finder launch and on Windows without a global pnpm install.
 */
export const profilePackageManager = (version: string): RuntimeCommand => {
  const runtime = nodeRuntime()
  const corepack = bundledCorepackCli()
  if (runtime.source === 'bundled' && existsSync(corepack)) {
    return { command: runtime.command, argsPrefix: [corepack, `pnpm@${version}`], source: 'bundled' }
  }
  return { command: 'corepack', argsPrefix: [`pnpm@${version}`], source: 'system' }
}

/**
 * Environment for a package operation.
 *
 * Cache, user configuration, and update checks are redirected into user data so
 * an install never reads or writes the developer's own npm state.
 * @returns Environment variables layered over the current process environment.
 */
export const packageEnvironment = (): NodeJS.ProcessEnv => {
  const runtime = nodeRuntime()
  return {
    ...process.env,
    PATH: runtime.source === 'bundled'
      ? [dirname(runtime.command), process.env['PATH']].filter(Boolean).join(delimiter)
      : process.env['PATH'],
    npm_config_cache: paths().npmCache,
    npm_config_userconfig: paths().npmUserConfig,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_progress: 'false',
    npm_config_loglevel: 'error',
    npm_config_node_version: containerConfig().nodeVersion,
    NODE_OPTIONS: '',
  }
}
