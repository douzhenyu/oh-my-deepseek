/**
 * Publish the built installers as GitHub Releases.
 *
 * One release per version carries every platform's installer. The platforms
 * differ in ways a user has to know before downloading — the macOS build carries
 * dsh inside it and works offline, while the Windows build installs dsh on first
 * launch — so the notes lead with a per-platform table rather than burying the
 * distinction. Tags are the plain version so that "Latest release" means the
 * version, not whichever platform happened to be published last.
 *
 * The script is idempotent: an existing release for a tag is reused, and an asset
 * whose name is already attached is left alone. Re-running after a partial upload
 * therefore finishes the job instead of failing.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> node scripts/publish-release.mjs --metadata
 *   GITHUB_TOKEN=<token> node scripts/publish-release.mjs v0.1.0-macos-arm64
 *   GITHUB_TOKEN=<token> node scripts/publish-release.mjs          # every target
 *   node scripts/publish-release.mjs --dry-run                     # check the plan, no token
 *
 * The token needs write access to repository contents (classic `repo` scope, or a
 * fine-grained token with "Contents: Read and write").
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { at } from './lib/config.mjs'

/** Published version, taken from the manifest electron-builder names artifacts after. */
const version = JSON.parse(readFileSync(at('package.json'), 'utf8')).version

/** Owner and repository the releases are published to. */
const OWNER = 'douzhenyu'
const REPO = 'oh-my-deepseek'

/** Repository description applied by `--metadata`. */
const DESCRIPTION =
  'Unofficial cross-platform desktop container for DeepSeek Harness (dsh) — open and use, no terminal; install, switch and update dsh versions in-app; the backend stops when you close the window.'

/** Repository topics applied by `--metadata`. */
const TOPICS = ['deepseek', 'deepseek-harness', 'dsh', 'electron', 'desktop-app', 'macos', 'windows', 'ai-agent']

/**
 * One published release: its tag, the notes file, and every artifact it carries.
 * Paths are relative to the repository root.
 */
const RELEASES = [
  {
    tag: `v${version}`,
    name: `oh-my-deepseek ${version}`,
    notes: `release-notes/v${version}.md`,
    artifacts: [
      `.build/mac-arm64/oh-my-deepseek-${version}-mac-arm64.dmg`,
      `.build/mac-arm64/oh-my-deepseek-${version}-mac-arm64.zip`,
      `.build/win-x64/oh-my-deepseek-${version}-win-x64.exe`,
    ],
  },
]

const dryRun = process.argv.includes('--dry-run')
const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
if (!dryRun && (token === undefined || token.trim() === '')) {
  console.error('missing GITHUB_TOKEN (needs write access to repository contents)')
  process.exit(2)
}

/** Call the GitHub REST API, returning the parsed body. */
const api = async (method, path, body, contentType = 'application/json') => {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'oh-my-deepseek-release',
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': contentType }),
    },
    ...(body === undefined ? {} : { body }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${response.statusText}: ${text.slice(0, 400)}`)
  return text === '' ? undefined : JSON.parse(text)
}

/** Upload one file as a release asset. Reads the file whole so the request carries a Content-Length. */
const uploadAsset = async (releaseId, file) => {
  const name = basename(file)
  const payload = readFileSync(file)
  const response = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'oh-my-deepseek-release',
      'content-type': name.endsWith('.dmg') ? 'application/x-apple-diskimage' : 'application/octet-stream',
    },
    body: payload,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`upload ${name} -> ${response.status} ${response.statusText}: ${text.slice(0, 400)}`)
  const asset = JSON.parse(text)
  const size = (asset.size / 1024 / 1024).toFixed(1)
  console.log(`    uploaded ${name} (${size} MB, state: ${asset.state})`)
}

/** Apply the repository description and topics. */
const applyMetadata = async () => {
  console.log('updating repository metadata')
  await api('PATCH', `/repos/${OWNER}/${REPO}`, JSON.stringify({ description: DESCRIPTION, has_issues: true, has_wiki: false }))
  await api('PUT', `/repos/${OWNER}/${REPO}/topics`, JSON.stringify({ names: TOPICS }))
  console.log(`  description: ${DESCRIPTION}`)
  console.log(`  topics: ${TOPICS.join(', ')}`)
}

/**
 * Publish one release.
 * @param target - Entry from {@link RELEASES}.
 * @returns Whether the release was published.
 */
const publish = async (target) => {
  const missing = target.artifacts.filter((file) => !existsSync(at(file)))
  console.log(`\n${target.tag}`)
  for (const file of target.artifacts) {
    const mark = existsSync(at(file)) ? 'ok  ' : 'MISS'
    const size = existsSync(at(file)) ? `${(statSync(at(file)).size / 1024 / 1024).toFixed(1)} MB` : ''
    console.log(`  ${mark} ${basename(file)} ${size}`)
  }
  if (missing.length > 0) {
    console.log('  skipped: build every artifact first (npm run package:mac:arm64 / package:win:x64)')
    return false
  }

  const body = readFileSync(at(target.notes), 'utf8')
  let release
  try {
    release = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${target.tag}`)
    console.log(`  reusing the existing release (id ${release.id})`)
  } catch {
    release = await api(
      'POST',
      `/repos/${OWNER}/${REPO}/releases`,
      JSON.stringify({ tag_name: target.tag, name: target.name, body, draft: false, prerelease: false }),
    )
    console.log(`  created release (id ${release.id}) for tag ${target.tag}`)
  }

  const attached = new Set((release.assets ?? []).map((asset) => asset.name))
  for (const file of target.artifacts) {
    const name = basename(file)
    if (attached.has(name)) {
      console.log(`    ${name} is already attached`)
      continue
    }
    await uploadAsset(release.id, at(file))
  }
  console.log(`  ${release.html_url}`)
  return true
}

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))

if (dryRun) {
  console.log(`dry run: ${OWNER}/${REPO} at version ${version}`)
  for (const release of RELEASES) {
    console.log(`\n${release.tag}  (${release.name})`)
    console.log(`  notes: ${release.notes} ${existsSync(at(release.notes)) ? '' : '<- MISSING'}`)
    let total = 0
    for (const file of release.artifacts) {
      const present = existsSync(at(file))
      if (present) total += statSync(at(file)).size
      console.log(`  ${present ? 'ok  ' : 'MISS'} ${basename(file)}${present ? ` (${(statSync(at(file)).size / 1024 / 1024).toFixed(1)} MB)` : ''}`)
    }
    console.log(`  total upload: ${(total / 1024 / 1024).toFixed(1)} MB`)
  }
  process.exit(0)
}

if (process.argv.includes('--metadata')) await applyMetadata()

const selected = requested.length === 0 ? RELEASES : RELEASES.filter((release) => requested.includes(release.tag))
if (selected.length === 0) throw new Error(`unknown tag; expected one of ${RELEASES.map((release) => release.tag).join(', ')}`)

let published = 0
for (const release of selected) {
  if (await publish(release)) published += 1
}
console.log(`\n${String(published)}/${String(selected.length)} release(s) published to https://github.com/${OWNER}/${REPO}/releases`)
if (published === 0) process.exit(1)
