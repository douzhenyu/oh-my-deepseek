/**
 * Ownership of the harness backend process.
 *
 * The backend is never spawned directly. It is started under
 * `supervisor.mjs`, which keeps the harness and every process it spawns in one
 * process group and tears that group down when this process disappears for any
 * reason. Stopping therefore has two independent paths: an orderly
 * {@link BackendService.stop} during a normal quit, and the supervisor's own
 * parent-death detection when the main process is killed outright.
 * @module main/backend
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { backendEnvironment } from './environment.ts'
import { redact, type ContainerLog } from './log.ts'
import { nodeRuntime } from './node-runtime.ts'
import { paths } from './paths.ts'
import { entryFor } from './version-store.ts'

/** A backend that reached readiness. */
export interface BackendInfo {
  /** dsh version the backend runs. */
  version: string
  /** Process id of the supervisor, which is the handle used to reap the tree. */
  pid: number
  /** Authenticated loopback URL, including the one-time token, for the window to load. */
  url: string
  /** Loopback port the backend listens on. */
  port: number
}

/** How to start the backend. */
export interface BackendOptions {
  /** Exact dsh version to run. */
  version: string
  /** Preferred loopback port; `0` lets the OS choose. */
  port: number
  /** Harness home override; absent uses the product default. */
  dshHome?: string
  /** How long to wait for the readiness line. */
  timeoutMs?: number
}

/** Milliseconds to wait for the readiness line before failing the launch. */
const DEFAULT_TIMEOUT_MS = 180_000

/** Milliseconds a graceful stop is given before the process group is killed. */
const STOP_GRACE_MS = 8000

/** Matches the harness readiness line, whose URL carries the one-time token. */
const READY_PATTERN = /dsh web:\s+(https?:\/\/\S+)/
/** Matches ANSI colour sequences that a terminal-capable logger may emit. */
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g

/** Remove ANSI colour from a stream line. @param line - Raw line. */
const stripAnsi = (line: string): string => line.replace(ANSI_PATTERN, '')

/**
 * Whether the OS will let us bind a loopback port right now.
 * @param port - Candidate port.
 * @returns `true` when the port is free.
 */
const portIsFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => { resolve(false) })
    probe.once('listening', () => { probe.close(() => { resolve(true) }) })
    probe.listen({ port, host: '127.0.0.1', exclusive: true })
  })

/**
 * Choose the port the backend should use.
 * @param preferred - Port the user prefers; `0` asks the OS to choose.
 * @returns The preferred port when it is free, otherwise `0` so the OS assigns one.
 */
export const resolvePort = async (preferred: number): Promise<number> => {
  if (preferred <= 0) return 0
  return (await portIsFree(preferred)) ? preferred : 0
}

/** Runs one harness backend and guarantees its teardown. */
export class BackendService {
  private child: ChildProcess | undefined
  private current: BackendInfo | undefined
  private stopping = false

  /**
   * @param log - Shared container log.
   * @param onStopped - Called when a running backend ends; `unexpected` is true
   *   when the backend died without a stop request.
   */
  constructor(
    private readonly log: ContainerLog,
    private readonly onStopped: (unexpected: boolean, detail?: string) => void,
  ) {}

  /** Whether a backend is running. */
  get running(): boolean {
    return this.child !== undefined
  }

  /** The running backend, absent when none is running. */
  get info(): BackendInfo | undefined {
    return this.current
  }

  /**
   * Start the backend and resolve once it serves requests.
   * @param options - Version, port, and optional harness home.
   * @returns The ready backend.
   * @throws When the version is unavailable, the child cannot start, it exits
   *   before readiness, or readiness does not arrive within the timeout.
   */
  async start(options: BackendOptions): Promise<BackendInfo> {
    if (this.child !== undefined) throw new Error('the backend is already running')
    const entry = entryFor(options.version)
    if (entry === undefined) throw new Error(`dsh ${options.version} is not installed`)
    const runtime = nodeRuntime()
    this.stopping = false
    const args = [
      paths().supervisor,
      // The supervisor polls this process so a hard kill still tears the harness
      // down; see supervisor.mjs for why an input-pipe EOF is not enough.
      '--parent',
      String(process.pid),
      '--',
      runtime.command,
      ...runtime.argsPrefix,
      entry,
      'web',
      '--no-open',
      '--port',
      String(options.port),
    ]
    // A Finder-launched container inherits launchd's minimal PATH, which hides
    // every tool the user installed with Homebrew or in their home directory.
    const env = backendEnvironment(process.env, options.dshHome === undefined || options.dshHome === '' ? {} : { DSH_HOME: options.dshHome })
    this.log.push('backend', `starting dsh ${options.version} under ${runtime.source} Node.js on port ${String(options.port)}`)
    this.log.push('backend', `tool PATH: ${env['PATH'] ?? ''}`)
    const child = spawn(runtime.command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    this.child = child
    const pid = child.pid
    if (pid === undefined) {
      this.child = undefined
      throw new Error('the supervisor process did not start')
    }
    // Holding the write end open is what lets the supervisor detect our death.
    child.stdin?.on('error', () => {})

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return await new Promise<BackendInfo>((resolve, reject) => {
      let settled = false
      let tail: string[] = []
      const remember = (text: string): void => {
        tail = [...tail, text].slice(-12)
      }
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error !== undefined) reject(error)
      }
      const timer = setTimeout(() => {
        finish(new Error(`dsh did not report readiness within ${String(Math.round(timeoutMs / 1000))}s`))
        void this.stop()
      }, timeoutMs)

      const consume = (chunk: Buffer): void => {
        const text = chunk.toString()
        this.log.push('backend', text)
        for (const raw of text.split(/\r?\n/)) {
          const line = stripAnsi(raw).trim()
          if (line === '') continue
          remember(line)
          const match = READY_PATTERN.exec(line)
          if (match?.[1] === undefined || settled) continue
          let url: URL
          try {
            url = new URL(match[1])
          } catch {
            continue
          }
          const port = Number(url.port)
          const info: BackendInfo = { version: options.version, pid, url: match[1], port }
          this.current = info
          this.log.push('backend', `ready on http://${url.host}/`)
          finish()
          resolve(info)
        }
      }

      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)

      child.once('error', (error) => {
        this.child = undefined
        const failure = new Error(`could not start the dsh backend: ${error.message}`)
        this.log.push('backend', failure.message)
        finish(failure)
      })

      child.once('exit', (code, signal) => {
        const wasStopping = this.stopping
        this.child = undefined
        const wasReady = this.current !== undefined
        this.current = undefined
        const detail = `dsh exited with ${code === null ? `signal ${String(signal)}` : `code ${String(code)}`}${
          tail.length === 0 ? '' : `\n${tail.join('\n')}`
        }`
        this.log.push('backend', `stopped (${code === null ? `signal ${String(signal)}` : `code ${String(code)}`})`)
        if (!settled) {
          finish(new Error(`dsh stopped before it was ready: ${detail}`))
          return
        }
        if (wasReady || wasStopping === false) this.onStopped(!wasStopping, redact(detail))
      })
    })
  }

  /**
   * Stop the backend and wait for the process group to disappear.
   * @returns Completion once the child has exited or the grace period expired.
   */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    this.log.push('backend', 'stopping')
    this.signalTree(child.pid, 'SIGTERM')
    const deadline = Date.now() + STOP_GRACE_MS
    while (this.child !== undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (this.child !== undefined) {
      this.log.push('backend', 'graceful stop timed out; killing the process group')
      this.signalTree(child.pid, 'SIGKILL')
      this.child = undefined
      this.current = undefined
    }
  }

  /**
   * Kill the backend without waiting, for use in a `process.on('exit')` handler
   * where no asynchronous work can run.
   */
  stopSync(): void {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    this.signalTree(child.pid, 'SIGKILL')
    this.child = undefined
    this.current = undefined
  }

  /**
   * Signal a supervisor and everything it owns.
   * @param pid - Supervisor process id.
   * @param signal - Signal name; Windows always terminates the tree.
   */
  private signalTree(pid: number | undefined, signal: NodeJS.Signals): void {
    if (pid === undefined) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      return
    }
    try {
      // The supervisor leads its own group, so a negative pid reaches the
      // supervisor, the harness, and every process the harness spawned.
      process.kill(-pid, signal)
    } catch {
      try {
        process.kill(pid, signal)
      } catch {
        // Already gone.
      }
    }
  }
}
