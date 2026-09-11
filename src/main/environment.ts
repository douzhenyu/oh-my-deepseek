/**
 * Environment for the harness backend process.
 *
 * A GUI application on macOS is started by launchd, not by a login shell, so it
 * inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Anything the user installed
 * outside those directories is then invisible to the harness: on this machine
 * Homebrew's `ffmpeg` exists, yet a Finder-launched container reported it missing
 * and even suggested `brew install ffmpeg` — a command that is itself not on that
 * PATH. The same applies to `rg`, `node` from nvm, MacPorts, and `~/.local/bin`.
 *
 * The fix is to add the standard user-tool directories ahead of the inherited
 * PATH, matching the order a login shell produces, so a GUI launch resolves tools
 * the way the user's terminal does. Directories that do not exist are not added,
 * so the resulting PATH does not accumulate dead entries, and nothing is ever
 * removed from the inherited PATH.
 * @module main/environment
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Absolute directories that commonly hold user-installed tools, in the order a
 * login shell would prefer them. Apple Silicon Homebrew comes first because its
 * installer puts it ahead of `/usr/bin` in the shell's PATH.
 */
const ABSOLUTE_TOOL_DIRECTORIES = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/opt/local/bin',
  '/opt/local/sbin',
]

/** Tool directories under the user's home, relative to it. */
const HOME_TOOL_DIRECTORIES = [
  '.local/bin',
  'bin',
  '.cargo/bin',
  '.bun/bin',
  '.deno/bin',
  '.volta/bin',
  '.npm-global/bin',
]

/**
 * Whether a path is an existing directory.
 * @param path - Absolute path to test.
 * @returns `true` when the path exists and is a directory.
 */
const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Build the PATH the harness should run with.
 *
 * Windows GUI processes already inherit the user's PATH from the environment, so
 * only the POSIX platforms need augmentation.
 * @param inherited - The PATH from the container's own environment.
 * @param home - Home directory to expand the home-relative entries against.
 * @returns A PATH with the existing user-tool directories ahead of the inherited one.
 */
export const toolPath = (inherited: string | undefined, home: string = homedir()): string => {
  const entries = (inherited ?? '').split(':').filter((entry) => entry !== '')
  if (process.platform === 'win32') return entries.join(':')
  const candidates = [...ABSOLUTE_TOOL_DIRECTORIES, ...HOME_TOOL_DIRECTORIES.map((relative) => join(home, relative))]
  const additions = candidates.filter((directory) => isDirectory(directory) && !entries.includes(directory))
  return [...additions, ...entries].join(':')
}

/**
 * Build the environment for the backend process.
 *
 * The harness must never inherit Electron's own runtime switches, and it gets the
 * augmented PATH so its tools behave as they do in a terminal.
 * @param inherited - Environment to base the result on.
 * @param overrides - Entries to set or replace, such as `DSH_HOME`.
 * @returns The environment to spawn the backend with.
 */
export const backendEnvironment = (
  inherited: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...inherited, ...overrides }
  environment['PATH'] = toolPath(inherited['PATH'])
  delete environment['ELECTRON_RUN_AS_NODE']
  delete environment['NODE_OPTIONS']
  return environment
}
