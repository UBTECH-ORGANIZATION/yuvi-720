import { chromium } from 'playwright'
const BASE='http://localhost:5173'
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:1400,height:1000}})
await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'gal',password:'Aa12345'}})
const page=await ctx.newPage()
await page.goto(`${BASE}/teacher`,{waitUntil:'load'})
await page.waitForSelector('.tch-difficulties',{timeout:30000})
await page.waitForTimeout(2500)
await page.locator('.tch-difficulties').first().screenshot({path:'/tmp/kpi/chip.png'})
const m = await page.evaluate(() => [...document.querySelectorAll('.tch-difficulty')].map(r => {
  const chip = r.querySelector('.tch-difficulty__subject'); if(!chip) return null
  const rb=r.getBoundingClientRect(), cb=chip.getBoundingClientRect()
  const title=r.querySelector('.tch-difficulty__title').getBoundingClientRect()
  return `chipTop-rowTop=${Math.round(cb.top-rb.top)} chipTop-titleTop=${Math.round(cb.top-title.top)}`
}).filter(Boolean))
console.log(m.join('\n'))
console.log('mood scope note:', await page.locator('.tch-stat__hint--scope').count())
await b.close()
