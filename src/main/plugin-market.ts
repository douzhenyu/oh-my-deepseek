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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import type {
  PluginMarketCategory,
  PluginMarketEntry,
  PluginMarketState,
} from '../shared/types.ts'
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
  version?: string
  repository?: string
  repositoryDirectory?: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[]; patchReload?: string } }
  [key: string]: unknown
}

/** npm names, GitHub shortcuts, and repository-bound release archives are accepted. */
const NPM_TARGET = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@(?:[a-zA-Z0-9*^~<>=|.+_-]+))?$/
const GITHUB_TARGET = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9_./:&+-]+)?$/

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
    const installed = readJson(join(profile, 'node_modules', ...name.split('/'), 'package.json'))
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
    }),
    updateAvailable,
  }
}

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
    writeManifest(manifest, {
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
          patchReload: 'live',
        },
      },
    })
  }
  const root = join(profile, 'cordis.yml')
  if (!existsSync(root)) writeFileSync(root, '[]\n')
  const patch = join(profile, 'cordis.patch.yml')
  if (!existsSync(patch)) writeFileSync(patch, '[]\n')
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

/** Run a pinned pnpm through the client's own Corepack runtime. */
const runPnpm = async (profile: string, args: string[], log: (text: string) => void): Promise<void> => {
  const manager = profilePackageManager(PROFILE_PNPM_VERSION)
  ensureWebProfile(profile)
  log(`running bundled pnpm ${PROFILE_PNPM_VERSION}: pnpm ${args.join(' ')}`)
  await new Promise<void>((resolve, reject) => {
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
    child.stdout?.on('data', (chunk: Buffer) => { log(chunk.toString()) })
    child.stderr?.on('data', (chunk: Buffer) => { log(chunk.toString()) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pnpm exited with code ${String(code)}`))
    })
  })
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
    const plugins = catalog?.plugins.map((plugin) => publicEntry(plugin, dependencies)) ?? []
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
    const plugin = this.resolve(id)
    const profile = join(this.home(), 'profiles', 'web')
    const before = new Set(profileDependencies(this.home()).map((dependency) => dependency.name))
    await runPnpm(profile, ['add', plugin.target], this.log)
    reconcileBundles(profile, before)
    this.log(`installed plugin ${plugin.name}`)
    return this.snapshot()
  }

  /** Remove one installed catalog entry and its bundle layer. */
  async remove(id: string): Promise<PluginMarketState> {
    const plugin = this.resolve(id)
    const dependencies = profileDependencies(this.home())
    const installed = installedFor(plugin, dependencies)
    if (installed === undefined) throw new Error(`${plugin.name} 尚未安装`)
    const profile = join(this.home(), 'profiles', 'web')
    const before = new Set(dependencies.map((dependency) => dependency.name))
    await runPnpm(profile, ['remove', installed.name], this.log)
    reconcileBundles(profile, before)
    this.log(`removed plugin ${plugin.name}`)
    return this.snapshot()
  }

  /** Open only the page URL selected from the validated catalog. */
  page(id: string): string {
    return this.resolve(id).pageUrl
  }
}
