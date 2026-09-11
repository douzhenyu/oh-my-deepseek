/**
 * Package-registry version discovery.
 * @module main/registry
 */

import semver from 'semver'
import type { RemoteVersion } from '../shared/types.ts'
import { containerConfig } from './config.ts'

/** Published versions and the registry's own tags for the harness package. */
export interface RegistryListing {
  /** Versions newest first, each annotated with the tags naming it. */
  versions: RemoteVersion[]
  /** Version the `latest` tag names, when the registry reports one. */
  latest?: string
}

/** Newest versions returned; the registry keeps every prerelease ever published. */
const LIMIT = 80

/**
 * Fetch published harness versions from the configured registry.
 * @param signal - Cancels the request when the launch attempt is abandoned.
 * @returns Versions newest first.
 * @throws When the registry is unreachable or answers with an error status.
 */
export const fetchVersions = async (signal?: AbortSignal): Promise<RegistryListing> => {
  const { dshPackage, registry } = containerConfig()
  const response = await fetch(`${registry}/${dshPackage.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`registry responded ${response.status} ${response.statusText}`)
  const body = (await response.json()) as { versions?: Record<string, unknown>; 'dist-tags'?: Record<string, string> }
  const tagsByVersion = new Map<string, string[]>()
  for (const [tag, version] of Object.entries(body['dist-tags'] ?? {})) {
    const tags = tagsByVersion.get(version) ?? []
    tags.push(tag)
    tagsByVersion.set(version, tags)
  }
  const versions = Object.keys(body.versions ?? {})
    .filter((version) => semver.valid(version) !== null)
    .sort((left, right) => semver.rcompare(left, right))
    .slice(0, LIMIT)
    .map((version) => ({ version, tags: tagsByVersion.get(version) ?? [] }))
  const latest = body['dist-tags']?.latest
  return { versions, ...(latest === undefined ? {} : { latest }) }
}
