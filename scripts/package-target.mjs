/**
 * Package the container for one target.
 *
 * Usage:
 *   node scripts/package-target.mjs mac-arm64
 *   node scripts/package-target.mjs win-x64 --dir
 *   node scripts/package-target.mjs mac-arm64 --unsigned
 *
 * The bundled Node.js runtime is downloaded for the requested target, so a
 * cross-target build can prepare its runtime from any host. The bundled dsh
 * seed is different: it contains platform-specific native modules and is
 * therefore prepared only when the target matches the host. Cross-packaging
 * without a seed produces an application that installs dsh on first launch.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { at, hostTarget, TARGETS } from './lib/config.mjs'

const argv = process.argv.slice(2)
const targetId = argv.find((argument) => !argument.startsWith('-'))
const target = targetId === undefined ? hostTarget() : TARGETS[targetId]
if (target === undefined) {
  throw new Error(`specify a target: ${Object.keys(TARGETS).join(', ')} (or run on a supported host)`)
}

const outputRoot = process.env.OHMYDSH_OUTPUT_DIR ?? `.build/${target.id}`
const directoryOnly = argv.includes('--dir')
const host = hostTarget()
const sameHost = host !== undefined && host.platform === target.platform && host.arch === target.arch

/** Run a command to completion, inheriting stdio. */
const run = (command, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: at('.'), stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) => { code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)) })
  })

console.log(`packaging ${target.label}${directoryOnly ? ' (unpacked directory)' : ''}`)

await run(process.execPath, ['scripts/fetch-node.mjs', target.id])
if (sameHost) {
  await run(process.execPath, ['scripts/prepare-seed.mjs'])
} else {
  console.warn(`${target.label}: skipping the dsh seed because it must be built on ${target.platform}-${target.arch}; the packaged app will install dsh on first launch`)
}
await run(process.execPath, ['scripts/build.mjs'])

const nodePlatform = target.platform === 'darwin' ? 'darwin' : 'win32'
if (!existsSync(at('resources', 'node', `${nodePlatform}-${target.arch}`))) {
  throw new Error(`the ${target.label} Node.js runtime is missing; run npm run prepare:node -- ${target.id}`)
}

const builder = at('node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
const platformFlag = target.platform === 'darwin' ? '--mac' : '--win'
const archFlag = target.arch === 'arm64' ? '--arm64' : '--x64'
const args = [platformFlag, archFlag, '--config', 'electron-builder.config.mjs', ...(directoryOnly ? ['--dir'] : [])]

// A signature is only attempted when the caller supplied identity material.
if (process.env.OHMYDSH_MAC_IDENTITY === undefined && process.env.CSC_LINK === undefined) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
} else if (process.env.OHMYDSH_MAC_IDENTITY !== undefined && process.env.CSC_NAME === undefined) {
  // electron-builder selects a keychain identity through CSC_NAME, and it rejects
  // the "Developer ID Application: " prefix that Keychain displays, so the
  // project's own variable is translated rather than merely treated as a flag.
  process.env.CSC_NAME = process.env.OHMYDSH_MAC_IDENTITY.replace(/^Developer ID Application:\s*/, '')
  console.log(`packaging with keychain identity "${process.env.CSC_NAME}"`)
}

await run(builder, args, { OHMYDSH_TARGET: target.id })
console.log(`${target.label}: artifacts in ${outputRoot}/`)
