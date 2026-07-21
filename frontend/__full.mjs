import { chromium } from 'playwright'
const B='http://127.0.0.1:5173'
const b=await chromium.launch(); const p=await (await b.newContext()).newPage()
const errs=[]; p.on('pageerror',e=>errs.push(e.message))
await p.goto(B,{waitUntil:'load'}); await p.waitForTimeout(2200)

// Escape still closes (proves the ref'd handler is live, not a stale closure)
await p.click('.landing720-login-btn.student'); await p.waitForSelector('[role="dialog"]')
await p.click('#auth-username'); await p.keyboard.type('gal')
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
console.log('Escape closes after typing:', (await p.locator('[role="dialog"]').count())===0)

// focus trap still cycles
await p.click('.landing720-login-btn.student'); await p.waitForSelector('[role="dialog"]'); await p.waitForTimeout(600)
const order=[]
for (let i=0;i<5;i++){ await p.keyboard.press('Tab'); order.push(await p.evaluate(()=>document.activeElement?.id||document.activeElement?.textContent?.trim()?.slice(0,8))) }
console.log('tab cycle stays inside:', JSON.stringify(order))

// real login, typing both fields
await p.click('#auth-username'); await p.keyboard.type('moti')
await p.click('#auth-password'); await p.keyboard.type('Aa12345')
console.log('typed values:', await p.inputValue('#auth-username'), '/', (await p.inputValue('#auth-password')).length, 'chars')
await p.click('[role="dialog"] button[type=submit]'); await p.waitForTimeout(7000)
console.log('login ->', new URL(p.url()).pathname)
console.log('errors:', errs.length?errs.slice(0,2):'none')
await b.close()
