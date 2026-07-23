#!/usr/bin/env node
/**
 * Exports high-resolution marketing renders of Yuvi the robot.
 *
 * It loads the standalone Yuvi Studio renderer (docs/yubi-studio-demo.html),
 * hides all studio UI, and captures the WebGL canvas both as a crisp
 * transparent PNG and on the brand purple background.
 *
 * Run from frontend/:  node scripts/export-yuvi-marketing.mjs
 * Output: artifacts/yuvi-marketing/
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

// Reuse whichever Chromium build is already installed instead of forcing a download.
function findChromium() {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  const candidates = [
    'chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chromium_headless_shell-1181/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  ].map((rel) => path.join(root, rel))
  return candidates.find((p) => existsSync(p))
}

const REPO_ROOT = path.resolve(process.cwd(), '..')
const DEMO_HTML = path.join(REPO_ROOT, 'docs', 'yubi-studio-demo.html')
const OUT_DIR = path.join(REPO_ROOT, 'artifacts', 'yuvi-marketing')

// Square, high-DPI canvas for a print-friendly render.
const SIZE = 1400
const SCALE = 3 // effective 4200x4200

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const executablePath = findChromium()
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: SCALE,
  })

  await page.goto(pathToFileURL(DEMO_HTML).href, { waitUntil: 'load' })

  // Wait for THREE (loaded from CDN) to create the WebGL canvas.
  await page.waitForSelector('#canvas-host canvas', { timeout: 60_000 })

  // Strip the studio chrome so only the robot stage remains, full-bleed.
  await page.addStyleTag({
    content: `
      html, body { background: transparent !important; overflow: hidden !important; }
      .studio { grid-template-columns: 1fr !important; padding: 0 !important; gap: 0 !important; }
      .drawer, .stage__hint, .savepill, .toolbar, .yuvi-language-switcher { display: none !important; }
      .stage { background: transparent !important; box-shadow: none !important; border-radius: 0 !important; }
      #canvas-host { inset: 0 !important; }
    `,
  })

  // Freeze the idle turntable/bob so the hero faces forward, and let textures settle.
  await page.evaluate(() => {
    const c = document.querySelector('#canvas-host canvas')
    if (c) { c.style.width = '100%'; c.style.height = '100%' }
    window.dispatchEvent(new Event('resize'))
  })
  await page.waitForTimeout(1500)

  const canvas = page.locator('#canvas-host canvas')

  // 1) Transparent PNG (drop-in for any marketing background).
  const transparentPath = path.join(OUT_DIR, 'yuvi-robot-transparent.png')
  await canvas.screenshot({ path: transparentPath, omitBackground: true })
  console.log('✔ transparent:', transparentPath)

  // 2) On-brand purple gradient background.
  await page.addStyleTag({
    content: `
      body { background: radial-gradient(1200px 900px at 50% 20%, #f3e9ff 0%, #e7e0ff 45%, #7c5cff 120%) !important; }
    `,
  })
  await page.waitForTimeout(300)
  const brandedPath = path.join(OUT_DIR, 'yuvi-robot-brand.png')
  await page.locator('.stage').screenshot({ path: brandedPath })
  console.log('✔ branded:', brandedPath)

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
