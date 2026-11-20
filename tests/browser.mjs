import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openDatabase,invite} from '../scripts/local-db.mjs';
import {localEnvironment,createLocalServer} from '../scripts/local.mjs';
import {build} from '../scripts/build.mjs';
build();
const db=openDatabase(':memory:',true),server=createLocalServer(localEnvironment(db));
let browser;
try {
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  for(const [name,width,height] of [['desktop',1440,900],['tablet',820,1180],['mobile',390,844]]){
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/retail/');
    await page.getByRole('heading',{name:'Delivery check'}).waitFor();
    await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').innerText(),'Skip to content');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('link',{name:'Account',exact:true}).click();
    await page.getByLabel('Test invitation').fill(await invite(db,'fixture-'+name));
    const signIn=page.getByRole('button',{name:'Sign in',exact:true});
    assert.equal(await signIn.isEnabled(),false);
    const checks=page.getByRole('checkbox');
    assert.equal(await checks.count(),4);
    for(let n=0;n<4;n++){await checks.nth(n).check();assert.equal(await signIn.isEnabled(),n===3);}
    await checks.nth(1).uncheck();assert.equal(await signIn.isEnabled(),false);await checks.nth(1).check();
    await signIn.click();
    await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
    await page.getByRole('link',{name:'Store',exact:true}).click();
    await page.getByRole('button',{name:'Add to basket'}).click();
    await page.getByText('Saved to your basket.').waitFor();
    await page.getByRole('link',{name:'Basket',exact:true}).click();
    await page.getByLabel('Test coupon (optional)').fill('TEST25');
    await page.getByRole('button',{name:'Place local test order'}).click();
    await page.getByText(/€3.00.*complete/).waitFor();
    await page.getByRole('link',{name:'Library',exact:true}).click();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download',exact:true}).click();
    assert.equal((await download).suggestedFilename(),'EuroLoot-verification.txt');await page.getByText('Download verified.').waitFor();
    await page.getByRole('link',{name:'Support',exact:true}).click();
    await page.getByLabel('Subject').fill('Download verified');await page.getByLabel('Details').fill('Testing the customer support workflow.');
    await page.getByRole('button',{name:'Submit ticket'}).click();await page.getByText(/Ticket opened. Reference/).waitFor();
    await page.getByRole('link',{name:'Developers',exact:true}).click();
    await page.getByLabel('Studio or organisation').fill('Fixture studio');await page.getByLabel('Product title').fill('Original test submission');await page.getByLabel('Details').fill('An original development fixture.');
    await page.getByRole('button',{name:'Submit for review'}).click();await page.getByText(/Submitted for review. Reference/).waitFor();
    await page.route('https://www.cheapshark.com/**',r=>r.fulfill({json:[]}));
    await page.goto(origin+'/');await page.getByRole('link',{name:/Enter the EuroLoot Store/}).click();await page.getByRole('heading',{name:'Delivery check'}).waitFor();
    assert.deepEqual(errors,[]);await context.close();console.log('Passed browser purchase, file, support and review journey: '+name);
  }
}finally{await browser?.close();if(server.listening)await new Promise(r=>server.close(r));db.sqlite.close();}
