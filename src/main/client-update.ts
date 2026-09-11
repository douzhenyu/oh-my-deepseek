/**
 * In-app updates for the client itself, as opposed to the harness versions the
 * container manages separately.
 *
 * Releases are read from the public GitHub Releases API, so a check needs no
 * credentials and works for anyone running a build. Two platform facts shape
 * what "update" can mean here:
 *
 * - **Windows**: the release carries an NSIS installer, so the container can
 *   download it, launch it, and quit to let it replace the files. That is a real
 *   one-click update and it does not require code signing.
 * - **macOS**: a silent in-place update is not available to an unsigned build.
 *   Squirrel.Mac — what `electron-updater` drives — requires the running app to
 *   be signed and the replacement to carry a matching signature, and these
 *   builds are deliberately unsigned. Downloading and then handing the disk
 *   image to the user is the honest path; it cannot break a working install.
 *
 * The check, the asset choice, and the download are shared by both, so enabling
 * a signed updater later only replaces {@link installRelease}.
 * @module main/client-update
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { app, shell } from 'electron'
import semver from 'semver'

/** Repository whose releases carry client builds. */
const REPOSITORY = 'douzhenyu/oh-my-deepseek'

/** How the current platform can apply a downloaded release. */
export type InstallMode =
  /** The release is an installer that can run and replace the application. */
  | 'installer'
  /** The release must be applied by the user. */
  | 'manual'

/** One downloadable file attached to a release. */
export interface ReleaseAsset {
  /** File name, which encodes the platform and architecture. */
  name: string
  /** Direct download URL. */
  url: string
  /** Size in bytes as reported by the release. */
  size: number
}

/** A published client release. */
export interface ClientRelease {
  /** Version without the tag prefix, for example `0.1.1`. */
  version: string
  /** Git tag, for example `v0.1.1`. */
  tag: string
  /** Release title. */
  name: string
  /** Release notes as Markdown. */
  notes: string
  /** Human-facing release page. */
  pageUrl: string
  /** The asset this platform would install, absent when the release has none. */
  asset?: ReleaseAsset
}

/**
 * The asset name suffix this platform installs from.
 *
 * The release publishes `<name>-mac-arm64.dmg`, `<name>-mac-x64.dmg`, and
 * `<name>-win-x64.exe`, so the platform and architecture are encoded in the
 * file name and are what the container matches on.
 * @param platform - A Node platform name.
 * @param arch - A Node architecture name.
 * @returns The suffix to look for, or `undefined` on an unsupported platform.
 */
export const assetSuffix = (platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined => {
  if (platform === 'darwin') return arch === 'x64' ? '-mac-x64.dmg' : '-mac-arm64.dmg'
  if (platform === 'win32') return arch === 'arm64' ? '-win-arm64.exe' : '-win-x64.exe'
  return undefined
}

/**
 * How this platform applies a downloaded release.
 * @param platform - A Node platform name.
 * @returns `installer` where the container can run the release itself.
 */
export const installMode = (platform: NodeJS.Platform = process.platform): InstallMode =>
  platform === 'win32' ? 'installer' : 'manual'

/** Strip a leading `v` from a tag. @param tag - A git tag. */
const versionOf = (tag: string): string => tag.replace(/^v/, '')

/**
 * Read the newest published release.
 * @param signal - Cancels the request.
 * @returns The release, with the asset this platform would install when present.
 * @throws When the repository has no releases, the API refuses, or the network fails.
 */
export const checkForUpdate = async (signal?: AbortSignal): Promise<ClientRelease> => {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'oh-my-deepseek-client' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status === 404) throw new Error('the release repository has no published release yet')
  if (response.status === 403) throw new Error('the GitHub API rate limit was reached; try again later')
  if (!response.ok) throw new Error(`release lookup failed with ${response.status} ${response.statusText}`)
  const body = (await response.json()) as {
    tag_name?: string
    name?: string
    body?: string
    html_url?: string
    assets?: { name?: string; browser_download_url?: string; size?: number }[]
  }
  const tag = body.tag_name
  if (tag === undefined) throw new Error('the newest release has no tag')
  const suffix = assetSuffix()
  const match = suffix === undefined
    ? undefined
    : body.assets?.find((asset) => asset.name?.endsWith(suffix) === true && asset.browser_download_url !== undefined)
  return {
    version: versionOf(tag),
    tag,
    name: body.name ?? tag,
    notes: body.body ?? '',
    pageUrl: body.html_url ?? `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
    ...(match?.name === undefined || match.browser_download_url === undefined
      ? {}
      : { asset: { name: match.name, url: match.browser_download_url, size: match.size ?? 0 } }),
  }
}

/**
 * Whether a release is newer than the running application.
 * @param release - A published version.
 * @param current - The running version.
 * @returns `true` when the release should be offered.
 */
export const isNewer = (release: string, current: string): boolean =>
  semver.valid(release) !== null && semver.valid(current) !== null && semver.gt(release, current)

/**
 * Where a downloaded release is written.
 *
 * The user's downloads folder is the right place for a file they may have to
 * open by hand, which is exactly what the macOS path asks of them.
 * @returns An absolute directory that exists.
 */
export const downloadDirectory = (): string => {
  try {
    const directory = app.getPath('downloads')
    if (existsSync(directory)) return directory
  } catch {
    // A headless or unusual profile can have no downloads folder.
  }
  const fallback = join(app.getPath('userData'), 'updates')
  mkdirSync(fallback, { recursive: true })
  return fallback
}

/** Reports download progress as a fraction of the total, when the total is known. */
export type DownloadProgress = (receivedBytes: number, totalBytes: number) => void

/**
 * Download one release asset.
 *
 * The bytes land in a `.part` file that is renamed only after the transfer
 * completes and matches the size the release advertised, so a half-written file
 * can never be offered for installation.
 * @param release - Release whose asset should be fetched.
 * @param onProgress - Receives transfer progress.
 * @param signal - Cancels the transfer.
 * @returns The absolute path of the downloaded file.
 * @throws When the release has no asset for this platform or the transfer fails.
 */
export const downloadRelease = async (
  release: ClientRelease,
  onProgress: DownloadProgress,
  signal?: AbortSignal,
): Promise<string> => {
  const asset = release.asset
  if (asset === undefined) throw new Error(`release ${release.tag} has no build for ${process.platform}-${process.arch}`)
  const directory = downloadDirectory()
  const target = join(directory, asset.name)
  const partial = `${target}.part`
  rmSync(partial, { force: true })
  const response = await fetch(asset.url, {
    redirect: 'follow',
    headers: { 'user-agent': 'oh-my-deepseek-client' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok || response.body === null) throw new Error(`download failed with ${response.status} ${response.statusText}`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  const total = declared > 0 ? declared : asset.size
  const reader = response.body.getReader()
  const handle = await open(partial, 'w')
  let received = 0
  let lastReport = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      await handle.write(value)
      received += value.byteLength
      const now = Date.now()
      if (now - lastReport > 120) {
        lastReport = now
        onProgress(received, total)
      }
    }
  } catch (error) {
    await handle.close()
    rmSync(partial, { force: true })
    throw error
  }
  await handle.close()
  if (total > 0 && received !== total) {
    rmSync(partial, { force: true })
    throw new Error(`the download stopped at ${String(received)} of ${String(total)} bytes`)
  }
  renameSync(partial, target)
  onProgress(received, total)
  return target
}

/**
 * Apply a downloaded release.
 *
 * Windows starts the installer and expects the caller to quit so it can replace
 * the application. macOS opens the disk image, because an unsigned build cannot
 * be replaced in place.
 * @param file - Absolute path of the downloaded release.
 * @returns What was done, so the caller can explain it.
 */
export const installRelease = async (file: string): Promise<InstallMode> => {
  if (!existsSync(file)) throw new Error(`the downloaded file is gone: ${file}`)
  if (installMode() === 'installer') {
    const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return 'installer'
  }
  await shell.openPath(file)
  return 'manual'
}

/**
 * Reveal a downloaded file in the platform file manager.
 * @param file - Absolute path of the downloaded release.
 */
export const revealRelease = (file: string): void => {
  shell.showItemInFolder(file)
}

/**
 * Size of a downloaded file in bytes, or `0` when it is missing.
 * @param file - Absolute path to measure.
 */
export const sizeOf = (file: string): number => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Open a release's page in the default browser.
 * @param url - Release page URL.
 */
export const openReleasePage = async (url: string): Promise<void> => {
  await shell.openExternal(url)
}
