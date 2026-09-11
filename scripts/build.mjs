/** Bundles the Electron main process, the preload bridge, and copies static assets into `lib/`. */

import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, 'lib')

/** Shared bundler options; each target overrides `entryPoints`, `format`, and `outfile`. */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
}

/** Static assets copied verbatim; the renderer runs unbuilt in the window. */
const assets = [
  ['src/renderer', 'lib/renderer'],
  ['src/supervisor/supervisor.mjs', 'lib/supervisor.mjs'],
]

const build = async () => {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })

  await esbuild.build({
    ...shared,
    entryPoints: [join(root, 'src/main/main.ts')],
    format: 'esm',
    outfile: join(out, 'main.js'),
  })

  // The preload bridge runs in a sandboxed renderer, so it must be CommonJS.
  await esbuild.build({
    ...shared,
    entryPoints: [join(root, 'src/preload/preload.ts')],
    format: 'cjs',
    outfile: join(out, 'preload.cjs'),
  })

  for (const [from, to] of assets) {
    await cp(join(root, from), join(root, to), { recursive: true })
  }

  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  console.log(`built oh-my-deepseek ${version} into lib/`)
}

await build()
