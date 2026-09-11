/**
 * Locate the Node.js and npm executables used by the build scripts.
 *
 * The build prefers the runtime prepared in `resources/node/`, exactly as the
 * packaged application does, and falls back to the host's own tooling so a
 * developer can prepare an application before any runtime has been downloaded.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { at, config } from './config.mjs'

/** Absolute path of a prepared Node.js executable for a target. */
export const nodeBinary = (target) =>
  at('resources', 'node', `${target.platform}-${target.arch}`, target.platform === 'win32' ? 'node.exe' : join('bin', 'node'))

/** Absolute path of the `npm-cli.js` inside a prepared Node.js runtime. */
export const npmCli = (target) =>
  at(
    'resources',
    'node',
    `${target.platform}-${target.arch}`,
    target.platform === 'win32' ? join('node_modules', 'npm', 'bin', 'npm-cli.js') : join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  )

/**
 * The command that runs npm for a target.
 * @param {import('./config.mjs').Target} target - Target whose runtime should install packages.
 * @returns {{ command: string, argsPrefix: string[], source: 'bundled' | 'system' }}
 */
export const packageManager = (target) => {
  if (existsSync(nodeBinary(target)) && existsSync(npmCli(target))) {
    return { command: nodeBinary(target), argsPrefix: [npmCli(target)], source: 'bundled' }
  }
  console.log(`${target.label}: no prepared Node.js runtime; falling back to the host npm`)
  return { command: 'npm', argsPrefix: [], source: 'system' }
}

/** Environment that keeps a build-time install out of the developer's own npm state. */
export const packageEnvironment = () => ({
  ...process.env,
  npm_config_cache: at('.build', 'npm-cache'),
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
  npm_config_progress: 'false',
  npm_config_loglevel: 'error',
  npm_config_node_version: config.nodeVersion,
})
