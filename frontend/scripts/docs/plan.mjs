#!/usr/bin/env node
/* Decide which guide chapters a change actually affects.

     node scripts/docs/plan.mjs --files=a.tsx,b.py
     git diff --name-only A B | node scripts/docs/plan.mjs
     node scripts/docs/plan.mjs --all
     node scripts/docs/plan.mjs --strict          # CI guard, see below

   The whole point of the pipeline is that a push to main does not re-shoot 30
   screenshots to document a change to one wizard. This is where that decision
   is made, and `watchPaths` in docs-map.json is the only input to it. */
import { loadMap, parseArgs, csv } from './map.mjs'

/** Minimal glob → RegExp. Supports `**` (any depth) and `*` (one segment). */
export function globToRegExp(glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` swallows the slash so `a/**` also matches `a/b` and `a`.
        i += 1
        if (glob[i + 1] === '/') i += 1
        out += '.*'
      } else {
        out += '[^/]*'
      }
    } else if ('.+^${}()|[]\\?'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return new RegExp(`${out}$`)
}

const matches = (file, patterns) => patterns.some((p) => globToRegExp(p).test(file))

export function planFrom(map, files) {
  const capture = new Set()
  const reasons = {}
  let rebuildPdf = false
  const unmapped = []

  const note = (id, file) => {
    capture.add(id)
    ;(reasons[id] ??= []).push(file)
  }

  for (const file of files) {
    // Prose, template or map edits change the PDF but not the pixels.
    if (file === 'docs/guide/docs-map.json' || file.startsWith('docs/guide/template/') ||
        file.startsWith('docs/guide/chapters/')) {
      rebuildPdf = true
      continue
    }
    // The pipeline's own code: re-shoot everything, it changed how we shoot.
    if (file.startsWith('frontend/scripts/docs/')) {
      for (const c of map.chapters) note(c.id, file)
      continue
    }
    if (matches(file, map.globalWatchPaths)) {
      for (const c of map.chapters) note(c.id, file)
      continue
    }
    let hit = false
    for (const chapter of map.chapters) {
      if (matches(file, chapter.watchPaths)) { note(chapter.id, file); hit = true }
    }
    // A brand-new feature folder that nothing watches would silently never be
    // documented. `--strict` turns that into a failing check on the PR.
    if (!hit && file.startsWith('frontend/src/features/')) unmapped.push(file)
  }

  const ids = map.chapters.filter((c) => capture.has(c.id)).map((c) => c.id)
  return { capture: ids, rebuildPdf: rebuildPdf || ids.length > 0, reasons, unmapped }
}

async function readStdin() {
  if (process.stdin.isTTY) return []
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data.split('\n').map((s) => s.trim()).filter(Boolean)
}

/* Only run the CLI when invoked directly — the unit test imports this file. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs()
  const map = loadMap()

  const plan = args.all
    ? { capture: map.chapters.map((c) => c.id), rebuildPdf: true, reasons: { '*': ['--all'] }, unmapped: [] }
    : planFrom(map, csv(args.files).length ? csv(args.files) : await readStdin())

  if (args.strict && plan.unmapped.length) {
    console.error('❌ These changed files are not covered by any chapter in docs/guide/docs-map.json:')
    for (const f of plan.unmapped) console.error(`   · ${f}`)
    console.error('   Add them to a chapter\'s watchPaths, or to globalWatchPaths.')
    process.exit(1)
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2))
  } else {
    console.log(plan.capture.length ? `chapters: ${plan.capture.join(',')}` : 'chapters: (none)')
    console.log(`rebuild-pdf: ${plan.rebuildPdf}`)
  }

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_OUTPUT,
      `chapters=${plan.capture.join(',')}\nrebuild_pdf=${plan.rebuildPdf}\n`)
  }
}
