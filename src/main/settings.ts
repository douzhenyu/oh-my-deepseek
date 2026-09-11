/**
 * Persisted container settings.
 * @module main/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ContainerSettings, SettingsPatch } from '../shared/types.ts'
import { containerConfig } from './config.ts'
import { paths } from './paths.ts'

/** Settings used when nothing has been stored yet. */
export const defaultSettings = (): ContainerSettings => ({
  port: containerConfig().defaultPort,
  autoStart: true,
  checkUpdatesOnLaunch: true,
})

let cache: ContainerSettings | undefined

const settingsFile = (): string => join(paths().userData, 'settings.json')

/**
 * Read settings, merging stored values over the defaults.
 * @returns The effective settings.
 */
export const loadSettings = (): ContainerSettings => {
  if (cache !== undefined) return cache
  const defaults = defaultSettings()
  try {
    const stored = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<ContainerSettings>
    cache = {
      ...defaults,
      ...stored,
      port: typeof stored.port === 'number' && Number.isInteger(stored.port) && stored.port >= 0 && stored.port <= 65535
        ? stored.port
        : defaults.port,
    }
  } catch {
    cache = defaults
  }
  return cache
}

/**
 * Merge a patch into the stored settings and write them back atomically.
 * @param patch - Fields to change; absent fields keep their current value.
 * @returns The settings after the patch.
 */
export const updateSettings = (patch: SettingsPatch): ContainerSettings => {
  const next: ContainerSettings = { ...loadSettings(), ...patch }
  cache = next
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
  return next
}
