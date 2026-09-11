/**
 * The contract shared by the main process, the preload bridge, and the console
 * renderer. Everything crossing a process boundary is declared here once so the
 * three sides cannot drift.
 * @module shared/types
 */

/** Which harness home the client uses. */
export type HarnessHomeMode =
  /** The same root as the `dsh` command line: shared history and credentials. */
  | 'shared'
  /** This client's own root: no session contention, separate history. */
  | 'separate'

/** Where the container is in its startup or recovery lifecycle. */
export type ContainerPhase =
  /** Resolving the active dsh version and its files. */
  | 'checking'
  /** Installing a dsh version with the bundled package manager. */
  | 'installing'
  /** Waiting for the dsh backend to print its readiness line. */
  | 'starting'
  /** The backend is serving and the Harness window may load it. */
  | 'ready'
  /** Startup or installation failed; `error` explains what to do next. */
  | 'error'
  /** No backend is running because the user stopped it. */
  | 'stopped'

/** A dsh version this container can start. */
export interface InstalledVersion {
  /** Exact version, for example `0.1.5-rc.1`. */
  version: string
  /** `bundled` ships inside the application; `installed` lives in the user data directory. */
  source: 'bundled' | 'installed'
  /** Absolute path of the installed version's directory. */
  root: string
}

/** A dsh version offered by the package registry but not yet installed. */
export interface RemoteVersion {
  /** Exact version. */
  version: string
  /** Distribution tags naming this version, for example `latest`. */
  tags: string[]
}

/** Progress of a long package operation, or `undefined` when none is running. */
export interface OperationProgress {
  /** What the operation is doing, already localized by the main process. */
  label: string
  /** Completed unit count, absent when the operation cannot report one. */
  done?: number
  /** Total unit count, absent when the operation cannot report one. */
  total?: number
}

/** A published client release the console can offer. */
export interface ClientReleaseInfo {
  /** Version without the tag prefix, for example `0.1.1`. */
  version: string
  /** Release title. */
  name: string
  /** Human-facing release page. */
  pageUrl: string
  /** Name of the file this platform would install, absent when the release has none. */
  assetName?: string
  /** Size of that file in bytes. */
  assetSize?: number
}

/** State of the client's own update check, which is separate from dsh versions. */
export interface ClientUpdateState {
  /** The running application version. */
  currentVersion: string
  /** Newest published release, once a check succeeds. */
  latest?: ClientReleaseInfo
  /** Whether `latest` is newer than `currentVersion`. */
  available: boolean
  /** Whether a release lookup is in flight. */
  checking: boolean
  /** Whether an asset download is in flight. */
  downloading: boolean
  /** Download completion from 0 to 1, absent while the size is unknown. */
  progress?: number
  /** Absolute path of a downloaded release ready to apply. */
  downloadedPath?: string
  /** Why the last check or download failed. */
  error?: string
  /** How this platform applies a downloaded release. */
  installMode: 'installer' | 'manual'
}

/** The complete console-visible state; every field is safe to serialize to JSON. */
export interface ContainerState {
  /** Current lifecycle phase. */
  phase: ContainerPhase
  /** Version the running backend was started from. */
  activeVersion?: string
  /** Version packaged inside the application, when one is bundled. */
  bundledVersion?: string
  /** Versions available to activate, newest first. */
  installed: InstalledVersion[]
  /** Versions published to the registry, newest first; empty until a refresh succeeds. */
  remote: RemoteVersion[]
  /** Why the last registry refresh failed, when it did. */
  remoteError?: string
  /** Whether a registry refresh is in flight. */
  checkingRemote: boolean
  /** Loopback URL of the running backend, without its one-time token. */
  backendUrl?: string
  /** Process id of the supervising child, used to prove teardown. */
  backendPid?: number
  /** Loopback port the backend listens on. */
  port?: number
  /** Localized failure summary for the error phase. */
  error?: string
  /** Localized progress for the current phase. */
  detail?: string
  /** Progress of a running package operation. */
  progress?: OperationProgress
  /** Harness home directory shared with the dsh command line, as displayed. */
  dshHome: string
  /** Harness home override; empty means the shared root applies. */
  dshHomeOverride: string
  /** Which home the client is using. */
  harnessHomeMode: HarnessHomeMode
  /** Tail of the container and backend log, oldest first. */
  logs: string[]
  /** Application version, for support reports. */
  appVersion: string
  /** Displayed product name. */
  productName: string
  /** `darwin` or `win32`. */
  platform: string
  /** Whether the container starts the backend as soon as it opens. */
  autoStart: boolean
  /** Whether the container queries the registry during launch. */
  checkUpdatesOnLaunch: boolean
  /** Whether the container queries the release feed during launch. */
  checkClientUpdatesOnLaunch: boolean
  /** Whether finished conversations raise a desktop notification. */
  notifyOnTurnEnd: boolean
  /** Client update state, independent of the harness versions below it. */
  client: ClientUpdateState
  /** Version the `latest` tag names, when the registry reported one. */
  latestVersion?: string
  /** Whether a published version is newer than the active one. */
  updateAvailable: boolean
}

/** User-controlled container settings, persisted between launches. */
export interface ContainerSettings {
  /** Version to start, or absent to follow the bundled version then the newest installed one. */
  activeVersion?: string
  /** Loopback port to prefer; a busy port is replaced for that launch only. */
  port: number
  /** Whether to start the backend during launch. */
  autoStart: boolean
  /** Whether to query the registry for harness versions during launch. */
  checkUpdatesOnLaunch: boolean
  /** Whether to query the release feed for a newer client during launch. */
  checkClientUpdatesOnLaunch: boolean
  /** Whether to raise a desktop notification when a conversation finishes. */
  notifyOnTurnEnd: boolean
  /** Harness home; absent means the standard `DSH_HOME` then `~/.dsh`. */
  dshHome?: string
}

/** IPC channel names. Kept as a frozen object so the preload and main sides cannot disagree. */
export const CHANNELS = {
  /** Main → renderer: a new {@link ContainerState}. */
  state: 'container:state',
  /** Renderer → main: read the current state. */
  snapshot: 'container:snapshot',
  /** Renderer → main: refresh registry versions. */
  refreshRemote: 'container:remote:refresh',
  /** Renderer → main: install one published version. */
  install: 'container:version:install',
  /** Renderer → main: make one installed version the active one and restart. */
  activate: 'container:version:activate',
  /** Renderer → main: delete a version installed in user data. */
  remove: 'container:version:remove',
  /** Renderer → main: (re)start the backend. */
  start: 'container:backend:start',
  /** Renderer → main: stop the backend. */
  stop: 'container:backend:stop',
  /** Renderer → main: open or focus the Harness window. */
  openHarness: 'container:harness:open',
  /** Renderer → main: open a path in the platform file manager. */
  reveal: 'container:path:reveal',
  /** Renderer → main: update settings. */
  updateSettings: 'container:settings:update',
  /** Renderer → main: switch between the shared and the independent harness home. */
  setHarnessHome: 'container:home:set',
  /** Renderer → main: look for a newer client release. */
  checkClientUpdate: 'container:client:check',
  /** Renderer → main: download the offered client release. */
  downloadClientUpdate: 'container:client:download',
  /** Renderer → main: apply the downloaded client release. */
  installClientUpdate: 'container:client:install',
  /** Renderer → main: reveal the downloaded client release in the file manager. */
  revealClientUpdate: 'container:client:reveal',
  /** Renderer → main: open the release page in the default browser. */
  openClientRelease: 'container:client:page',
} as const

/** Operations the console may open a platform file manager for. */
export type RevealTarget = 'logs' | 'data' | 'versions'

/** One settings patch; absent fields keep their stored value. */
export type SettingsPatch = Partial<ContainerSettings>

/** The bridge exposed to renderers as `window.container`. */
export interface ContainerBridge {
  /** Current state at call time. */
  snapshot(): Promise<ContainerState>
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: ContainerState) => void): () => void
  /** Query the registry for published versions. */
  refreshRemote(): Promise<void>
  /** Install a published version into user data. */
  install(version: string): Promise<void>
  /** Activate a version and restart the backend on it. */
  activate(version: string): Promise<void>
  /** Delete a user-installed version; refuses for the bundled one. */
  remove(version: string): Promise<void>
  /** Start the backend if it is not running. */
  start(): Promise<void>
  /** Stop the backend. */
  stop(): Promise<void>
  /** Open or focus the Harness window. */
  openHarness(): Promise<void>
  /** Reveal a container directory in the platform file manager. */
  reveal(target: RevealTarget): Promise<void>
  /** Persist a settings patch. */
  updateSettings(patch: SettingsPatch): Promise<void>
  /** Switch harness home and restart the backend on it. */
  setHarnessHome(mode: HarnessHomeMode): Promise<void>
  /** Look for a newer client release. */
  checkClientUpdate(): Promise<void>
  /** Download the offered client release. */
  downloadClientUpdate(): Promise<void>
  /** Apply the downloaded client release. */
  installClientUpdate(): Promise<void>
  /** Reveal the downloaded client release in the file manager. */
  revealClientUpdate(): Promise<void>
  /** Open the offered release's page. */
  openClientRelease(): Promise<void>
}
