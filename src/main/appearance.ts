/**
 * The container's own appearance.
 *
 * The client chrome has to follow the operating system's light/dark setting.
 * The harness UI already does: its theme preference defaults to `system`, so it
 * re-paints when the OS scheme flips. The console window and the window
 * backgrounds are the container's own, and they used to be hard-coded dark, which
 * left a dark panel sitting under a light menu bar on a light desktop.
 *
 * The console's palette lives in `console.css` behind `prefers-color-scheme`,
 * which Electron resolves from the same `nativeTheme` state read here. The two
 * must agree, and {@link consoleBackground} is the single source for the window
 * background that shows before the page paints.
 * @module main/appearance
 */

import { nativeTheme } from 'electron'

/** Window background for each scheme, matching `--bg` in `console.css`. */
const BACKGROUND = { dark: '#0d1117', light: '#ffffff' } as const

/**
 * Whether the operating system is currently asking for a dark interface.
 * @returns `true` for the dark scheme.
 */
export const prefersDark = (): boolean => nativeTheme.shouldUseDarkColors

/**
 * The colour a window paints before its page has rendered, and behind a resizing
 * window. Keeping it in step with the system avoids a dark flash on a light
 * desktop and the reverse.
 * @returns A `#rrggbb` colour.
 */
export const consoleBackground = (): string => (prefersDark() ? BACKGROUND.dark : BACKGROUND.light)

/** The two backgrounds, exported so an automated run can check the page agrees. */
export const backgrounds = (): { dark: string; light: string } => ({ ...BACKGROUND })

/**
 * Keep the application following the operating system rather than a fixed
 * scheme. Called once at startup so the intent is explicit; `system` is also
 * Electron's default.
 */
export const followSystemAppearance = (): void => {
  nativeTheme.themeSource = 'system'
}
