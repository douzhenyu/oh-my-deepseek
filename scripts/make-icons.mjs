/**
 * Regenerate the platform application icons from `build/icon-source.svg`.
 *
 * electron-builder picks up `build/icon.icns`, `build/icon.ico`, and
 * `build/icon.png` automatically, so this only has to keep those three current.
 * The SVG stays the single source of truth: the icon is never hand-edited as a
 * bitmap.
 *
 * Usage: `npm run icons`
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import electronBinary from 'electron'
import { at } from './lib/config.mjs'

const source = at('build', 'icon-source.svg')
const buildDir = at('build')
const scratch = join(buildDir, '.icons')
const iconset = join(buildDir, 'icon.iconset')

/** Pixel sizes macOS expects in an `.iconset`, plus the standalone PNG size. */
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

/** The `.iconset` entries: output file name mapped to the rendered pixel size. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

if (!existsSync(source)) throw new Error(`missing icon source: ${source}`)

rmSync(scratch, { recursive: true, force: true })
rmSync(iconset, { recursive: true, force: true })

console.log(`rasterizing ${source}`)
execFileSync(electronBinary, [at('scripts', 'icon-render.cjs'), source, scratch, SIZES.join(',')], { stdio: 'inherit' })

mkdirSync(iconset, { recursive: true })
for (const [name, size] of ICONSET) copyFileSync(join(scratch, `icon-${size}.png`), join(iconset, name))

// The standalone PNG is what a Windows target converts from when no `.ico` exists.
copyFileSync(join(scratch, 'icon-1024.png'), join(buildDir, 'icon.png'))
console.log('wrote build/icon.png (1024)')

if (process.platform === 'darwin') {
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' })
  console.log('wrote build/icon.icns')
} else {
  // electron-builder generates the platform icon from the PNG on other hosts.
  console.log('skipping build/icon.icns: iconutil is only available on macOS')
}

rmSync(iconset, { recursive: true, force: true })
rmSync(scratch, { recursive: true, force: true })
