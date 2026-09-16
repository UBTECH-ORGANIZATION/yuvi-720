#!/usr/bin/env node
/* Capture the instructor-guide screenshots.

     node scripts/docs/capture.mjs                       # every chapter
     node scripts/docs/capture.mjs --chapters=teacher-goals,mentoring
     node scripts/docs/capture.mjs --base=http://127.0.0.1:8720

   Point `--base` at a backend that is serving the built React bundle (the
   production shape), not at the Vite dev server: the guide should show what the
   deployed app looks like. */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadMap, selectChapters, parseArgs, csv, SHOTS_DIR } from './map.mjs'
import { launch, openSession, shooter, goto, settle, waitFor } from './harness.mjs'

const args = parseArgs()
const base = (args.base ?? process.env.BASE_URL ?? 'http://127.0.0.1:8720').replace(/\/$/, '')
const outRoot = args.out ? resolve(args.out) : SHOTS_DIR

const map = loadMap()
const chapters = selectChapters(map, csv(args.chapters))
if (chapters.length === 0) {
  console.log('Nothing to capture.')
  process.exit(0)
}

console.log(`📖 capturing ${chapters.length} chapter(s) from ${base}`)

const browser = await launch()
const failures = []
const sessions = []

/** Open an extra session mid-scenario (anonymous when `key` is null). */
async function newSession(key) {
  const account = key ? map.accounts[key] : null
  if (key && !account) throw new Error(`Unknown account key: ${key}`)
  const session = await openSession(browser, { base, account })
  sessions.push(session)
  return session
}

for (const chapter of chapters) {
  console.log(`\n▶ ${chapter.id} — ${chapter.title}`)
  const outDir = `${outRoot}/${chapter.id}`
  // Wipe first: a scenario that now takes three shots instead of four must not
  // leave the stale fourth behind for the PDF to pick up.
  rmSync(outDir, { recursive: true, force: true })

  let session = null
  try {
    const module = await import(new URL(`./scenarios/${chapter.scenario}.mjs`, import.meta.url).href)
    const scenario = module.default
    session = await newSession(chapter.account ?? null)
    await scenario.run({
      base,
      page: session.page,
      context: session.context,
      shoot: shooter(outDir),
      newSession,
      goto,
      settle,
      waitFor
    })
  } catch (err) {
    console.error(`   ❌ ${chapter.id}: ${err.message}`)
    failures.push(chapter.id)
  }
}

for (const session of sessions) await session.context.close().catch(() => {})
await browser.close()

if (failures.length) {
  console.error(`\n❌ failed chapters: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\n✅ screenshots captured')
