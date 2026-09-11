/**
 * Prepare the dsh version bundled into the application.
 *
 * A packaged container must work on first launch with no network access, so one
 * dsh version is installed at build time and shipped read-only in application
 * resources. The app treats it as the `bundled` version: it can be activated,
 * but never updated in place — updates always install into user data.
 *
 * This installs for the host platform and architecture only. Prepare the
 * Windows seed on Windows; a macOS seed contains macOS native modules.
 *
 * Usage:
 *   node scripts/prepare-seed.mjs
 *   node scripts/prepare-seed.mjs --version 0.1.5-rc.2
 *   node scripts/prepare-seed.mjs --force
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { at, config, hostTarget } from './lib/config.mjs'
import { packageEnvironment, packageManager } from './lib/npm.mjs'

/** Read a named switch's value. */
const value = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const version = value('--version') ?? config.dshSeedVersion
const force = process.argv.includes('--force')
const target = hostTarget()
if (target === undefined) throw new Error(`cannot prepare a seed on ${process.platform}-${process.arch}`)

const root = at('resources', 'dsh-seed')
// A seed contains platform-specific native modules. The marker is what stops a
// macOS seed from being packaged into a Windows installer.
const marker = join(root, 'seed.json')
const entry = join(root, 'node_modules', ...config.dshPackage.split('/'), 'lib', 'bin.js')
const manifest = join(root, 'node_modules', ...config.dshPackage.split('/'), 'package.json')

if (!force && existsSync(entry) && existsSync(marker)) {
  const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
  const recorded = JSON.parse(readFileSync(marker, 'utf8'))
  if (installed === version && recorded.platform === target.platform && recorded.arch === target.arch) {
    console.log(`${target.label}: seed dsh ${version} already prepared`)
    process.exit(0)
  }
  console.log(`${target.label}: replacing seed dsh ${installed} (${recorded.platform}-${recorded.arch}) with ${version}`)
}

rmSync(root, { recursive: true, force: true })
const manager = packageManager(target)
const args = [
  ...manager.argsPrefix,
  'install',
  '--prefix',
  root,
  '--no-audit',
  '--no-fund',
  '--loglevel',
  'error',
  `${config.dshPackage}@${version}`,
]
console.log(`${target.label}: installing ${config.dshPackage}@${version} with the ${manager.source} package manager`)

await new Promise((resolve, reject) => {
  const child = spawn(manager.command, args, {
    cwd: at('.'),
    env: packageEnvironment(),
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', reject)
  child.once('close', (code) => { code === 0 ? resolve() : reject(new Error(`npm exited with ${code}`)) })
})

if (!existsSync(entry)) throw new Error(`the seed install produced no CLI entry point at ${entry}`)
const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
if (installed !== version) throw new Error(`the seed reports ${installed}, expected ${version}`)
writeFileSync(
  marker,
  `${JSON.stringify({ platform: target.platform, arch: target.arch, dshVersion: installed, nodeVersion: config.nodeVersion }, null, 2)}\n`,
  'utf8',
)
console.log(`${target.label}: seed dsh ${installed} prepared at resources/dsh-seed`)
