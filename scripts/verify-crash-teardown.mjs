/**
 * Verify that a hard-killed container leaves no harness behind.
 *
 * The normal quit path is covered by `npm run smoke`. This script covers the
 * path that has no cleanup code at all: the Electron main process is killed with
 * an uncatchable signal, and the supervised harness must still disappear. That
 * is the guarantee `supervisor.mjs` exists for, and it is the one most likely to
 * regress silently.
 *
 * Usage: `npm run verify:crash`
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import electronBinary from 'electron'
import { at } from './lib/config.mjs'

/** How long the harness may take to appear. */
const READY_TIMEOUT_MS = 120_000
/** How long the harness may survive the main process. */
const TEARDOWN_TIMEOUT_MS = 20_000

const userData = at('.smoke', 'crash-user-data')
const harnessHome = at('.smoke', 'crash-home')
const logFile = join(userData, 'logs', 'container.log')

/** Run a command and return its output, or an empty string when it fails. */
const capture = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/** Whether a process id is still alive. */
const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * The supervisor process of the running container.
 * @returns Its process id, or `undefined` while it has not started.
 */
const findSupervisor = () => {
  if (process.platform === 'win32') {
    const output = capture('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*supervisor.mjs*' } | Select-Object -ExpandProperty ProcessId",
    ])
    const pid = Number(output.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  }
  const output = capture('pgrep', ['-f', '[s]upervisor.mjs --parent'])
  const pid = Number(output.trim().split(/\s+/)[0])
  return Number.isInteger(pid) && pid > 1 ? pid : undefined
}

/**
 * The harness process the supervisor started.
 * @param supervisorPid - The supervisor's process id.
 * @returns The harness process id, or `undefined` while it has not started.
 */
const findHarness = (supervisorPid) => {
  if (process.platform === 'win32') {
    const output = capture('powershell', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${supervisorPid}" | Select-Object -ExpandProperty ProcessId`,
    ])
    const pid = Number(output.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  }
  const output = capture('pgrep', ['-P', String(supervisorPid)])
  const pid = Number(output.trim().split(/\s+/)[0])
  return Number.isInteger(pid) && pid > 1 ? pid : undefined
}

const failures = []
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(label)
}

rmSync(userData, { recursive: true, force: true })
rmSync(harnessHome, { recursive: true, force: true })
mkdirSync(harnessHome, { recursive: true })

console.log('launching the container directly so its main process id is the real one')
const electronLog = at('.smoke', 'crash-electron.log')
const child = spawn(electronBinary, ['.', '--smoke-user-data', userData], {
  cwd: at('.'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: harnessHome },
})
let electronOutput = ''
child.stdout.on('data', (chunk) => { electronOutput += chunk.toString() })
child.stderr.on('data', (chunk) => { electronOutput += chunk.toString() })
const mainPid = child.pid
if (mainPid === undefined) throw new Error('the container did not start')

const deadline = Date.now() + READY_TIMEOUT_MS
let supervisorPid
let harnessPid
while (Date.now() < deadline) {
  supervisorPid ??= findSupervisor()
  if (supervisorPid !== undefined) harnessPid ??= findHarness(supervisorPid)
  const ready = (() => {
    try {
      return readFileSync(logFile, 'utf8').includes('ready on')
    } catch {
      return false
    }
  })()
  // Wait for the backend to be fully serving: a harness interrupted mid-boot is
  // a different, slower case that this check is not about.
  if (supervisorPid !== undefined && harnessPid !== undefined && ready) break
  await new Promise((resolve) => setTimeout(resolve, 250))
}
writeFileSync(electronLog, electronOutput)
console.log(`main=${String(mainPid)} supervisor=${String(supervisorPid)} harness=${String(harnessPid)}`)
if (supervisorPid === undefined || harnessPid === undefined) {
  console.error('the container never started a supervised harness; see .smoke/crash-electron.log')
  process.exit(1)
}

console.log('sending SIGKILL to the main process')
process.kill(mainPid, 'SIGKILL')
const started = Date.now()
while (Date.now() - started < TEARDOWN_TIMEOUT_MS) {
  if (!isAlive(harnessPid) && !isAlive(supervisorPid)) break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const elapsed = Date.now() - started

console.log('\nverification')
check('the main process is gone', !isAlive(mainPid))
check('the harness did not outlive the main process', !isAlive(harnessPid), `survived ${String(elapsed)}ms`)
check('the supervisor did not outlive the main process', !isAlive(supervisorPid))
if (isAlive(harnessPid)) {
  // Leave no stray backend behind even when the check fails.
  try {
    process.kill(harnessPid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}
console.log(`\nteardown after a hard kill: ${elapsed}ms`)
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
