/**
 * Which harness home this client uses.
 *
 * The harness keeps every piece of user data under one root — credentials,
 * settings, skills, storages, and sessions. There is no supported way to share
 * credentials while keeping sessions apart, so the container offers two whole
 * -root modes instead:
 *
 * - `shared`: the same root as the `dsh` command line, so both see one history
 *   and one set of credentials. The cost is inherent to dsh's design: a session
 *   is guarded by a kernel write lease held for as long as a write handle is
 *   open, so while one server has a conversation open, the other cannot resume
 *   it and reports `SessionAlreadyOwnedError`. The lease is released when the
 *   holding process exits, and it is never expropriated on a timer, because a
 *   stalled writer that resumed appends would tear the session log.
 * - `separate`: this client's own root under its user data directory. No session
 *   is ever contended, at the cost of the two sides no longer sharing history.
 *   Credentials, settings, and skills are copied once from the shared root so the
 *   client still works without re-authentication.
 * @module main/harness-home
 */

import { chmodSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HarnessHomeMode } from '../shared/types.ts'
import { paths } from './paths.ts'

/**
 * The root the `dsh` command line uses.
 *
 * This mirrors the harness's own precedence: `$DSH_HOME`, then `~/.dsh`.
 * @returns The absolute shared root, not necessarily existing yet.
 */
export const sharedHome = (): string => {
  const configured = process.env['DSH_HOME']
  return configured === undefined || configured.trim() === '' ? join(homedir(), '.dsh') : configured
}

/**
 * This client's own root.
 * @returns An absolute path under the container's user data directory.
 */
export const separateHome = (): string => join(paths().userData, 'harness-home')

/**
 * The home a mode selects.
 * @param mode - `shared` or `separate`.
 * @returns The absolute root.
 */
export const homeForMode = (mode: HarnessHomeMode): string => (mode === 'separate' ? separateHome() : sharedHome())

/**
 * Entries copied into a fresh separate home. Sessions, workspaces, and storages
 * are deliberately excluded: those are the state that would otherwise be
 * contended or duplicated.
 */
const SEEDED_ENTRIES = [
  { name: '.credentials.yaml', mode: 0o600 },
  { name: 'settings.yaml' },
  { name: 'skills' },
  { name: '.anonymous-user-id' },
]

/**
 * Copy the credentials, settings, and skills a first run needs.
 *
 * Nothing is overwritten: an entry that already exists in the separate home is
 * left exactly as it is, so this never reverts a change the user made there.
 * @param log - Receives one line per copied or skipped entry.
 * @returns The directory that was prepared.
 */
export const seedSeparateHome = (log: (text: string) => void): string => {
  const source = sharedHome()
  const target = separateHome()
  if (resolve(source) === resolve(target)) return target
  mkdirSync(target, { recursive: true, mode: 0o700 })
  log(`preparing an independent harness home at ${target}`)
  for (const entry of SEEDED_ENTRIES) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (!existsSync(from)) continue
    if (existsSync(to)) {
      log(`kept the existing ${entry.name}`)
      continue
    }
    try {
      cpSync(from, to, { recursive: true })
      if (entry.mode !== undefined) chmodSync(to, entry.mode)
      log(`copied ${entry.name} from ${source}`)
    } catch (error) {
      log(`could not copy ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return target
}

/**
 * The mode a stored override represents.
 * @param dshHome - The configured override, absent when the shared root applies.
 * @returns `separate` when any override is set, otherwise `shared`.
 */
export const modeOf = (dshHome: string | undefined): HarnessHomeMode =>
  dshHome === undefined || dshHome === '' ? 'shared' : 'separate'
