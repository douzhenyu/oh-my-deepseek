/**
 * Download and prepare the upstream Node.js runtime that ships with the app.
 *
 * The container carries its own Node.js so a user never needs one, and so the
 * harness never runs under Electron's patched Node.js. The archive is verified
 * against the release's published SHA-256 list before it is extracted.
 *
 * Usage:
 *   node scripts/fetch-node.mjs                 # host target
 *   node scripts/fetch-node.mjs mac-arm64 win-x64
 */

import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { at, config, exists, hostTarget, nodeArchive, TARGETS } from './lib/config.mjs'

/** Run a command and capture its output, failing on a non-zero exit. */
const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim() || stdout.trim()}`))
    })
  })

/** Fetch a URL into memory, rejecting non-2xx responses. */
const download = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} responded ${response.status} ${response.statusText}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Download, verify, and extract one target's Node.js runtime.
 * @param {import('./lib/config.mjs').Target} target - Target to prepare.
 */
const prepare = async (target) => {
  const { folder, archive, releaseRoot } = nodeArchive(target, config.nodeVersion)
  const destination = at('resources', 'node', `${target.platform}-${target.arch}`)

  if (exists(destination) && exists(join(destination, target.platform === 'win32' ? 'node.exe' : join('bin', 'node')))) {
    console.log(`${target.label}: already prepared at resources/node/${target.platform}-${target.arch}`)
    return
  }

  console.log(`${target.label}: downloading Node.js ${config.nodeVersion}`)
  const sums = (await download(`${releaseRoot}/SHASUMS256.txt`)).toString('utf8')
  const expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === archive)?.[0]
  if (expected === undefined) throw new Error(`no SHA-256 entry for ${archive}`)

  const buffer = await download(`${releaseRoot}/${archive}`)
  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== expected) throw new Error(`${archive} failed verification: expected ${expected}, got ${actual}`)
  console.log(`${target.label}: verified ${archive} (${(buffer.length / 1024 / 1024).toFixed(1)} MiB)`)

  const scratch = await mkdtemp(join(tmpdir(), 'ohmydeepseek-node-'))
  try {
    const archivePath = join(scratch, archive)
    await pipeline(Readable.from(buffer), createWriteStream(archivePath))
    if (target.platform === 'win32' && process.platform === 'win32') {
      await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${scratch}' -Force`])
    } else if (target.platform === 'win32') {
      // A Windows runtime can be prepared from macOS or Linux, so the zip is
      // extracted with whatever the host provides rather than with PowerShell.
      try {
        await run('unzip', ['-q', archivePath, '-d', scratch])
      } catch (error) {
        if (process.platform !== 'darwin') throw error
        await run('ditto', ['-x', '-k', archivePath, scratch])
      }
    } else {
      await run('tar', ['-xzf', archivePath, '-C', scratch])
    }
    const extracted = join(scratch, folder)
    await stat(extracted)
    await rm(destination, { recursive: true, force: true })
    await mkdir(join(destination, '..'), { recursive: true })
    await rename(extracted, destination)
    const nodeBinary = join(destination, target.platform === 'win32' ? 'node.exe' : join('bin', 'node'))
    await chmod(nodeBinary, 0o755)
    const npmManifest = join(destination, target.platform === 'win32' ? 'node_modules' : join('lib', 'node_modules'), 'npm', 'package.json')
    if (!exists(npmManifest)) throw new Error(`the extracted runtime has no bundled npm at ${npmManifest}`)
    const sameHost = target.platform === process.platform && target.arch === process.arch
    if (sameHost) {
      const reported = await run(nodeBinary, ['--version'])
      if (reported !== `v${config.nodeVersion}`) throw new Error(`prepared runtime reports ${reported}, expected v${config.nodeVersion}`)
      console.log(`${target.label}: prepared at resources/node/${target.platform}-${target.arch} (${reported})`)
    } else {
      // A foreign-platform binary cannot be executed here; its presence and the
      // bundled package manager are what the build actually depends on.
      const size = (await stat(nodeBinary)).size
      console.log(`${target.label}: prepared at resources/node/${target.platform}-${target.arch} (${basename(nodeBinary)}, ${(size / 1024 / 1024).toFixed(1)} MiB, not executable on ${process.platform})`)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
const targets = requested.length > 0
  ? requested.map((id) => {
      const target = TARGETS[id]
      if (target === undefined) throw new Error(`unknown target ${id}; expected one of ${Object.keys(TARGETS).join(', ')}`)
      return target
    })
  : [hostTarget() ?? (() => { throw new Error(`no default target for ${process.platform}-${process.arch}`) })()]

for (const target of targets) await prepare(target)
