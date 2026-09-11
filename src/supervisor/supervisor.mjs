#!/usr/bin/env node
/**
 * Backend supervisor.
 *
 * The container must guarantee that no harness process outlives the window that
 * started it — including when the main process dies without running any cleanup
 * code. This process exists only to make that guarantee hold.
 *
 * It runs the harness as a member of its own process group and shuts that whole
 * group down when any of these happen:
 *
 * - the parent process is gone, which is polled rather than inferred from
 *   standard input. A `SIGKILL`ed Electron main process leaves no cleanup code
 *   to run, and its renderer and GPU helpers can still hold the write end of
 *   this process's input pipe, so an EOF is not a reliable death signal;
 * - the parent closes this process's standard input, or disconnects an IPC
 *   channel, which catches the ordinary exit paths even earlier;
 * - this process receives `SIGTERM`, `SIGINT`, or `SIGHUP`.
 *
 * A graceful signal is followed by a hard kill of the group so a harness that
 * ignores `SIGTERM` still cannot survive.
 *
 * Usage: `node supervisor.mjs --parent <pid> -- <command> [args...]`
 *
 * Nothing is written to standard output here: the harness's own streams are
 * inherited, so the parent parses them exactly as if it had spawned the harness
 * directly.
 * @module supervisor
 */

import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'

/** Milliseconds a graceful signal is given before the group is killed outright. */
const GRACE_MS = 8000

/** How often the parent process is checked for liveness. */
const WATCH_MS = 500

const parentFlag = process.argv.indexOf('--parent')
const declaredParent = parentFlag === -1 ? undefined : Number(process.argv[parentFlag + 1])

const separator = process.argv.indexOf('--')
const command = separator === -1 ? undefined : process.argv[separator + 1]
const args = separator === -1 ? [] : process.argv.slice(separator + 2)

if (command === undefined) {
  console.error('supervisor: usage: supervisor.mjs -- <command> [args...]')
  process.exit(2)
}

/** Whether the harness runs in its own process group, which is how the group is signalled. */
const grouped = process.platform !== 'win32'

const child = spawn(command, args, {
  stdio: ['ignore', 'inherit', 'inherit'],
  // Sharing this supervisor's group is deliberate: on POSIX a group signal from
  // the container then reaches the harness and every process the harness spawns.
  detached: false,
  windowsHide: true,
})

let stopping = false

/** Signal the harness's whole tree, never just the process this supervisor started. */
const signalTree = (signal) => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    // Negative pid addresses the supervisor's own group, which the harness joined.
    process.kill(-process.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // The harness is already gone.
    }
  }
}

/** Stop the harness within the grace period, then force it. Idempotent. */
const shutdown = () => {
  if (stopping) return
  stopping = true
  signalTree('SIGTERM')
  const deadline = Date.now() + GRACE_MS
  const timer = setInterval(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      clearInterval(timer)
      process.exit(0)
    }
    if (Date.now() >= deadline) {
      signalTree('SIGKILL')
      clearInterval(timer)
    }
  }, 200)
  timer.unref()
}

child.on('error', (error) => {
  console.error(`supervisor: could not start the harness: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  // A harness that stops on its own is reported to the parent verbatim; a
  // harness reaped during shutdown is a successful stop.
  process.exit(stopping ? 0 : code ?? (signal === null ? 1 : 1))
})

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, shutdown)
}

/**
 * Whether the process that started this supervisor is still alive.
 *
 * POSIX reparents an orphan immediately, so the supervisor's own parent id
 * changing is exact proof rather than a heuristic. Windows does not reparent,
 * so liveness is probed with a zero signal instead.
 * @returns `true` while the original parent is still running.
 */
const parentIsAlive = () => {
  if (declaredParent === undefined || !Number.isInteger(declaredParent) || declaredParent <= 1) return true
  if (process.platform === 'win32') {
    try {
      process.kill(declaredParent, 0)
      return true
    } catch {
      return false
    }
  }
  return process.ppid === declaredParent
}

// Polling is the guarantee; the stdin and IPC paths below only make the common
// case faster, and are dropped if the parent never held them open.
const watchdog = setInterval(() => {
  if (!parentIsAlive()) shutdown()
}, WATCH_MS)

process.on('disconnect', shutdown)
process.stdin.resume()
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('exit', () => { clearInterval(watchdog) })
