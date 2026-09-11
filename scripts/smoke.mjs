/**
 * End-to-end verification of the container on this machine.
 *
 * This starts the real application with an isolated user data directory and an
 * isolated harness home, waits for it to report that the Harness page booted,
 * and then checks the promise that matters most: after the application exits,
 * no harness process survives.
 *
 * Usage:
 *   npm run smoke
 *   npm run smoke -- --install 0.1.5-rc.2    # also exercise the in-app update path
 *   npm run smoke -- --keep                  # reuse the previous run's user data
 *   npm run smoke -- --binary "<app binary>" # verify a packaged application
 *   npm run smoke -- --home separate         # verify the independent harness home
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { at, config } from './lib/config.mjs'

/** How long the whole automated launch may take. */
const TIMEOUT_MS = 300_000

const optionValue = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const binaryPath = optionValue('--binary')

const installVersion = optionValue('--install')
const homeMode = optionValue('--home')

const keep = process.argv.includes('--keep')

const userData = at('.smoke', 'user-data')
const harnessHome = at('.smoke', 'harness-home')
const reportPath = at('.smoke', 'report.json')
const electronLog = at('.smoke', 'electron.log')

/** Run a command to completion, inheriting stdio. */
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: at('.'), stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) => { code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)) })
  })

/** The dsh version bundled into application resources. */
const seedEntry = at('resources', 'dsh-seed', 'node_modules', ...config.dshPackage.split('/'), 'lib', 'bin.js')

/**
 * Command-line fragments that identify a harness process started by this
 * container. `dsh-seed/node_modules` matches both a development resources
 * directory and the `Resources` directory of a packaged application.
 */
const harnessMarkers = [
  'dsh-seed/node_modules',
  join(userData, 'dsh'),
]

/**
 * Processes still running a harness this container started, whether from the
 * bundled seed or from a version it installed into user data.
 * @returns Process ids as strings.
 */
const survivingHarnessProcesses = () => {
  const survivors = []
  for (const marker of harnessMarkers) {
    try {
      if (process.platform === 'win32') {
        const output = execFileSync('powershell', [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty ProcessId`,
        ], { encoding: 'utf8' })
        survivors.push(...output.split(/\s+/).filter((value) => value !== ''))
      } else {
        const output = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' })
        survivors.push(...output.split(/\s+/).filter((value) => value !== ''))
      }
    } catch {
      // pgrep and the PowerShell filter both exit non-zero when nothing matched.
    }
  }
  return survivors
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

// Processes matching the harness signature before this run starts. A leftover
// from an unrelated earlier run must not be reported as this run's orphan.
const baselineHarnessProcesses = new Set(survivingHarnessProcesses())

const failures = []
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failures.push(label)
}

if (!keep) if (!keep) rmSync(at('.smoke'), { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
mkdirSync(harnessHome, { recursive: true })

// Plant the state a real command-line home would carry, so the independent-home
// scenario can prove what is copied (credentials) and what is not (sessions).
const plantedCredentials = 'version: 1\nrefs:\n  SMOKE_TEST_KEY: smoke-sentinel\n'
// dsh refuses to load a credentials file that is readable beyond its owner, so
// the fixture must look exactly like a real one.
writeFileSync(join(harnessHome, '.credentials.yaml'), plantedCredentials, { mode: 0o600 })
mkdirSync(join(harnessHome, 'skills', 'smoke-marker'), { recursive: true })
writeFileSync(join(harnessHome, 'skills', 'smoke-marker', 'SKILL.md'), '# planted\n')
mkdirSync(join(harnessHome, 'sessions', '--smoke--', 'session-planted'), { recursive: true })
writeFileSync(join(harnessHome, 'sessions', '--smoke--', 'session-planted', 'marker'), 'planted\n')

if (binaryPath === undefined) {
  await run(process.execPath, ['scripts/build.mjs'])
  if (!existsSync(seedEntry)) {
    console.warn('no bundled dsh seed found; the automated launch will install a dsh version and needs network access')
  }
}

const electron = binaryPath ?? at('node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
console.log(`launching ${binaryPath === undefined ? 'the development container' : 'the packaged application'} headlessly (harness home: ${harnessHome})${installVersion === undefined ? '' : `, then installing dsh ${installVersion}`}`)
const started = Date.now()
const child = spawn(electron, [
  // A packaged binary is launched without an application directory argument.
  ...(binaryPath === undefined ? ['.'] : []),
  '--smoke',
  '--smoke-report',
  reportPath,
  '--smoke-user-data',
  userData,
  ...(installVersion === undefined ? [] : ['--smoke-install', installVersion]),
  ...(homeMode === undefined ? [] : ['--smoke-home-mode', homeMode]),
], {
  cwd: at('.'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: harnessHome },
})
let log = ''
child.stdout.on('data', (chunk) => { log += chunk.toString() })
child.stderr.on('data', (chunk) => { log += chunk.toString() })
writeFileSync(electronLog, '')

const timeout = setTimeout(() => {
  console.error('the container did not finish within the time limit; terminating it')
  child.kill('SIGKILL')
}, TIMEOUT_MS)

const exit = await new Promise((resolve) => {
  child.once('exit', (code, signal) => { resolve({ code, signal }) })
})
clearTimeout(timeout)
writeFileSync(electronLog, log)
console.log(`container exited after ${((Date.now() - started) / 1000).toFixed(1)}s with ${exit.code === null ? `signal ${exit.signal}` : `code ${exit.code}`}`)

if (!existsSync(reportPath)) {
  console.error(`no report was written; see ${electronLog}`)
  process.exit(1)
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'))

console.log('\nverification')
check('the container reached the ready phase', report.ok === true, report.error ?? '')
check('the console window rendered through the preload bridge', report.console?.ready === true, JSON.stringify(report.console ?? {}))
check(`the console is branded "${config.productName}"`, report.console?.heading === config.productName, report.console?.heading ?? '')
check('the Harness page booted', report.page !== undefined && report.page.mode !== 'queue', JSON.stringify(report.page ?? {}))
check('unauthenticated requests are rejected', report.http?.rootWithoutCookie === 401, `status ${String(report.http?.rootWithoutCookie)}`)
check('the one-time token URL is honoured', report.http?.tokenHandoff === 303, `status ${String(report.http?.tokenHandoff)}`)
if (homeMode !== undefined) {
  const separate = join(userData, 'harness-home')
  check(`the container switched to the ${homeMode} harness home`, report.home?.ok === true, report.home?.error ?? '')
  if (homeMode === 'separate') {
    const credentialsPath = join(separate, '.credentials.yaml')
    // The copied file keeps evolving: the running backend appends its own
    // session grants, so only the sentinel entry proves the copy.
    const credentials = existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf8') : ''
    const carried = credentials.includes('SMOKE_TEST_KEY: smoke-sentinel')
    check(
      'credentials were copied into the independent home',
      carried,
      carried ? 'the planted entry survived the copy' : credentials === '' ? 'missing' : 'the planted entry is absent',
    )
    const mode = existsSync(join(separate, '.credentials.yaml')) ? (statSync(join(separate, '.credentials.yaml')).mode & 0o777) : 0
    check('the copied credentials stay owner-only', mode === 0o600, `mode ${mode.toString(8)}`)
    check(
      'skills were copied into the independent home',
      existsSync(join(separate, 'skills', 'smoke-marker', 'SKILL.md')),
    )
    check('the container can switch back to the shared home', report.home?.returnedToShared === true)
    check(
      'sessions are not copied into the independent home',
      !existsSync(join(separate, 'sessions', '--smoke--', 'session-planted', 'marker')),
    )
  }
}
if (installVersion !== undefined) {
  check(`the container installed and switched to dsh ${installVersion}`, report.install?.ok === true, report.install?.error ?? '')
  check('the Harness page booted again on the new version', report.install?.pageAfterSwitch?.mode === 'live', JSON.stringify(report.install?.pageAfterSwitch ?? {}))
}
check('the container exited cleanly', exit.code === 0, `code ${String(exit.code)} signal ${String(exit.signal)}`)
if (report.backendPid !== undefined) {
  check('the supervised backend process is gone', !isAlive(report.backendPid), `pid ${String(report.backendPid)}`)
}
// A Finder-launched container inherits launchd's minimal PATH, so the backend
// would not see anything installed outside /usr/bin. The container logs the PATH
// it spawns with, which is what makes this checkable.
const containerLog = join(userData, 'logs', 'container.log')
const pathLine = (existsSync(containerLog) ? readFileSync(containerLog, 'utf8') : '')
  .split('\n')
  .filter((line) => line.includes('tool PATH: '))
  .pop() ?? ''
const expectedToolDirs = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'].filter((directory) => existsSync(directory))
const missingToolDirs = expectedToolDirs.filter((directory) => !pathLine.includes(directory))
check(
  'the backend PATH exposes user-installed tools',
  pathLine !== '' && missingToolDirs.length === 0,
  pathLine === '' ? 'no PATH was logged' : missingToolDirs.length > 0 ? `missing ${missingToolDirs.join(', ')}` : `${pathLine.split(':').length} entries`,
)

const survivors = survivingHarnessProcesses().filter((pid) => !baselineHarnessProcesses.has(pid))
check('no harness process outlived the container', survivors.length === 0, survivors.join(', '))

const finalVersion = report.install?.activeVersion ?? report.activeVersion ?? 'unknown'
console.log(`\nstarted on: ${report.activeVersion ?? 'unknown'}${report.install === undefined ? '' : ` → switched to ${String(report.install.activeVersion)}`}`)
console.log(`active version at exit: ${finalVersion} on port ${String(report.port ?? '?')}`)
console.log(`timings: launch ${String(report.launchMs ?? '?')}ms, console ${String(report.timings?.consoleBoot ?? '?')}ms, page ${String(report.timings?.pageBoot ?? '?')}ms`)
console.log(`report: ${join('.smoke', 'report.json')}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
