/**
 * Container and backend logging: a bounded in-memory tail for the console plus
 * an append-only file for support reports.
 *
 * Backend output is redacted before it is stored anywhere. The readiness line
 * carries a one-time process token in its query string, and that token is a
 * credential for the Harness API, so it must never reach a log file or the
 * renderer.
 * @module main/log
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'

/** Lines retained for the console. */
const MAX_LINES = 500
/** Longest stored line; longer lines are truncated. */
const MAX_LINE = 4000

/** Query parameter carrying the one-time Harness token. */
const TOKEN_PATTERN = /([?&]token=)[^&\s]+/g

/**
 * Replace the one-time Harness token with a placeholder.
 * @param text - Raw text from a backend or package-manager stream.
 * @returns Text safe to persist and display.
 */
export const redact = (text: string): string => text.replace(TOKEN_PATTERN, '$1<redacted>')

/** Bounded, redacting log shared by the main process and the console renderer. */
export class ContainerLog {
  private readonly lines: string[] = []
  private stream: WriteStream | undefined
  private listener: (() => void) | undefined

  /** @param file - Absolute path of the append-only log file. */
  constructor(private readonly file: string) {}

  /**
   * Observe appended lines, so a renderer showing the log stays live during a
   * long package operation instead of only updating on a state change.
   * @param listener - Called after one or more lines are appended.
   */
  onAppend(listener: () => void): void {
    this.listener = listener
  }

  /** Open the log file, creating its directory. Failures are non-fatal. */
  open(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      this.stream = createWriteStream(this.file, { flags: 'a' })
      this.stream.on('error', () => { this.stream = undefined })
    } catch {
      this.stream = undefined
    }
  }

  /**
   * Append one entry, splitting embedded newlines into separate lines.
   * @param source - Short origin tag such as `backend` or `npm`.
   * @param text - Raw text, possibly multi-line and possibly containing a token.
   */
  push(source: string, text: string): void {
    const stamp = new Date().toISOString().slice(11, 19)
    let appended = false
    for (const raw of redact(text).split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line === '') continue
      const entry = `[${stamp}] ${source}: ${line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line}`
      this.lines.push(entry)
      if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
      this.stream?.write(`${entry}\n`)
      appended = true
    }
    if (appended) this.listener?.()
  }

  /**
   * Copy of the retained tail.
   * @returns Lines oldest first.
   */
  tail(): string[] {
    return [...this.lines]
  }

  /** Flush and close the log file. */
  close(): void {
    this.stream?.end()
    this.stream = undefined
  }
}
