import { chromium } from 'playwright'
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1475,height:820}})).newPage()
const dx=async()=>p.evaluate(()=>{const a=document.querySelector('.landing720-Yuvi-artwork').getBoundingClientRect(),q=document.querySelector('.landing720-Yuvi-pilot').getBoundingClientRect();return Math.round(Math.abs((a.left+a.width/2)-(q.left+q.width/2)))})
await p.goto('http://127.0.0.1:5174',{waitUntil:'load'}); await p.waitForTimeout(2500)
await p.locator('select').first().selectOption('en'); await p.waitForTimeout(3000)
console.log('dx after lang switch:', await dx())
await p.setViewportSize({width:1474,height:820}); await p.waitForTimeout(600)
console.log('dx after a 1px resize:', await dx())
await b.close()
