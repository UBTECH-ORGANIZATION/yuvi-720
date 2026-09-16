#!/usr/bin/env node
/* Assemble the chapter markdown + captured screenshots into one RTL PDF.

     node scripts/docs/build-pdf.mjs

   Chromium renders the PDF because it is already a dependency here and it is
   the only renderer in this repo that gets Hebrew shaping and RTL page layout
   right without a LaTeX toolchain. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import MarkdownIt from 'markdown-it'
import { loadMap, GUIDE_DIR, CHAPTERS_DIR, parseArgs } from './map.mjs'

const args = parseArgs()
const map = loadMap()
const md = new MarkdownIt({ html: false, linkify: false, typographer: false })

const LANE_LABEL = { student: 'מסלול התלמיד', teacher: 'מסלול המורה', shared: 'כללי' }

let figureNumber = 0
const missingImages = []

/* Render one chapter, turning every image into a numbered <figure> and
   resolving its path — the markdown is written relative to `chapters/`, but the
   HTML is rendered from a different directory. */
function renderChapter(chapter, index) {
  const source = readFileSync(resolve(GUIDE_DIR, chapter.markdown), 'utf8')
  let html = md.render(source)

  html = html.replace(/<p><img src="([^"]+)" alt="([^"]*)"[^>]*><\/p>/g, (_, src, alt) => {
    const abs = resolve(CHAPTERS_DIR, src)
    if (!existsSync(abs)) {
      missingImages.push(`${chapter.id}: ${src}`)
      return ''
    }
    figureNumber += 1
    return `<figure><img src="${pathToFileURL(abs).href}" alt="${alt}">` +
      `<figcaption>איור ${figureNumber} — ${alt}</figcaption></figure>`
  })

  return `<section class="chapter" id="ch-${chapter.id}">` +
    `<div class="chapter-number">פרק ${index + 1} · ${LANE_LABEL[chapter.lane] ?? ''}</div>` +
    html +
    '</section>'
}

const body = map.chapters.map(renderChapter).join('\n')
const toc = map.chapters
  .map((c) => `<li>${c.title}<span class="lane">${LANE_LABEL[c.lane] ?? ''}</span></li>`)
  .join('\n')

const today = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric'
}).format(new Date())

const html = readFileSync(resolve(GUIDE_DIR, 'template/guide.html'), 'utf8')
  .replace(/{{TITLE}}/g, map.title)
  .replace(/{{SUBTITLE}}/g, map.subtitle)
  .replace(/{{DATE}}/g, `עודכן ${today}`)
  .replace('{{TOC}}', toc)
  .replace('{{BODY}}', body)

const buildDir = resolve(GUIDE_DIR, '.build')
mkdirSync(buildDir, { recursive: true })
const htmlPath = resolve(buildDir, 'guide.html')
writeFileSync(htmlPath, html, 'utf8')

if (missingImages.length) {
  console.warn(`⚠️ ${missingImages.length} screenshot(s) missing — run docs:capture first:`)
  for (const m of missingImages) console.warn(`   · ${m}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
await page.evaluate(() => document.fonts?.ready)

/* A PDF full of tofu boxes still "builds". Check that a Hebrew-capable face is
   actually installed before we ship the artifact — the Dockerfile makes the
   same assertion at image-build time for the same reason. */
const hebrewFont = await page.evaluate(() =>
  ['Heebo', 'Noto Sans Hebrew', 'Arial Hebrew'].some((f) => document.fonts.check(`12px "${f}"`))
)
if (!hebrewFont) {
  console.error('❌ No Hebrew font available to the renderer. Install fonts-noto-core (apt) and re-run.')
  await browser.close()
  process.exit(1)
}

const outPath = resolve(GUIDE_DIR, args.out ? String(args.out) : map.output)
mkdirSync(dirname(outPath), { recursive: true })
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#718096;padding:0 16mm;' +
    'font-family:sans-serif;display:flex;justify-content:space-between;direction:rtl">' +
    `<span>${map.title}</span><span class="pageNumber"></span></div>`,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' }
})
await browser.close()

console.log(`✅ ${outPath.split('/docs/guide/')[1] ?? outPath} — ${map.chapters.length} chapters, ${figureNumber} figures`)
if (missingImages.length) process.exitCode = 1
