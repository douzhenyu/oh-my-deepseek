/**
 * A read-only view of the harness session logs.
 *
 * Session artifacts are a concatenation of independently compressed Zstandard
 * frames: the harness appends one frame per durable batch, so a reader can find
 * frame boundaries by parsing frame structure without decompressing anything, and
 * then decode only the frames it has not seen. That is what lets the container
 * notice a finished turn without participating in the harness at all — it never
 * writes, never takes a lease, and cannot disturb a running conversation.
 *
 * Node's own `zstdDecompressSync` decodes a single frame and ignores the rest, so
 * the scan below is required rather than optional. It follows the frame layout
 * from the Zstandard specification: magic, frame header descriptor, block
 * headers, and an optional checksum.
 * @module main/session-log
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Little-endian magic number that opens every Zstandard frame. */
const ZSTD_MAGIC = 0xFD2FB528

/** File name of a compressed session log, newest session format. */
const SESSION_LOG = 'session.v3.jsonl.zstd'

/** A structurally complete frame's byte range. */
interface FrameRange {
  /** Inclusive start. */
  start: number
  /** Exclusive end. */
  end: number
}

/** Structural scan result. */
interface FrameScan {
  /** Complete frames in file order. */
  frames: FrameRange[]
  /** Start of a frame cut short by EOF, when the writer is mid-append. */
  tornStart?: number
}

/**
 * Locate every complete frame in a concatenated Zstandard stream.
 *
 * Blocks are walked by their declared sizes, so nothing is decompressed and a
 * partially written final frame is reported instead of throwing: a reader will
 * routinely catch the writer mid-append.
 * @param buffer - Every byte currently present in the artifact.
 * @returns Complete frame ranges and, when EOF interrupted one, its start.
 * @throws When the stream is not a well-formed concatenation of frames.
 */
export const scanFrames = (buffer: Buffer): FrameScan => {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid Zstandard frame magic at byte ${String(offset)}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerBytes) return { frames, tornStart: start }
    offset += headerBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      // An RLE block stores one byte regardless of the size it expands to.
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Everything the container needs from one session log. */
export interface SessionLogState {
  /** Absolute path of the artifact. */
  file: string
  /** Session identifier from the header frame. */
  sessionId: string
  /** Working directory the session belongs to. */
  cwd?: string
  /** How deep a delegated session this is; `0` is a conversation the user started. */
  delegationDepth: number
  /** Human-facing conversation title, once the harness has generated one. */
  title?: string
  /** Frames already decoded, so a later read starts after them. */
  framesRead: number
  /** Byte offset those frames ended at. */
  bytesRead: number
  /** Highest `turn/end` sequence already reported. */
  lastCompletedSeq: number
}

/** A turn that finished in a conversation the user is having. */
export interface TurnCompletion {
  /** Session identifier. */
  sessionId: string
  /** Conversation title when one exists. */
  title?: string
  /** Working directory the session belongs to. */
  cwd?: string
  /** Turn number that ended. */
  turn: number
  /** Why the turn ended, as the harness recorded it, for example `completed`. */
  reason: string
  /** Harness timestamp in milliseconds. */
  at: number
}

/**
 * Decode the frames a state has not read yet and fold them into it.
 *
 * A file that shrank or moved its frame boundaries (the harness truncates a torn
 * tail and rewrites it) is re-read from the start, because every frame index
 * after that point would be meaningless.
 * @param state - Per-file bookkeeping, updated in place.
 * @returns Completions discovered in the newly decoded frames.
 */
export const readNewEvents = (state: SessionLogState): TurnCompletion[] => {
  let buffer: Buffer
  try {
    buffer = readFileSync(state.file)
  } catch {
    return []
  }
  let { frames } = scanFrames(buffer)
  const previous = state.framesRead
  if (previous > 0 && (frames.length < previous || frames[previous - 1]?.end !== state.bytesRead)) {
    state.framesRead = 0
    state.bytesRead = 0
  }
  const completions: TurnCompletion[] = []
  for (let index = previous; index < frames.length; index += 1) {
    const range = frames[index]
    if (range === undefined) break
    let text: string
    try {
      text = zstdDecompressSync(buffer.subarray(range.start, range.end)).toString('utf8')
    } catch {
      // A frame that decodes as incomplete means the writer is mid-append; stop
      // here and pick it up on the next poll rather than losing the offset.
      break
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let event: { type?: string; data?: Record<string, unknown>; seq?: number; time?: number }
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      switch (event.type) {
        case 'session': {
          const header = event as unknown as { id?: string; cwd?: string; delegationDepth?: number }
          if (typeof header.id === 'string') state.sessionId = header.id
          if (typeof header.cwd === 'string') state.cwd = header.cwd
          if (typeof header.delegationDepth === 'number') state.delegationDepth = header.delegationDepth
          break
        }
        case 'session/title': {
          const title = (event.data as { title?: unknown } | undefined)?.title
          if (typeof title === 'string' && title.trim() !== '') state.title = title
          break
        }
        case 'turn/end': {
          const seq = typeof event.seq === 'number' ? event.seq : 0
          const data = event.data as { turn?: unknown; reason?: { kind?: unknown } } | undefined
          const turn = typeof data?.turn === 'number' ? data.turn : 0
          const reason = typeof data?.reason?.kind === 'string' ? data.reason.kind : 'completed'
          // Delegated sessions produce their own turns; reporting those would tell
          // the user a conversation finished while the agent is still working.
          if (state.delegationDepth === 0 && seq > state.lastCompletedSeq) {
            state.lastCompletedSeq = seq
            completions.push({
              sessionId: state.sessionId,
              turn,
              reason,
              at: typeof event.time === 'number' ? event.time : Date.now(),
              ...(state.title === undefined ? {} : { title: state.title }),
              ...(state.cwd === undefined ? {} : { cwd: state.cwd }),
            })
          }
          break
        }
        default:
          break
      }
    }
    state.framesRead = index + 1
    state.bytesRead = range.end
  }
  return completions
}

/**
 * Session logs under one harness home, newest first.
 * @param home - Absolute harness home.
 * @param limit - Maximum files to return, so an old home stays cheap to watch.
 * @returns Absolute paths newest first.
 */
export const listSessionLogs = (home: string, limit = 25): string[] => {
  const root = join(home, 'sessions')
  const found: { file: string; mtime: number }[] = []
  let workspaces: string[]
  try {
    workspaces = readdirSync(root)
  } catch {
    return []
  }
  for (const workspace of workspaces) {
    const directory = join(root, workspace)
    let sessions: string[]
    try {
      sessions = readdirSync(directory)
    } catch {
      continue
    }
    for (const session of sessions) {
      const file = join(directory, session, SESSION_LOG)
      try {
        found.push({ file, mtime: statSync(file).mtimeMs })
      } catch {
        // A session that was never materialized has no log yet.
      }
    }
  }
  return found.sort((left, right) => right.mtime - left.mtime).slice(0, limit).map((entry) => entry.file)
}
