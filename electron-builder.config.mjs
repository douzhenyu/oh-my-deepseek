/**
 * electron-builder configuration for one target.
 *
 * The target is selected by `OHMYDSH_TARGET` so that the same configuration
 * file describes every platform. Resources are per-target and never shared: a
 * macOS seed runtime contains macOS native modules and must never end up inside
 * a Windows installer.
 */

import { execFileSync } from 'node:child_process'
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
// The Windows archive keeps npm in a root node_modules directory, which
// electron-builder excludes from a directory mapping. Without this explicit
// second mapping the app ships node.exe but falls back to a nonexistent system
// npm when it needs to install dsh on first launch.
if (nodePlatform === 'win32') {
  extraResources.push({
    from: `resources/node/${nodePlatform}-${arch}/node_modules`,
    to: `node/${nodePlatform}-${arch}/node_modules`,
  })
  extraResources.push({ from: 'build/icon.png', to: 'tray-icon.png' })
}
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
    return readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length
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
    join(
      resources,
      'node',
      `${nodePlatform}-${arch}`,
      nodePlatform === 'win32' ? join('node_modules', 'npm', 'bin', 'npm-cli.js') : join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ),
    join(
      resources,
      'node',
      `${nodePlatform}-${arch}`,
      nodePlatform === 'win32' ? join('node_modules', 'corepack', 'dist', 'corepack.js') : join('lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
    ),
  ]
  const seedEntry = join(resources, 'dsh-seed', 'node_modules', ...config.dshPackage.split('/'), 'lib', 'bin.js')
  const seedBundled = seedMatchesTarget()
  if (nodePlatform === 'win32') required.push(join(resources, 'tray-icon.png'))
  if (seedBundled) required.push(seedEntry)
  const missing = required.filter((path) => !existsSync(path))
  if (missing.length > 0) throw new Error(`packaged application is missing: ${missing.join(', ')}`)
  const runtimeSource = countFiles(join(root, 'resources', 'node', `${nodePlatform}-${arch}`))
  const runtimePackaged = countFiles(join(resources, 'node', `${nodePlatform}-${arch}`))
  if (runtimePackaged < runtimeSource) {
    throw new Error(`the packaged Node.js runtime is incomplete: ${String(runtimePackaged)} entries copied from ${String(runtimeSource)}`)
  }
  if (seedBundled) {
    const source = countFiles(join(root, 'resources', 'dsh-seed'))
    const packaged = countFiles(join(resources, 'dsh-seed'))
    if (packaged < source) {
      throw new Error(`the packaged dsh seed is incomplete: ${String(packaged)} files copied from ${String(source)}`)
    }
    console.log(`verified ${String(packaged)} seed files and the bundled runtime in ${resources}`)
  }
}

/**
 * Whether the caller supplied signing material. Either electron-builder's own
 * `CSC_LINK` or this project's `OHMYDSH_MAC_IDENTITY` turns signing on.
 */
const wantsSignature = process.env.OHMYDSH_MAC_IDENTITY !== undefined || process.env.CSC_LINK !== undefined

/**
 * Ad-hoc sign the packaged application when no real identity was supplied.
 *
 * This is not cosmetic. Electron 42 moved macOS notifications to the
 * `UNNotification` API, which refuses to display anything from an unsigned
 * application and reports the refusal only through a `failed` event — so an
 * unsigned build looks fine and silently shows nothing, and macOS never lists the
 * app under Notifications settings.
 *
 * The Electron distribution's own signature cannot satisfy this: it is
 * `flags=0x20002(adhoc,linker-signed)` with the identifier `Electron`, applied by
 * the linker rather than by a signing identity, and `UNNotification` rejects it.
 * Re-signing ad-hoc with this application's own identifier drops the
 * `linker-signed` flag and makes the bundle verify.
 */
const adhocSign = (context) => {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', config.appId, appPath], { stdio: 'inherit' })
  const describe = execFileSync('codesign', ['-dv', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(`adhoc-signed ${appPath}\n${describe.trim()}`)
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log('the bundled application verifies against its own signature')
}

/**
 * Everything that has to happen to the packed application before it is signed
 * into installers: prove the resources are all there, then sign it.
 */
const packageApplication = async (context) => {
  await verifyResources(context)
  // A real identity is electron-builder's job; it signs after this hook.
  if (!wantsSignature) adhocSign(context)
}

/**
 * Whether notarization credentials were supplied as well.
 *
 * Signing alone is not enough on macOS 10.15+: a signed but un-notarized app is
 * still blocked by Gatekeeper. Any one of the three documented credential
 * strategies enables it, and the notarization step then also staples the ticket
 * so the app verifies offline.
 */
const wantsNotarization = wantsSignature
  && (process.env.APPLE_ID !== undefined
    || process.env.APPLE_API_KEY !== undefined
    || process.env.APPLE_KEYCHAIN_PROFILE !== undefined)

if (wantsSignature) {
  console.log(`electron-builder: signing with ${process.env.OHMYDSH_MAC_IDENTITY ?? 'the CSC_LINK certificate'}; notarization ${wantsNotarization ? 'enabled' : 'DISABLED (no APPLE_ID, APPLE_API_KEY, or APPLE_KEYCHAIN_PROFILE)'}`)
}

export default {
  appId: config.appId,
  productName: config.productName,
  // Opt-in, so a release job fails instead of quietly uploading an unsigned
  // build when its signing secrets are missing.
  forceCodeSigning: process.env.OHMYDSH_REQUIRE_SIGNING === '1',
  // The brand carries punctuation that is awkward in file names and NSIS
  // scripts, so artifacts use a plain technical name.
  artifactName: 'oh-my-deepseek-${version}-${os}-${arch}.${ext}',
  asar: true,
  files: ['lib/**/*', 'package.json', 'container.config.json'],
  extraResources,
  // The build root defaults to `.build`; `OHMYDSH_OUTPUT_DIR` lets a release
  // build land beside, rather than on top of, an installed copy that may be
  // running. The target id is always appended so both layouts are identical.
  directories: { output: `${process.env.OHMYDSH_OUTPUT_DIR ?? '.build'}/${targetId}` },
  afterPack: packageApplication,
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    // An unsigned local build is the default; release signing is opt-in through
    // the standard electron-builder identity inputs.
    identity: wantsSignature ? undefined : null,
    hardenedRuntime: wantsSignature,
    // Hardened runtime without these entitlements notarizes and then crashes on
    // launch, because Electron's V8 cannot start without them.
    ...(wantsSignature
      ? {
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.inherit.plist',
        }
      : {}),
    gatekeeperAssess: false,
    notarize: wantsNotarization,
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
