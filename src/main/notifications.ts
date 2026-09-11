/**
 * Desktop notifications for finished conversations.
 *
 * Two rules shape this. A notification is only worth raising when the user is
 * not already looking at the window — announcing something on screen the user is
 * watching is noise — and it belongs to the conversation, not to the client: the
 * title is the conversation's own title so a glance is enough to know which one
 * finished.
 * @module main/notifications
 */

import { Notification } from 'electron'
import { containerConfig } from './config.ts'
import { displayNameOf } from './completion-watch.ts'
import type { TurnCompletion } from './session-log.ts'

/** Whether the platform can show a notification at all. */
export const notificationsSupported = (): boolean => Notification.isSupported()

/**
 * Whether a finished turn should be announced.
 *
 * Kept separate from showing it so the decision is testable without raising a
 * real notification.
 * @param options - Current focus and the user's preference.
 * @returns `true` when a notification should be shown.
 */
export const shouldNotify = (options: { focused: boolean; enabled: boolean }): boolean =>
  options.enabled && !options.focused && notificationsSupported()

/** How a completion notification is presented. */
export interface CompletionNotice {
  /** Conversation title, or the workspace folder when the harness has none. */
  title: string
  /** Localized one-line summary. */
  body: string
}

/**
 * Build the text of a completion notification.
 * @param completion - The turn that finished.
 * @param body - Localized summary line.
 * @returns Title and body ready to hand to the platform.
 */
export const completionNotice = (completion: TurnCompletion, body: string): CompletionNotice => ({
  title: displayNameOf(completion),
  body,
})

/**
 * Raise a notification on demand.
 *
 * This deliberately ignores the focus rule that governs real completions: the
 * point is to prove the platform will display one at all, which separates "the
 * system is not showing banners" from "the container never detected a finished
 * turn".
 * @param body - Localized line describing the test.
 * @param onClick - Invoked when the user activates the notification.
 * @returns Whether the platform accepted the notification.
 */
export const showTest = (body: string, onClick: () => void): boolean => {
  if (!notificationsSupported()) return false
  const notification = new Notification({ title: containerConfig().productName, body, silent: false })
  notification.on('click', onClick)
  notification.show()
  return true
}

/**
 * Show a completion notification.
 * @param completion - The turn that finished.
 * @param body - Localized summary line.
 * @param onClick - Invoked when the user activates the notification.
 */
export const showCompletion = (completion: TurnCompletion, body: string, onClick: () => void): void => {
  if (!notificationsSupported()) return
  const notice = completionNotice(completion, body)
  const notification = new Notification({ title: notice.title, body: notice.body, silent: false })
  notification.on('click', onClick)
  notification.show()
}
