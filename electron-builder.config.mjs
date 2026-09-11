/**
 * electron-builder configuration for one target.
 *
 * The target is selected by `OHMYDSH_TARGET` so that the same configuration
 * file describes every platform. Resources are per-target and never shared: a
 * macOS seed runtime contains macOS native modules and must never end up inside
 * a Windows installer.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(root, 'container.config.json'), 'utf8'))

const targetId = process.env.OHMYDSH_TARGET ?? 'mac-arm64'
const [platform, arch] = targetId.split('-')
if ((platform !== 'mac' && platform !== 'win') || (arch !== 'arm64' && arch !== 'x64')) {
  throw new Error(`OHMYDSH_TARGET must be mac-arm64, mac-x64, or win-x64; got ${targetId}`)
}
const nodePlatform = platform === 'mac' ? 'darwin' : 'win32'

/** Read-only content copied into the application's `Resources` directory. */
const extraResources = [
  { from: 'lib/supervisor.mjs', to: 'supervisor.mjs' },
  { from: `resources/node/${nodePlatform}-${arch}`, to: `node/${nodePlatform}-${arch}` },
]
const seed = join(root, 'resources', 'dsh-seed')
const seedMarker = join(seed, 'seed.json')

/** Whether the prepared seed was built for this exact target. */
const seedMatchesTarget = () => {
  if (!existsSync(seed)) return false
  try {
    const recorded = JSON.parse(readFileSync(seedMarker, 'utf8'))
    return recorded.platform === nodePlatform && recorded.arch === arch
  } catch {
    // A seed without a marker cannot be trusted to match the target.
    return false
  }
}

if (seedMatchesTarget()) {
  extraResources.push({ from: 'resources/dsh-seed', to: 'dsh-seed' })
  // electron-builder excludes a source directory's root node_modules, so the
  // dependency tree must be mapped a second time or the packaged seed ships
  // without a single package in it. The verification hook below proves it.
  extraResources.push({ from: 'resources/dsh-seed/node_modules', to: 'dsh-seed/node_modules' })
} else if (existsSync(seed)) {
  // Shipping a foreign seed would install native modules built for another
  // platform. Omitting it is correct: the app installs dsh on first launch.
  console.warn(
    `electron-builder: excluding resources/dsh-seed because it was not built for ${nodePlatform}-${arch}; ` +
      `run "node scripts/prepare-seed.mjs" on ${targetId} to bundle an offline version`,
  )
} else {
  console.warn('electron-builder: no bundled dsh seed; the packaged app will install one on first launch')
}

/** Count files below a directory, or `-1` when it does not exist. */
const countFiles = (directory) => {
  try {
    return readdirSync(directory, { recursive: true }).length
  } catch {
    return -1
  }
}

/**
 * Fail the build when a required resource is missing from the packaged
 * application. Resource mapping is silent when it goes wrong: the application
 * packages cleanly and only fails on a user's machine.
 */
const verifyResources = async (context) => {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  const required = [
    join(resources, 'supervisor.mjs'),
    join(resources, 'node', `${nodePlatform}-${arch}`, nodePlatform === 'win32' ? 'node.exe' : join('bin', 'node')),
  ]
  const seedEntry = join(resources, 'dsh-seed', 'node_modules', ...config.dshPackage.split('/'), 'lib', 'bin.js')
  const seedBundled = seedMatchesTarget()
  if (seedBundled) required.push(seedEntry)
  const missing = required.filter((path) => !existsSync(path))
  if (missing.length > 0) throw new Error(`packaged application is missing: ${missing.join(', ')}`)
  if (seedBundled) {
    const source = countFiles(join(root, 'resources', 'dsh-seed'))
    const packaged = countFiles(join(resources, 'dsh-seed'))
    if (packaged < source) {
      throw new Error(`the packaged dsh seed is incomplete: ${String(packaged)} files copied from ${String(source)}`)
    }
    console.log(`verified ${String(packaged)} seed files and the bundled runtime in ${resources}`)
  }
}

const wantsSignature = process.env.OHMYDSH_MAC_IDENTITY !== undefined || process.env.CSC_LINK !== undefined

export default {
  appId: config.appId,
  productName: config.productName,
  // The brand carries punctuation that is awkward in file names and NSIS
  // scripts, so artifacts use a plain technical name.
  artifactName: 'oh-my-deepseek-${version}-${os}-${arch}.${ext}',
  asar: true,
  files: ['lib/**/*', 'package.json', 'container.config.json'],
  extraResources,
  directories: { output: `.build/${targetId}` },
  afterPack: verifyResources,
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    // An unsigned local build is the default; release signing is opt-in through
    // the standard electron-builder identity inputs.
    identity: wantsSignature ? undefined : null,
    hardenedRuntime: wantsSignature,
    gatekeeperAssess: false,
    notarize: false,
    extendInfo: { CFBundleDisplayName: config.productName },
  },
  dmg: { sign: false },
  win: { target: ['nsis'] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    shortcutName: config.productName,
  },
}
