/**
 * Native plugin-market support for the desktop container.
 *
 * The catalog is treated as untrusted data: only its display fields and one
 * strictly validated package target cross into the install path. Package
 * operations run through the Node/Corepack runtime shipped with the client,
 * so Windows and Finder-launched macOS builds do not depend on a system pnpm.
 * @module main/plugin-market
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import semver from 'semver'
import type {
  PluginMarketCategory,
  PluginMarketEntry,
  PluginMarketState,
} from '../shared/types.ts'
import { containerConfig } from './config.ts'
import { packageEnvironment, profilePackageManager } from './node-runtime.ts'
import { paths } from './paths.ts'

/** Public catalog maintained by the DSH plugin community. */
const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
/** Keep package behavior stable across platforms and client releases. */
export const PROFILE_PNPM_VERSION = '11.20.0'
const FETCH_TIMEOUT_MS = 20_000
const INSTALL_PREFIX = 'dsh plugin --profile web add '

/** Minimal external catalog shape used after validation. */
interface CatalogPlugin {
  id: string
  name: string
  owner: string
  sourceUrl: string
  pageUrl: string
  target: string
  categories: string[]
  description: { en: string; zh: string }
  version?: string
  stars?: number
  downloads?: number
  added?: string
  npmName?: string
}

interface CatalogSnapshot {
  updated?: string
  categories: PluginMarketCategory[]
  plugins: CatalogPlugin[]
}

interface ProfileDependency {
  name: string
  spec: string
  present: boolean
  version?: string
  repository?: string
  repositoryDirectory?: string
}

interface ProfileModulesMetadata {
  packageManager?: string
  storeDir?: string
  virtualStoreDir?: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[]; patchReload?: string } }
  [key: string]: unknown
}

/** npm names, GitHub shortcuts, and repository-bound release archives are accepted. */
const NPM_TARGET = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@(?:[a-zA-Z0-9*^~<>=|.+_-]+))?$/
const GITHUB_TARGET = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9_./:&+-]+)?$/

/** Package name portion of a validated npm target, excluding its version spec. */
const npmPackageName = (target: string): string | undefined => {
  if (!NPM_TARGET.test(target)) return undefined
  if (!target.startsWith('@')) return target.split('@', 1)[0]
  const specifier = target.indexOf('@', target.indexOf('/') + 1)
  return specifier === -1 ? target : target.slice(0, specifier)
}

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const categoriesOf = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))]
}

/** Extract one package target without ever evaluating the catalog's command. */
const targetOf = (install: unknown, sourceUrl: string): string | undefined => {
  const command = stringValue(install)
  if (command === undefined || !command.startsWith(INSTALL_PREFIX)) return undefined
  const raw = command.slice(INSTALL_PREFIX.length)
  const target = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  if (NPM_TARGET.test(target) || GITHUB_TARGET.test(target)) return target
  try {
    const archive = new URL(target)
    const archiveRepository = /^\/([^/]+\/[^/]+)\/releases\//i.exec(archive.pathname)?.[1]?.toLowerCase()
    const sourceRepository = githubRepository(sourceUrl)
    const compressed = archive.pathname.endsWith('.tgz') || archive.pathname.endsWith('.tar.gz')
    return archive.protocol === 'https:'
      && archive.hostname === 'github.com'
      && archiveRepository !== undefined
      && archiveRepository === sourceRepository
      && compressed
      ? target
      : undefined
  } catch {
    return undefined
  }
}

/** Normalize a GitHub repository into the same lower-case owner/name key. */
const githubRepository = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  const github = /(?:github:|github\.com[/:])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?]|$)/i.exec(value)
  return github === null ? undefined : `${github[1]}/${github[2]}`.toLowerCase()
}

/** Include a monorepo subdirectory so sibling plugins do not match each other. */
const githubIdentity = (value: string | undefined, directory?: string): string | undefined => {
  const repository = githubRepository(value)
  if (repository === undefined) return undefined
  let subdirectory = stringValue(directory)
  if (subdirectory === undefined && value !== undefined) {
    const shortcut = /(?:^|[&#])path:\/?([^&]+)/i.exec(value)?.[1]
    if (shortcut !== undefined) subdirectory = shortcut
    if (subdirectory === undefined) {
      try {
        const source = new URL(value)
        if (source.hostname === 'github.com') {
          const segments = source.pathname.split('/').filter(Boolean)
          const tree = segments.indexOf('tree')
          if (tree >= 0 && segments.length > tree + 2) subdirectory = segments.slice(tree + 2).join('/')
        }
      } catch {
        // GitHub shortcuts are not URLs; their path was handled above.
      }
    }
  }
  const normalized = subdirectory?.replace(/^\/+|\/+$/g, '').toLowerCase()
  return normalized === undefined || normalized === '' ? repository : `${repository}#path:/${normalized}`
}

/** Read JSON defensively; malformed user files become an empty value. */
const readJson = (file: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Parse and validate the remote catalog into the narrow client contract. */
const parseCatalog = (value: unknown): CatalogSnapshot => {
  if (typeof value !== 'object' || value === null) throw new Error('插件目录返回了无效数据')
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.plugins)) throw new Error('插件目录中没有插件列表')
  const labels = typeof source.categories === 'object' && source.categories !== null
    ? source.categories as Record<string, unknown>
    : {}
  const categories: PluginMarketCategory[] = []
  for (const [id, label] of Object.entries(labels)) {
    if (typeof label !== 'object' || label === null) continue
    const localized = label as Record<string, unknown>
    categories.push({ id, en: stringValue(localized.en) ?? id, zh: stringValue(localized.zh) ?? id })
  }
  const seen = new Set<string>()
  const plugins: CatalogPlugin[] = []
  for (const raw of source.plugins) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const name = stringValue(item.name)
    const sourceUrl = stringValue(item.url)
    const target = sourceUrl === undefined ? undefined : targetOf(item.install, sourceUrl)
    const categories = categoriesOf(item.category)
    if (name === undefined || sourceUrl === undefined || target === undefined || categories.length === 0) continue
    const id = sourceUrl.toLowerCase().replace(/\/$/, '')
    if (seen.has(id)) continue
    seen.add(id)
    const descriptions = typeof item.description === 'object' && item.description !== null
      ? item.description as Record<string, unknown>
      : {}
    const version = stringValue(item.version)
    const npmName = stringValue(item.npm)
    const stars = numberValue(item.stars)
    const downloads = numberValue(item.downloads)
    const added = stringValue(item.added)
    plugins.push({
      id,
      name,
      owner: stringValue(item.owner) ?? '',
      sourceUrl,
      pageUrl: stringValue(item.page) ?? sourceUrl,
      target,
      categories,
      description: {
        en: stringValue(descriptions.en) ?? stringValue(descriptions.zh) ?? '',
        zh: stringValue(descriptions.zh) ?? stringValue(descriptions.en) ?? '',
      },
      ...(version === undefined ? {} : { version }),
      ...(npmName === undefined ? {} : { npmName }),
      ...(stars === undefined ? {} : { stars }),
      ...(downloads === undefined ? {} : { downloads }),
      ...(added === undefined ? {} : { added }),
    })
  }
  if (plugins.length === 0) throw new Error('插件目录为空')
  const updated = stringValue(source.updated)
  return { categories, plugins, ...(updated === undefined ? {} : { updated }) }
}

/** Direct dependencies currently installed in the web profile. */
const profileDependencies = (home: string): ProfileDependency[] => {
  const profile = join(home, 'profiles', 'web')
  const manifest = readJson(join(profile, 'package.json')) as ProfileManifest
  const dependencies = manifest.dependencies ?? {}
  return Object.entries(dependencies).map(([name, spec]) => {
    const installedManifest = join(profile, 'node_modules', ...name.split('/'), 'package.json')
    const present = existsSync(installedManifest)
    const installed = readJson(installedManifest)
    const repositoryValue = installed.repository
    const repository = typeof repositoryValue === 'string'
      ? repositoryValue
      : typeof repositoryValue === 'object' && repositoryValue !== null
        ? stringValue((repositoryValue as Record<string, unknown>).url)
        : undefined
    const repositoryDirectory = typeof repositoryValue === 'object' && repositoryValue !== null
      ? stringValue((repositoryValue as Record<string, unknown>).directory)
      : undefined
    const version = stringValue(installed.version)
    return {
      name,
      spec,
      present,
      ...(version === undefined ? {} : { version }),
      ...(repository === undefined ? {} : { repository }),
      ...(repositoryDirectory === undefined ? {} : { repositoryDirectory }),
    }
  })
}

const installedFor = (plugin: CatalogPlugin, dependencies: ProfileDependency[]): ProfileDependency | undefined => {
  const names = new Set([plugin.name, plugin.npmName].filter((name): name is string => name !== undefined))
  const repository = githubIdentity(plugin.target) ?? githubIdentity(plugin.sourceUrl)
  return dependencies.find((dependency) => names.has(dependency.name)
    || (repository !== undefined && [
      githubIdentity(dependency.spec),
      githubIdentity(dependency.repository, dependency.repositoryDirectory),
    ].includes(repository)))
}

const publicEntry = (plugin: CatalogPlugin, dependencies: ProfileDependency[]): PluginMarketEntry => {
  const installed = installedFor(plugin, dependencies)
  const updateAvailable = installed?.version !== undefined
    && plugin.version !== undefined
    && semver.valid(installed.version) !== null
    && semver.valid(plugin.version) !== null
    && semver.gt(plugin.version, installed.version)
  return {
    id: plugin.id,
    name: plugin.name,
    owner: plugin.owner,
    sourceUrl: plugin.sourceUrl,
    pageUrl: plugin.pageUrl,
    categories: plugin.categories,
    description: plugin.description,
    ...(plugin.version === undefined ? {} : { version: plugin.version }),
    ...(plugin.stars === undefined ? {} : { stars: plugin.stars }),
    ...(plugin.downloads === undefined ? {} : { downloads: plugin.downloads }),
    ...(plugin.added === undefined ? {} : { added: plugin.added }),
    ...(installed === undefined ? {} : {
      installedPackage: installed.name,
      installedVersion: installed.version ?? installed.spec,
      repairRequired: !installed.present,
    }),
    catalogued: true,
    updateAvailable,
  }
}

const unlistedId = (dependency: ProfileDependency): string =>
  `installed:${encodeURIComponent(dependency.name)}`

/** Direct dependency that remains manageable even after leaving the catalog. */
const unlistedEntry = (dependency: ProfileDependency): PluginMarketEntry => ({
  id: unlistedId(dependency),
  name: dependency.name,
  owner: '',
  sourceUrl: dependency.repository ?? '',
  pageUrl: '',
  categories: [],
  description: {
    en: 'Installed in this Harness profile but not present in the current community catalog.',
    zh: '已安装在当前 Harness 配置中，但不在当前社区插件目录内。',
  },
  installedPackage: dependency.name,
  installedVersion: dependency.version ?? dependency.spec,
  repairRequired: !dependency.present,
  catalogued: false,
  updateAvailable: false,
})

/** Atomically rewrite package.json after bundle reconciliation. */
const writeManifest = (file: string, manifest: ProfileManifest): void => {
  const temporary = `${file}.desktop-${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(temporary, file)
}

/** Create the standard web profile only when dsh has not initialized it yet. */
const ensureWebProfile = (profile: string): void => {
  mkdirSync(profile, { recursive: true })
  const manifest = join(profile, 'package.json')
  if (!existsSync(manifest)) {
    writeManifest(manifest, containerConfig().webProfile)
  }
  const root = join(profile, 'cordis.yml')
  if (!existsSync(root)) writeFileSync(root, '[]\n')
  const patch = join(profile, 'cordis.patch.yml')
  if (!existsSync(patch)) writeFileSync(patch, '[]\n')
}

/** Decode a scalar field from pnpm's JSON-shaped or legacy YAML metadata. */
const modulesMetadata = (profile: string): ProfileModulesMetadata | undefined => {
  const file = join(profile, 'node_modules', '.modules.yaml')
  if (!existsSync(file)) return undefined
  let contents = ''
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const metadata = readJson(file)
  const field = (name: keyof ProfileModulesMetadata): string | undefined => {
    const direct = stringValue(metadata[name])
    if (direct !== undefined) return direct
    const scalar = new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm').exec(contents)?.[1]
    if (scalar?.startsWith('"') === true) {
      try {
        const decoded: unknown = JSON.parse(scalar)
        return stringValue(decoded)
      } catch {
        return undefined
      }
    }
    return scalar?.startsWith("'") === true && scalar.endsWith("'")
      ? stringValue(scalar.slice(1, -1).replace(/''/g, "'"))
      : stringValue(scalar)
  }
  return {
    packageManager: field('packageManager'),
    storeDir: field('storeDir'),
    virtualStoreDir: field('virtualStoreDir'),
  }
}

/** Whether a child path is inside a root without relying on string prefixes. */
const isWithin = (root: string, child: string): boolean => {
  const path = relative(root, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const MIGRATION_DIRECTORY = '.oh-my-deepseek-pnpm-migration'

/** Restore the exact pre-migration profile after failure or an interrupted run. */
const restoreProfileMigration = (profile: string): void => {
  const backup = join(profile, MIGRATION_DIRECTORY)
  const backupModules = join(backup, 'node_modules')
  if (!existsSync(backupModules)) {
    rmSync(backup, { recursive: true, force: true })
    return
  }
  const state = readJson(join(backup, 'state.json'))
  rmSync(join(profile, 'node_modules'), { recursive: true, force: true })
  renameSync(backupModules, join(profile, 'node_modules'))
  copyFileSync(join(backup, 'package.json'), join(profile, 'package.json'))
  const lock = join(profile, 'pnpm-lock.yaml')
  const backupLock = join(backup, 'pnpm-lock.yaml')
  if (state.hadLock === true && existsSync(backupLock)) copyFileSync(backupLock, lock)
  else rmSync(lock, { force: true })
  const workspace = join(profile, 'pnpm-workspace.yaml')
  const backupWorkspace = join(backup, 'pnpm-workspace.yaml')
  if (state.hadWorkspace === true && existsSync(backupWorkspace)) copyFileSync(backupWorkspace, workspace)
  else rmSync(workspace, { force: true })
  rmSync(backup, { recursive: true, force: true })
}

/** Existing trees not produced by our pinned pnpm and private store migrate once. */
const profileNeedsMigration = (profile: string): boolean => {
  if (!existsSync(join(profile, 'node_modules'))) return false
  const metadata = modulesMetadata(profile)
  return metadata?.packageManager !== `pnpm@${PROFILE_PNPM_VERSION}`
    || metadata.storeDir === undefined
    || !isWithin(paths().pnpmStore, metadata.storeDir)
    || metadata.virtualStoreDir !== '.pnpm'
}

/** One useful, credential-scrubbed pnpm error line for the renderer. */
const pnpmFailure = (output: string, code: number | null): string => {
  const lines = output
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const detail = lines.find((line) => /ERR_PNPM_[A-Z0-9_]+/.test(line))
    ?? lines.find((line) => /(?:error|failed)/i.test(line))
  const safeDetail = detail
    ?.replace(/(https?:\/\/)[^@\s]+@/gi, '$1<redacted>@')
    .replace(/(_authToken=)[^\s]+/gi, '$1<redacted>')
  return `pnpm exited with code ${String(code)}${safeDetail === undefined ? '' : `: ${safeDetail}`}`
}

const exportsBundle = (profile: string, name: string): boolean => {
  const manifest = readJson(join(profile, 'node_modules', ...name.split('/'), 'package.json'))
  const dsh = typeof manifest.dsh === 'object' && manifest.dsh !== null ? manifest.dsh as Record<string, unknown> : {}
  const bundle = typeof dsh.bundle === 'object' && dsh.bundle !== null ? dsh.bundle as Record<string, unknown> : {}
  return stringValue(bundle.patch) !== undefined
}

/** Mirror dsh's post-pnpm bundle reconciliation without depending on its CLI. */
const reconcileBundles = (profile: string, beforeDependencies: Set<string>): void => {
  const file = join(profile, 'package.json')
  const manifest = readJson(file) as ProfileManifest
  const dependencyNames = Object.keys(manifest.dependencies ?? {})
  const dependencySet = new Set(dependencyNames)
  const existing = manifest.dsh?.profile?.bundles ?? []
  const bundles = [...existing]
  for (const name of dependencyNames) {
    if (exportsBundle(profile, name) && !bundles.includes(name)) bundles.push(name)
  }
  for (const name of [...bundles]) {
    const managed = beforeDependencies.has(name) || dependencySet.has(name)
    if (managed && (!dependencySet.has(name) || !exportsBundle(profile, name))) {
      bundles.splice(bundles.indexOf(name), 1)
    }
  }
  if (bundles.length === existing.length && bundles.every((name, index) => name === existing[index])) return
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles },
  }
  writeManifest(file, manifest)
}

/** Run a pinned pnpm command against the client-owned content store. */
const executePnpm = async (profile: string, args: string[], log: (text: string) => void): Promise<void> => {
  const manager = profilePackageManager(PROFILE_PNPM_VERSION)
  log(`running bundled pnpm ${PROFILE_PNPM_VERSION}: pnpm ${args.join(' ')}`)
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const record = (chunk: Buffer): void => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-16_384)
      log(text)
    }
    const child = spawn(manager.command, [
      ...manager.argsPrefix,
      ...args,
      '--dir',
      profile,
      '--reporter=append-only',
      '--store-dir',
      paths().pnpmStore,
    ], {
      cwd: profile,
      env: {
        ...packageEnvironment(),
        COREPACK_HOME: paths().corepackHome,
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(pnpmFailure(output, code)))
    })
  })
}

/**
 * Recreate a legacy dependency tree through the pinned package manager. The
 * old tree and both manifests stay recoverable until the replacement succeeds.
 */
const migrateProfile = async (profile: string, log: (text: string) => void): Promise<void> => {
  const backup = join(profile, MIGRATION_DIRECTORY)
  const modules = join(profile, 'node_modules')
  const lock = join(profile, 'pnpm-lock.yaml')
  const workspace = join(profile, 'pnpm-workspace.yaml')
  mkdirSync(backup, { recursive: false })
  copyFileSync(join(profile, 'package.json'), join(backup, 'package.json'))
  const hadLock = existsSync(lock)
  const hadWorkspace = existsSync(workspace)
  if (hadLock) copyFileSync(lock, join(backup, 'pnpm-lock.yaml'))
  if (hadWorkspace) copyFileSync(workspace, join(backup, 'pnpm-workspace.yaml'))
  writeFileSync(join(backup, 'state.json'), `${JSON.stringify({ hadLock, hadWorkspace })}\n`)
  renameSync(modules, join(backup, 'node_modules'))
  // An old lock may contain package-manager-specific settings or dependency
  // choices rejected by the pinned pnpm. Resolve a fresh compatible lock from
  // the unchanged direct dependency specs; the original lock remains backed up.
  rmSync(lock, { force: true })
  log('migrating the web profile to the client pnpm store')
  try {
    await executePnpm(profile, ['install', '--force'], log)
    rmSync(backup, { recursive: true, force: true })
    log('web profile pnpm migration completed')
  } catch (error) {
    restoreProfileMigration(profile)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`旧插件环境迁移失败，原文件已恢复：${message}`)
  }
}

/** Repair interrupted migrations, migrate legacy trees, then apply one change. */
const runPnpm = async (profile: string, args: string[], log: (text: string) => void): Promise<void> => {
  const backup = join(profile, MIGRATION_DIRECTORY)
  if (existsSync(backup)) {
    restoreProfileMigration(profile)
    log('restored a plugin profile migration interrupted during an earlier run')
  }
  ensureWebProfile(profile)
  if (profileNeedsMigration(profile)) await migrateProfile(profile, log)
  await executePnpm(profile, args, log)
}

/** Owns the cached catalog and package operations for one container. */
export class PluginMarket {
  private catalog: CatalogSnapshot | undefined

  constructor(
    private readonly home: () => string,
    private readonly log: (text: string) => void,
  ) {}

  /** Current catalog plus installed state from disk. */
  snapshot(): PluginMarketState {
    const dependencies = profileDependencies(this.home())
    const catalog = this.catalog
    const catalogPlugins = catalog?.plugins.map((plugin) => publicEntry(plugin, dependencies)) ?? []
    const cataloguedDependencies = new Set(
      (catalog?.plugins ?? [])
        .map((plugin) => installedFor(plugin, dependencies)?.name)
        .filter((name): name is string => name !== undefined),
    )
    const plugins = [
      ...catalogPlugins,
      ...dependencies.filter((dependency) => !cataloguedDependencies.has(dependency.name)).map(unlistedEntry),
    ]
    return {
      catalogLoaded: catalog !== undefined,
      categories: catalog?.categories ?? [],
      plugins,
      installedCount: plugins.filter((plugin) => plugin.installedPackage !== undefined).length,
      updateCount: plugins.filter((plugin) => plugin.updateAvailable).length,
      ...(catalog?.updated === undefined ? {} : { catalogUpdated: catalog.updated }),
    }
  }

  /** Fetch and validate a fresh catalog. */
  async refresh(): Promise<PluginMarketState> {
    const response = await fetch(CATALOG_URL, {
      headers: { accept: 'application/json', 'user-agent': 'oh-my-deepseek' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`插件目录请求失败：HTTP ${String(response.status)}`)
    this.catalog = parseCatalog(await response.json())
    this.log(`loaded ${String(this.catalog.plugins.length)} plugins from the community catalog`)
    return this.snapshot()
  }

  private resolve(id: string): CatalogPlugin {
    const plugin = this.catalog?.plugins.find((entry) => entry.id === id)
    if (plugin === undefined) throw new Error('插件目录已变化，请刷新后重试')
    return plugin
  }

  /** Install or update one catalog entry and activate its bundle. */
  async install(id: string): Promise<PluginMarketState> {
    const profile = join(this.home(), 'profiles', 'web')
    const dependencies = profileDependencies(this.home())
    const before = new Set(dependencies.map((dependency) => dependency.name))
    const plugin = this.catalog?.plugins.find((entry) => entry.id === id)
    if (plugin === undefined) {
      const dependency = dependencies.find((entry) => unlistedId(entry) === id)
      if (dependency === undefined || dependency.present) throw new Error('插件目录已变化，请刷新后重试')
      await runPnpm(profile, ['install', '--force'], this.log)
      reconcileBundles(profile, before)
      const repaired = profileDependencies(this.home()).find((entry) => entry.name === dependency.name)
      if (repaired?.present !== true) throw new Error(`${dependency.name} 修复后仍缺少安装文件`)
      this.log(`repaired unlisted plugin ${dependency.name}`)
      return this.snapshot()
    }
    const installed = installedFor(plugin, dependencies)
    const packageName = npmPackageName(plugin.target)
    // `pnpm add name` preserves an existing exact dependency spec. When the
    // catalog advertises a newer npm release, request that exact release so an
    // Update click changes the installed package instead of becoming a no-op.
    const target = installed !== undefined
      && packageName !== undefined
      && plugin.version !== undefined
      && semver.valid(plugin.version) !== null
      ? `${packageName}@${plugin.version}`
      : plugin.target
    const force = installed !== undefined && packageName === undefined
    await runPnpm(profile, ['add', target, ...(force ? ['--force'] : [])], this.log)
    reconcileBundles(profile, before)
    const applied = installedFor(plugin, profileDependencies(this.home()))
    if (applied?.present !== true) throw new Error(`${plugin.name} 安装完成后仍缺少插件文件`)
    if (plugin.version !== undefined
      && semver.valid(plugin.version) !== null
      && (applied.version === undefined || semver.valid(applied.version) === null || !semver.eq(applied.version, plugin.version))) {
      throw new Error(`${plugin.name} 更新未生效：需要 ${plugin.version}，实际为 ${applied.version ?? '未知'}`)
    }
    this.log(`installed plugin ${plugin.name}`)
    return this.snapshot()
  }

  /** Remove one installed catalog entry and its bundle layer. */
  async remove(id: string): Promise<PluginMarketState> {
    const dependencies = profileDependencies(this.home())
    const plugin = this.catalog?.plugins.find((entry) => entry.id === id)
    const installed = plugin === undefined
      ? dependencies.find((dependency) => unlistedId(dependency) === id)
      : installedFor(plugin, dependencies)
    const displayName = plugin?.name ?? installed?.name ?? '插件'
    if (installed === undefined) throw new Error(`${displayName} 尚未安装`)
    const profile = join(this.home(), 'profiles', 'web')
    const before = new Set(dependencies.map((dependency) => dependency.name))
    await runPnpm(profile, ['remove', installed.name], this.log)
    reconcileBundles(profile, before)
    this.log(`removed plugin ${displayName}`)
    return this.snapshot()
  }

  /** Open only the page URL selected from the validated catalog. */
  page(id: string): string {
    return this.resolve(id).pageUrl
  }
}
