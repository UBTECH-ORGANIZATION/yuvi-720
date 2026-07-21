import { chromium } from 'playwright'
const B=process.env.B||'http://127.0.0.1:5173'
const b=await chromium.launch(); const p=await (await b.newContext()).newPage()
await p.goto(B,{waitUntil:'load'}); await p.waitForTimeout(2200)
await p.click('.landing720-login-btn.student'); await p.waitForSelector('[role="dialog"]'); await p.waitForTimeout(800)
await p.click('#auth-username')
for (const ch of 'gal') {
  await p.keyboard.type(ch)
  await p.waitForTimeout(120)
  console.log(`typed '${ch}' -> value:'${await p.inputValue('#auth-username')}' focus:${await p.evaluate(()=>document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName)}`)
}
await b.close()
