/**
 * Rasterize one SVG to PNG at exact pixel sizes, using Chromium's own SVG
 * renderer.
 *
 * Drawing the SVG onto a canvas is deterministic: unlike capturing a window it
 * does not depend on the display's scale factor, so the generated icons are
 * byte-identical on a Retina laptop and a CI runner.
 *
 * Usage: `electron scripts/icon-render.cjs <svg> <outDir> <size,size,...>`
 * @module icon-render
 */

const { app, BrowserWindow } = require('electron')
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const [svgPath, outDir, sizesArg] = process.argv.slice(2)
if (!svgPath || !outDir || !sizesArg) {
  console.error('usage: electron icon-render.cjs <svg> <outDir> <size,size,...>')
  process.exit(2)
}
const sizes = sizesArg.split(',').map((value) => Number(value.trim()))

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = readFileSync(svgPath, 'utf8')
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  const window = new BrowserWindow({ show: false, width: 64, height: 64 })
  await window.loadURL('about:blank')
  await window.webContents.executeJavaScript(`window.__icon = new Image(); window.__icon.src = ${JSON.stringify(dataUrl)};`)
  await window.webContents.executeJavaScript(
    'new Promise((resolve, reject) => { if (window.__icon.complete) return resolve(true); window.__icon.onload = () => resolve(true); window.__icon.onerror = () => reject(new Error("the SVG could not be decoded")); })',
  )
  mkdirSync(outDir, { recursive: true })
  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0) throw new Error(`bad size: ${String(size)}`)
    const png = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas')
      canvas.width = ${size}
      canvas.height = ${size}
      const context = canvas.getContext('2d')
      context.clearRect(0, 0, ${size}, ${size})
      context.drawImage(window.__icon, 0, 0, ${size}, ${size})
      return canvas.toDataURL('image/png')
    })()`)
    const file = join(outDir, `icon-${size}.png`)
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'))
    console.log(`rendered ${size}x${size} -> ${file}`)
  }
  app.exit(0)
}).catch((error) => {
  console.error(`icon-render: ${error && error.message ? error.message : String(error)}`)
  app.exit(1)
})
