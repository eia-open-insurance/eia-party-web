const { chromium } = require('@playwright/test');
(async()=>{
 const b=await chromium.launch(); const p=await b.newPage();
 p.on('console', m=>console.log('CONSOLE',m.type(),m.text()));
 p.on('pageerror', e=>console.log('PAGEERROR',e.message));
 await p.goto('http://127.0.0.1:3001/');
 await p.waitForTimeout(2000);
 console.log('TITLE', await p.title());
 console.log('BODY', (await p.locator('body').innerText()).slice(0,500));
 await b.close();
})();
