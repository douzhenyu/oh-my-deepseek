/**
 * Watches the harness session logs for finished turns.
 *
 * The container cannot see turn lifecycle from the backend process it owns, and
 * injecting into the harness UI would couple it to markup that the harness is
 * free to change between the versions this client installs. The session log is
 * the stable surface instead: it is a versioned durable format the harness
 * already writes, and reading it costs nothing and disturbs nothing.
 *
 * Only conversations the user started are reported. A delegated session runs its
 * own turns, and announcing those would tell the user a conversation had
 * finished while the agent was still working.
 * @module main/completion-watch
 */

import { basename } from 'node:path'
import { listSessionLogs, readNewEvents, type SessionLogState, type TurnCompletion } from './session-log.ts'

/** How often the logs are re-read. */
const DEFAULT_INTERVAL_MS = 1000

/** Session logs kept under observation; an active session is always among the newest. */
const WATCH_LIMIT = 25

/** What the watcher needs from the rest of the container. */
export interface CompletionWatcherOptions {
  /** Resolves the harness home to watch, re-read each poll so a home switch applies. */
  home: () => string
  /** Receives every completion that happened while watching. */
  onComplete: (completion: TurnCompletion) => void
  /** Poll interval in milliseconds. */
  intervalMs?: number
}

/** Turns a session log directory into completion events. */
export class CompletionWatcher {
  private readonly states = new Map<string, SessionLogState>()
  private timer: NodeJS.Timeout | undefined

  /** @param options - Home resolver, completion sink, and poll interval. */
  constructor(private readonly options: CompletionWatcherOptions) {}

  /** Whether the watcher is polling. */
  get running(): boolean {
    return this.timer !== undefined
  }

  /** Begin polling. Repeated calls are ignored. */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { this.poll() }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS)
    // Watching must never be the reason the process stays alive.
    this.timer.unref()
  }

  /** Stop polling and forget what has been read. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.states.clear()
  }

  /**
   * Read the logs once.
   *
   * A session seen for the first time contributes nothing: its log is history,
   * and the user should not be told about conversations that finished before the
   * container opened. Everything already read is skipped, so this is cheap to
   * call on a timer.
   * @returns Completions discovered on this pass, oldest first.
   */
  poll(): TurnCompletion[] {
    const discovered: TurnCompletion[] = []
    for (const file of listSessionLogs(this.options.home(), WATCH_LIMIT)) {
      const known = this.states.get(file)
      const state = known ?? {
        file,
        sessionId: basename(file),
        delegationDepth: 0,
        framesRead: 0,
        bytesRead: 0,
        lastCompletedSeq: 0,
      }
      const completions = readNewEvents(state)
      if (known === undefined) {
        // First sighting: record what the log already contains so those turns are
        // never reported, then start reporting from the next one.
        this.states.set(file, state)
        continue
      }
      for (const completion of completions) {
        discovered.push(completion)
        this.options.onComplete(completion)
      }
    }
    this.pruneStates()
    return discovered
  }

  /** Drop bookkeeping for logs that have fallen out of the observed window. */
  private pruneStates(): void {
    if (this.states.size <= WATCH_LIMIT * 4) return
    const keep = new Set(listSessionLogs(this.options.home(), WATCH_LIMIT * 2))
    for (const file of [...this.states.keys()]) {
      if (!keep.has(file)) this.states.delete(file)
    }
  }
}

/** A conversation title that reads well in a notification. */
export const displayNameOf = (completion: TurnCompletion): string => {
  const title = completion.title?.trim()
  if (title !== undefined && title !== '') return title
  const folder = completion.cwd === undefined ? undefined : basename(completion.cwd)
  return folder === undefined || folder === '' ? 'DeepSeek Harness' : folder
}
