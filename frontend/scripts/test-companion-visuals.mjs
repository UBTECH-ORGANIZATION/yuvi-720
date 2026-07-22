#!/usr/bin/env node
/**
 * Playwright E2E quality suite for Yuvi's general-purpose math visual tool.
 *
 * It uses the real React chat, Coach SSE endpoint, LLM scene planner and Manim
 * renderer. Each scenario verifies the learner-facing answer, the sanitized
 * scene's mathematical semantics, the rendered image, and the zoom UI. It also
 * writes an inspectable HTML report and screenshots under artifacts/.
 *
 * Run from frontend/: npm run test:companion-visuals
 * Optional: --headed, --scenario=linear, --limit=3, --base-url=http://...
 */

import { chromium } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, '').split('=')
    return [key, value.length ? value.join('=') : true]
  }),
)

const BASE_URL = String(args.get('base-url') || process.env.YUVI_BASE_URL || 'http://localhost:5173')
const HEADLESS = !args.has('headed')
const REQUEST_TIMEOUT_MS = Number(process.env.YUVI_VISUAL_TIMEOUT_MS || 120_000)
const ARTIFACT_ROOT = path.resolve(process.cwd(), '..', 'artifacts', 'companion-visuals')
const EPSILON = 0.14

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function approximately(a, b, tolerance = EPSILON) {
  return Math.abs(a - b) <= tolerance
}

function elements(scene, type) {
  return scene.elements.filter((element) => element.type === type)
}

function allCoordinates(scene) {
  const coordinates = []
  for (const element of scene.elements) {
    if (Array.isArray(element.points)) coordinates.push(...element.points)
    if (Array.isArray(element.center)) coordinates.push(element.center)
    if (Array.isArray(element.position) && element.type !== 'axes') coordinates.push(element.position)
  }
  return coordinates.filter((point) => Array.isArray(point) && point.length === 2)
}

function hasPoint(scene, expected, tolerance = EPSILON) {
  return allCoordinates(scene).some((point) => distance(point, expected) <= tolerance)
}

function requireTypes(scene, requirements) {
  for (const [type, minimum] of Object.entries(requirements)) {
    invariant(elements(scene, type).length >= minimum, `expected at least ${minimum} ${type} element(s)`)
  }
}

function requireAnyType(scene, types) {
  invariant(
    types.some((type) => elements(scene, type).length > 0),
    `expected one of these element types: ${types.join(', ')}`,
  )
}

function verifyAxesBounds(scene) {
  const axes = elements(scene, 'axes')[0]
  invariant(axes, 'graph scene must include axes')
  const [xMin, xMax] = axes.x_range
  const [yMin, yMax] = axes.y_range
  for (const [x, y] of allCoordinates(scene)) {
    invariant(x >= xMin - EPSILON && x <= xMax + EPSILON, `x=${x} lies outside axes [${xMin}, ${xMax}]`)
    invariant(y >= yMin - EPSILON && y <= yMax + EPSILON, `y=${y} lies outside axes [${yMin}, ${yMax}]`)
  }
}

function verifyPolylineRelation(scene, relation, { tolerance = 0.2, minimum = 5 } = {}) {
  const points = [...elements(scene, 'polyline'), ...elements(scene, 'line')]
    .flatMap((element) => element.points || [])
  invariant(points.length >= minimum, `expected at least ${minimum} sampled curve points`)
  const matching = points.filter(([x, y]) => Math.abs(y - relation(x)) <= tolerance)
  invariant(matching.length / points.length >= 0.85, `only ${matching.length}/${points.length} curve points satisfy the equation`)
}

function verifySimilarTriangles(scene) {
  const triangles = elements(scene, 'polygon').filter((element) => element.points?.length === 3)
  invariant(triangles.length >= 2, 'expected two triangle polygons')
  const sideLengths = (triangle) => triangle.points
    .map((point, index) => distance(point, triangle.points[(index + 1) % 3]))
    .sort((a, b) => a - b)
  const first = sideLengths(triangles[0])
  const second = sideLengths(triangles[1])
  const ratios = first.map((side, index) => second[index] / side)
  invariant(ratios.every((ratio) => approximately(ratio, ratios[0], 0.12)), `triangle side ratios are inconsistent: ${ratios.join(', ')}`)
}

function trianglePoints(scene) {
  const polygon = elements(scene, 'polygon').find((element) => element.points?.length === 3)
  if (polygon) return polygon.points
  const closedLine = elements(scene, 'polyline').find((element) =>
    element.points?.length >= 4 && distance(element.points[0], element.points.at(-1)) <= EPSILON,
  )
  return closedLine?.points.slice(0, 3)
}

function verifyRightTriangle(scene) {
  const triangle = trianglePoints(scene)
  invariant(triangle, 'expected a three-vertex polygon or closed polyline')
  const [a, b, c] = triangle
  const dotAt = (vertex, p1, p2) =>
    (p1[0] - vertex[0]) * (p2[0] - vertex[0]) + (p1[1] - vertex[1]) * (p2[1] - vertex[1])
  invariant(
    [dotAt(a, b, c), dotAt(b, a, c), dotAt(c, a, b)].some((dot) => Math.abs(dot) <= 0.15),
    'triangle does not contain a right angle',
  )
}

function verifyHypotenuseLabel(scene) {
  const triangle = elements(scene, 'polygon').find((element) => element.points?.length === 3)
  invariant(triangle, 'hypotenuse semantics require a triangle polygon')
  const lengths = triangle.points.map((point, index) => distance(point, triangle.points[(index + 1) % 3]))
  const longestIndex = lengths.indexOf(Math.max(...lengths))
  const label = triangle.side_labels?.[longestIndex] || ''
  invariant(/יתר|الوتر|hypotenuse/i.test(label), `hypotenuse label is not bound to longest edge ${longestIndex}: ${label}`)
}

function verifyParallelLines(scene) {
  const lines = elements(scene, 'line')
  invariant(lines.length >= 3, 'expected two parallel lines and one transversal')
  const slopes = lines.map((line) => {
    const [[x1, y1], [x2, y2]] = line.points
    return approximately(x1, x2, 0.01) ? Number.POSITIVE_INFINITY : (y2 - y1) / (x2 - x1)
  })
  const hasParallelPair = slopes.some((slope, index) =>
    slopes.slice(index + 1).some((other) =>
      (Number.isFinite(slope) && Number.isFinite(other) && approximately(slope, other, 0.08)) || slope === other,
    ),
  )
  invariant(hasParallelPair, `no parallel pair found among slopes ${slopes.join(', ')}`)
}

const scenarios = [
  {
    id: 'linear',
    name: 'Linear graph y=x',
    prompt: 'צור המחשה מדויקת של הישר y=x ברביע הראשון. השתמש בצירים מ-0 עד 5, קו שעובר דרך (0,0) עד (5,5), וסמן את הנקודות השלמות. הסבר בקצרה מה רואים.',
    answerTerms: [/y\s*=\s*x/i, /נקוד|ישר/],
    verify(scene) {
      requireTypes(scene, { axes: 1, point: 3 })
      requireAnyType(scene, ['line', 'polyline'])
      verifyAxesBounds(scene)
      verifyPolylineRelation(scene, (x) => x, { tolerance: 0.08, minimum: 2 })
      for (let value = 0; value <= 5; value += 1) invariant(hasPoint(scene, [value, value]), `missing (${value},${value})`)
    },
  },
  {
    id: 'linear-implicit',
    name: 'First-message implicit identity graph x=y',
    prompt: 'למה x=y הוא אותו ישר כמו y=x, ואיך הנקודות השלמות מ-0 עד 5 קשורות לזה?',
    answerTerms: [/x\s*=\s*y|y\s*=\s*x/i, /ישר|נקוד/],
    verify(scene) {
      requireTypes(scene, { axes: 1 })
      requireAnyType(scene, ['line', 'polyline'])
      verifyAxesBounds(scene)
      verifyPolylineRelation(scene, (x) => x, { tolerance: 0.01, minimum: 2 })
    },
  },
  {
    id: 'quadratic',
    name: 'Quadratic parabola',
    prompt: 'צור גרף מדויק של הפרבולה y=x^2 עבור x בין -3 ל-3. סמן את הקודקוד ואת הנקודות (-2,4),(-1,1),(0,0),(1,1),(2,4), והסבר את הסימטריה.',
    answerTerms: [/פרבול|ריבוע|y\s*=\s*x(?:\^|\s*)2/i, /סימטר/],
    verify(scene) {
      requireTypes(scene, { axes: 1, polyline: 1, point: 3 })
      verifyAxesBounds(scene)
      verifyPolylineRelation(scene, (x) => x * x, { tolerance: 0.24, minimum: 5 })
      invariant(hasPoint(scene, [0, 0]), 'missing parabola vertex (0,0)')
    },
  },
  {
    id: 'absolute',
    name: 'Absolute-value graph',
    prompt: 'צור גרף מדויק של y=|x| עבור x בין -4 ל-4. הצג צורת V, סמן את הקודקוד (0,0) ושתי נקודות סימטריות, והסבר בקצרה.',
    answerTerms: [/ערך\s+ה?מוחלט|\|x\|/, /סימטר|V/],
    verify(scene) {
      requireTypes(scene, { axes: 1, polyline: 1 })
      verifyAxesBounds(scene)
      verifyPolylineRelation(scene, (x) => Math.abs(x), { tolerance: 0.15, minimum: 3 })
      invariant(hasPoint(scene, [0, 0]), 'missing absolute-value vertex')
    },
  },
  {
    id: 'sine',
    name: 'Sine wave',
    prompt: 'צור גרף מדויק של y=sin(x) מ-x=-6.28 עד x=6.28, עם לפחות 17 נקודות דגימה על העקומה. סמן את חציות ציר x והסבר מחזוריות.',
    answerTerms: [/sin|סינוס/i, /מחזור/],
    verify(scene) {
      requireTypes(scene, { axes: 1, polyline: 1 })
      verifyAxesBounds(scene)
      verifyPolylineRelation(scene, (x) => Math.sin(x), { tolerance: 0.3, minimum: 12 })
    },
  },
  {
    id: 'inverse',
    name: 'Inverse function',
    prompt: 'צור גרף מדויק של y=1/x עבור x בין -5 ל-5 בלי x=0. השתמש בשני קווים נפרדים לשני הענפים, אל תחבר דרך האפס, והסבר את האסימפטוטות.',
    // KaTeX's accessible DOM can linearize the fraction as either "1 x" or
    // "x 1", so accept those forms only when they remain bound to y=.
    answerTerms: [/1\s*\/\s*x|1\\over x|(?:y|𝑦)\s*=\s*(?:1\s*(?:x|𝑥)|(?:x|𝑥)\s*1)/i, /אסימפטוט/],
    verify(scene) {
      requireTypes(scene, { axes: 1, polyline: 2 })
      verifyAxesBounds(scene)
      const curves = elements(scene, 'polyline')
      invariant(curves.every((curve) => curve.points.every(([x]) => Math.abs(x) > 0.05)), 'inverse graph contains x=0')
      verifyPolylineRelation(scene, (x) => 1 / x, { tolerance: 0.28, minimum: 8 })
    },
  },
  {
    id: 'coordinate-circle',
    name: 'Circle on coordinate plane',
    prompt: 'צור שרטוט מדויק של המעגל x^2+y^2=9 על מערכת צירים. מרכזו (0,0), רדיוסו 3, וסמן את ארבע נקודות החיתוך עם הצירים. הסבר בקצרה.',
    answerTerms: [/מעגל/, /רדיוס|מרכז/],
    verify(scene) {
      requireTypes(scene, { axes: 1, circle: 1, point: 4 })
      verifyAxesBounds(scene)
      const circle = elements(scene, 'circle')[0]
      invariant(distance(circle.center, [0, 0]) <= EPSILON, 'circle center is not (0,0)')
      invariant(approximately(circle.radius, 3, 0.08), `circle radius is ${circle.radius}, expected 3`)
      for (const point of [[3, 0], [-3, 0], [0, 3], [0, -3]]) invariant(hasPoint(scene, point), `missing circle intercept ${point}`)
    },
  },
  {
    id: 'similar-triangles',
    name: 'Similar triangles',
    prompt: 'צור שרטוט של שני משולשים דומים: הראשון עם קודקודים (-5,-2),(-3,1),(-1,-2), והשני בהגדלה פי 1.5 עם אותה צורה בצד ימין. סמן זוויות מתאימות והסבר את יחס הדמיון.',
    answerTerms: [/דומ|מתאימ|אותו משולש/, /יחס|קנה מידה|פי\s*1\.5/],
    verify(scene) {
      requireTypes(scene, { polygon: 2 })
      verifySimilarTriangles(scene)
    },
  },
  {
    id: 'pythagorean',
    name: 'Right triangle and Pythagoras',
    prompt: 'צור משולש ישר זווית עם קודקודים (0,0),(4,0),(0,3). סמן את הניצבים 3 ו-4 ואת היתר 5, וסמן את הזווית הישרה. הסבר את משפט פיתגורס בלי תרגיל ASCII.',
    answerTerms: [/פיתגורס/, /יתר|ניצב/],
    verify(scene) {
      requireAnyType(scene, ['polygon', 'polyline'])
      verifyRightTriangle(scene)
      verifyHypotenuseLabel(scene)
      requireTypes(scene, { right_angle: 1 })
      for (const point of [[0, 0], [4, 0], [0, 3]]) invariant(hasPoint(scene, point), `missing triangle vertex ${point}`)
    },
  },
  {
    id: 'parallel-transversal',
    name: 'Parallel lines and transversal',
    prompt: 'צור שרטוט גאומטרי עם שני ישרים מקבילים אופקיים וישר שלישי שחוצה אותם באלכסון. סמן זוג זוויות מתחלפות שוות והסבר מדוע הן שוות.',
    answerTerms: [/מקביל/, /מתחלפ|זוו/],
    verify(scene) {
      requireTypes(scene, { line: 3 })
      invariant(
        elements(scene, 'angle').length + elements(scene, 'arc').length >= 2,
        'expected at least two angle markers',
      )
      verifyParallelLines(scene)
    },
  },
  {
    id: 'rectangle-diagonal',
    name: 'Rectangle with diagonal',
    prompt: 'צור מלבן שמרכזו בראשית, רוחבו 8 וגובהו 4, והוסף אלכסון מהפינה השמאלית התחתונה לימנית העליונה. סמן אורך ורוחב והסבר מה האלכסון יוצר.',
    answerTerms: [/מלבן/, /אלכסון/],
    verify(scene) {
      requireAnyType(scene, ['rectangle', 'polygon'])
      requireAnyType(scene, ['line', 'polyline'])
      const rectangle = elements(scene, 'rectangle')[0]
      const corners = rectangle
        ? [[rectangle.center[0] - rectangle.width / 2, rectangle.center[1] - rectangle.height / 2], [rectangle.center[0] + rectangle.width / 2, rectangle.center[1] + rectangle.height / 2]]
        : elements(scene, 'polygon').find((element) => element.points?.length === 4)?.points
      invariant(corners, 'rectangle geometry is missing')
      const width = Math.max(...corners.map(([x]) => x)) - Math.min(...corners.map(([x]) => x))
      const height = Math.max(...corners.map(([, y]) => y)) - Math.min(...corners.map(([, y]) => y))
      invariant(approximately(width, 8, 0.08), `rectangle width is ${width}`)
      invariant(approximately(height, 4, 0.08), `rectangle height is ${height}`)
    },
  },
  {
    id: 'midpoint',
    name: 'Coordinate midpoint',
    prompt: 'צור מערכת צירים וסמן את A=(1,1), B=(5,3), ואת נקודת האמצע M=(3,2). חבר את A ל-B והסבר כיצד מחשבים נקודת אמצע.',
    answerTerms: [/אמצע/, /ממוצע|מחברים/],
    verify(scene) {
      requireTypes(scene, { axes: 1, point: 3 })
      requireAnyType(scene, ['line', 'polyline'])
      verifyAxesBounds(scene)
      for (const point of [[1, 1], [5, 3], [3, 2]]) invariant(hasPoint(scene, point), `missing midpoint scenario point ${point}`)
    },
  },
]

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: HEADLESS })
  } catch (error) {
    console.warn(`Bundled Chromium unavailable (${error.message.split('\n')[0]}), trying installed Chrome.`)
    return chromium.launch({ headless: HEADLESS, channel: 'chrome' })
  }
}

async function runScenario(page, scenario, index) {
  const outputDir = path.join(ARTIFACT_ROOT, scenario.id)
  await mkdir(outputDir, { recursive: true })
  const startedAt = Date.now()
  const checks = []
  const pass = (message) => checks.push({ status: 'pass', message })

  await page.goto(`${BASE_URL}/student-dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const localizedBody = await page.locator('body').innerText()
  invariant(!localizedBody.includes('language.switcherLabel'), 'UI exposed raw locale keys during startup')
  await page.locator('.Yuvi-companion-dock__portal').waitFor({ state: 'attached', timeout: 30_000 })
  await page.locator('.Yuvi-companion-dock__portal').dispatchEvent('click')
  await page.locator('#Yuvi-companion-panel').waitFor({ state: 'visible', timeout: 30_000 })
  invariant(
    await page.locator('#Yuvi-companion-title').innerText() === 'יובי',
    'companion title was not localized before interaction',
  )
  const input = page.locator('.sp-companion__composer input')
  const submitButton = page.locator('.sp-companion__composer button[type="submit"]')
  await input.waitFor({ state: 'visible', timeout: 30_000 })
  await input.fill(scenario.prompt)
  const coachResponse = page.waitForResponse(
    (response) => response.url().includes('/api/agent/coach/stream') && response.request().method() === 'POST',
    { timeout: REQUEST_TIMEOUT_MS },
  ).catch(() => null)
  await submitButton.click({ timeout: 30_000 })

  const assistant = page.locator('.sp-companion__message-row--assistant').last()
  await assistant.waitFor({ state: 'visible', timeout: 5_000 })
  const assistantElement = await assistant.elementHandle()
  invariant(assistantElement, 'streaming assistant message was not mounted')
  await page.waitForFunction(
    (element) => (element.textContent || '').trim().length >= 4,
    assistantElement,
    { timeout: 30_000 },
  )
  const messageWasIncomplete = await assistant.getAttribute('data-message-complete') === 'false'
  const activityWhileIncomplete = await page.locator('.sp-companion__yuvi-stage').getAttribute('data-yuvi-activity')
  if (messageWasIncomplete) {
    invariant(activityWhileIncomplete === 'speaking' || activityWhileIncomplete === 'thinking', `unexpected active Yuvi state: ${activityWhileIncomplete}`)
    pass(`partial reply rendered before completion; Yuvi activity=${activityWhileIncomplete}`)
  } else {
    pass('assistant reply completed before the transient streaming state could be observed')
  }

  const figure = assistant.locator('.sp-companion__visual')
  await Promise.race([
    figure.waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS }),
    (async () => {
      const response = await coachResponse
      invariant(response, 'Coach streaming request did not complete')
      await response.finished()
      // The browser can finish consuming a short SSE body just before React
      // commits its final visual state. Keep the semantic assertion strict,
      // but allow that final render cycle to complete.
      await figure.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      invariant(await figure.count() > 0, 'Coach completed an explicit drawing request without a visual')
    })(),
  ])
  const image = figure.locator('img')
  await image.evaluate((element) => {
    if (element.complete && element.naturalWidth > 0) return
    return new Promise((resolve, reject) => {
      element.addEventListener('load', resolve, { once: true })
      element.addEventListener('error', reject, { once: true })
    })
  })

  const answer = (await assistant.innerText()).trim()
  const sceneRaw = await figure.getAttribute('data-visual-scene')
  invariant(sceneRaw, 'UI did not expose a sanitized visual scene')
  const scene = JSON.parse(sceneRaw)
  const renderer = await figure.getAttribute('data-renderer')
  const imageInfo = await image.evaluate((element) => ({
    src: element.src,
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    alt: element.alt,
  }))

  const dataMatch = imageInfo.src.match(/^data:(image\/(?:png|svg\+xml));base64,(.+)$/)
  invariant(dataMatch, 'visual image is not an embedded PNG/SVG data URL')
  const extension = dataMatch[1] === 'image/png' ? 'png' : 'svg'
  await writeFile(path.join(outputDir, `visual.${extension}`), Buffer.from(dataMatch[2], 'base64'))
  await writeFile(path.join(outputDir, 'answer.txt'), `${answer}\n`)
  await writeFile(path.join(outputDir, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`)

  invariant(answer.length >= 30, 'Coach answer is too short to be useful')
  invariant(scenario.answerTerms.every((pattern) => pattern.test(answer)), `answer is missing expected concepts: ${scenario.answerTerms}`)
  invariant(!answer.includes('```'), 'answer exposes a fenced code/ASCII block')
  invariant(!/\n\s*\d+\s*\|/.test(answer), 'answer exposes an ASCII graph')
  invariant(!/\\(?:left|right|frac|sqrt|begin|end)|\\[\[\]]/.test(answer), 'answer exposes raw LaTeX commands')
  invariant(!/!\[[^\]]*\]\([^)]*\)|\bmnt\/data\b/i.test(answer), 'answer exposes a Markdown image or internal file path')
  invariant(scene.use_visual === true && Array.isArray(scene.elements), 'invalid visual scene contract')
  invariant(renderer === 'manim', `expected Manim renderer, received ${renderer}`)
  invariant(imageInfo.naturalWidth >= 900 && imageInfo.naturalHeight >= 500, `unexpected image size ${imageInfo.naturalWidth}x${imageInfo.naturalHeight}`)
  invariant(imageInfo.alt.trim().length >= 10, 'visual needs meaningful alternative text')
  invariant(await figure.locator('h3').count() === 0, 'visual card repeated the scene title above the image')
  scenario.verify(scene)
  pass('answer, scene semantics, single-title image, dimensions and accessibility validated')

  await page.waitForFunction(
    (element) => element.getAttribute('data-message-complete') === 'true',
    assistantElement,
    { timeout: 5_000 },
  )
  await assistant.hover()
  const speechButton = assistant.locator('.sp-companion__speech')
  await speechButton.waitFor({ state: 'visible', timeout: 2_000 })
  const speechElement = await speechButton.elementHandle()
  invariant(speechElement, 'completed-message microphone is missing')
  await page.waitForFunction(
    (element) => Number(getComputedStyle(element).opacity) > 0.9,
    speechElement,
    { timeout: 2_000 },
  )
  pass('completed-message microphone appears on hover')

  if (scenario.id === 'pythagorean') {
    const speechRequest = page.waitForRequest(
      (request) => request.url().includes('/api/agent/coach/tts') && request.method() === 'POST',
      { timeout: 5_000 },
    )
    await speechButton.click()
    const request = await speechRequest
    const speechPayload = request.postDataJSON()
    invariant(typeof speechPayload.text === 'string' && speechPayload.text.length > 20, 'TTS request omitted Coach prose')
    invariant(!/data:image|base64|"visual"|"scene"/i.test(JSON.stringify(speechPayload)), 'TTS request leaked generated image/scene data')
    invariant(speechPayload.language === 'he', `TTS request language is ${speechPayload.language}`)
    invariant(['classic', 'girl'].includes(speechPayload.avatar_variant), `invalid avatar voice variant ${speechPayload.avatar_variant}`)
    pass('TTS sends Hebrew prose/math and the saved avatar voice variant, without image data')
    if (await speechButton.getAttribute('aria-label') !== 'הקראת ההודעה') await speechButton.click()
  }

  const imageButton = figure.locator('.sp-companion__visual-open')
  await imageButton.hover()
  const zoomOverlay = imageButton.locator('.sp-companion__visual-zoom')
  const zoomElement = await zoomOverlay.elementHandle()
  invariant(zoomElement, 'zoom overlay is missing')
  await page.waitForFunction(
    (element) => Number(getComputedStyle(element).opacity) > 0.9,
    zoomElement,
    { timeout: 2_000 },
  )
  pass('zoom overlay appears on hover')

  const panelBox = await page.locator('#Yuvi-companion-panel').boundingBox()
  const contentBox = await page.locator('.sp-learner-shell__content').boundingBox()
  const { viewportWidth, viewportHeight } = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }))
  invariant(panelBox && contentBox, 'panel/content geometry unavailable')
  invariant(
    Math.abs(panelBox.x + panelBox.width - viewportWidth) <= 1 && Math.abs(panelBox.y) <= 1,
    'chat is not the physical-right full-height column',
  )
  invariant(Math.abs(panelBox.y + panelBox.height - viewportHeight) <= 1, 'chat does not reach viewport bottom')
  invariant(Math.abs(contentBox.x) <= 1, 'page content did not stay anchored to the physical left')
  invariant(contentBox.x + contentBox.width <= panelBox.x + 1, 'page content did not make room for the right-side chat')

  const resizer = page.locator('.sp-companion__resizer')
  await resizer.hover()
  const resizerElement = await resizer.elementHandle()
  invariant(resizerElement, 'resize border is missing')
  await page.waitForFunction(
    (element) => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(element, '::before').backgroundColor),
    resizerElement,
    { timeout: 2_000 },
  )
  const resizeStyle = await resizer.evaluate((element) => ({
    cursor: getComputedStyle(element).cursor,
    borderColor: getComputedStyle(element, '::before').backgroundColor,
  }))
  invariant(resizeStyle.cursor === 'col-resize', `unexpected resize cursor ${resizeStyle.cursor}`)
  invariant(!['rgba(0, 0, 0, 0)', 'transparent'].includes(resizeStyle.borderColor), 'resize border did not turn purple on hover')
  const grip = await resizer.boundingBox()
  invariant(grip, 'resize grip geometry unavailable')
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 - 64, grip.y + grip.height / 2, { steps: 4 })
  await page.mouse.up()
  const resizedPanel = await page.locator('#Yuvi-companion-panel').boundingBox()
  const resizedContent = await page.locator('.sp-learner-shell__content').boundingBox()
  invariant(resizedPanel && resizedPanel.width >= panelBox.width + 55, 'dragging did not enlarge the panel')
  invariant(
    resizedContent && resizedContent.x + resizedContent.width <= resizedPanel.x + 1,
    'page did not reflow after resizing',
  )
  pass('full-height physical-right dock reflows the page and has a purple draggable border')

  await page.screenshot({ path: path.join(outputDir, 'chat.png') })
  await imageButton.click()
  const lightbox = page.locator('.sp-companion-lightbox')
  await lightbox.waitFor({ state: 'visible', timeout: 5_000 })
  const largeImage = lightbox.locator('img')
  invariant(await lightbox.locator('h2').count() === 0, 'lightbox repeated the scene title above the image')
  const largeBox = await largeImage.boundingBox()
  const thumbnailBox = await image.boundingBox()
  invariant(largeBox && thumbnailBox && largeBox.width > thumbnailBox.width, 'lightbox image is not larger than its thumbnail')
  await page.screenshot({ path: path.join(outputDir, 'zoom.png') })
  pass('click opens a larger image in the lightbox')
  await page.keyboard.press('Escape')
  invariant(await lightbox.count() === 0, 'Escape did not close the lightbox')
  invariant(await page.locator('#Yuvi-companion-panel').count() === 1, 'closing lightbox also closed chat')

  if (index === 0) {
    await page.setViewportSize({ width: 700, height: 900 })
    const mobilePanel = await page.locator('#Yuvi-companion-panel').boundingBox()
    const mobileContent = await page.locator('.sp-learner-shell__content').boundingBox()
    invariant(mobilePanel && approximately(mobilePanel.width, 700, 1), 'narrow-screen chat is not full width')
    invariant(mobileContent && Math.abs(mobileContent.x) <= 1, 'narrow-screen fallback still reserves a desktop column')
    invariant(await resizer.evaluate((element) => getComputedStyle(element).display) === 'none', 'narrow-screen fallback exposed the resize border')
    await page.setViewportSize({ width: 1440, height: 900 })
    pass('narrow-screen fallback uses a full-width drawer without reserving page width')
  }

  return {
    id: scenario.id,
    name: scenario.name,
    status: 'pass',
    durationMs: Date.now() - startedAt,
    answer,
    renderer,
    image: `${scenario.id}/visual.${extension}`,
    chatScreenshot: `${scenario.id}/chat.png`,
    zoomScreenshot: `${scenario.id}/zoom.png`,
    checks,
    order: index,
  }
}

async function main() {
  let selected = scenarios
  if (args.get('scenario')) {
    const requested = String(args.get('scenario')).split(',')
    selected = scenarios.filter((scenario) => requested.includes(scenario.id))
    invariant(selected.length === requested.length, `unknown scenario; available: ${scenarios.map((scenario) => scenario.id).join(', ')}`)
  }
  if (args.get('limit')) selected = selected.slice(0, Number(args.get('limit')))

  await rm(ARTIFACT_ROOT, { recursive: true, force: true })
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const runId = Date.now().toString(36)

  // Keep each UI scenario's server-side Coach history independent while still
  // sending the request from the real product form and consuming the real SSE.
  const installCoachRoute = (targetPage, scenarioId) => targetPage.route('**/api/agent/coach/**', async (route) => {
    const request = route.request()
    const learnerId = `visual-e2e-${runId}-${scenarioId}`
    const url = new URL(request.url())
    if (url.searchParams.has('learner_id')) url.searchParams.set('learner_id', learnerId)
    const options = { url: url.toString() }
    if (request.method() !== 'GET' && request.postData()) {
      const body = request.postDataJSON()
      options.postData = JSON.stringify({ ...body, learner_id: learnerId })
      options.headers = { ...request.headers(), 'content-type': 'application/json' }
    }
    await route.continue(options)
  })

  const results = []
  for (const [index, scenario] of selected.entries()) {
    const browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'he-IL',
      colorScheme: 'light',
    })
    const page = await context.newPage()
    await installCoachRoute(page, scenario.id)
    process.stdout.write(`[${index + 1}/${selected.length}] ${scenario.name} ... `)
    try {
      const result = await runScenario(page, scenario, index)
      results.push(result)
      console.log(`PASS (${(result.durationMs / 1000).toFixed(1)}s)`)
    } catch (error) {
      const outputDir = path.join(ARTIFACT_ROOT, scenario.id)
      await mkdir(outputDir, { recursive: true })
      await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {})
      results.push({
        id: scenario.id,
        name: scenario.name,
        status: 'fail',
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
        order: index,
      })
      console.log(`FAIL: ${results.at(-1).error}`)
    } finally {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    }
  }
  const passed = results.filter((result) => result.status === 'pass').length
  const failed = results.length - passed
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    passed,
    failed,
    total: results.length,
    results,
  }
  await writeFile(path.join(ARTIFACT_ROOT, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`)

  const cards = results.map((result) => result.status === 'pass' ? `
    <article class="pass">
      <h2>✅ ${escapeHtml(result.name)}</h2>
      <p>${escapeHtml(result.answer)}</p>
      <div class="images"><figure><img src="${result.image}" alt=""><figcaption>Manim output</figcaption></figure><figure><img src="${result.zoomScreenshot}" alt=""><figcaption>UI zoom</figcaption></figure></div>
    </article>` : `
    <article class="fail"><h2>❌ ${escapeHtml(result.name)}</h2><p>${escapeHtml(result.error)}</p><img src="${result.id}/failure.png" alt="Failure screenshot"></article>`).join('\n')
  const html = `<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Yuvi visual E2E report</title><style>body{font:16px system-ui;margin:0;padding:32px;background:#f5f3ff;color:#302b4a}header,article{max-width:1200px;margin:0 auto 24px;padding:24px;border-radius:22px;background:white;box-shadow:0 10px 30px #46399b18}.pass{border-inline-start:6px solid #21a67a}.fail{border-inline-start:6px solid #df704d}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}img{display:block;max-width:100%;border-radius:14px}figure{margin:0}figcaption{margin-top:8px;color:#77718f}</style><header><h1>Yuvi Companion Visual E2E</h1><p>${passed}/${results.length} passed · ${escapeHtml(BASE_URL)}</p></header>${cards}</html>`
  await writeFile(path.join(ARTIFACT_ROOT, 'index.html'), html)

  console.log(`\nReport: ${path.join(ARTIFACT_ROOT, 'index.html')}`)
  console.log(`Result: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
