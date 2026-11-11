import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const automation=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {chromium}=automation;const root=fileURLToPath(new URL('../',import.meta.url));const artifacts=path.join(root,'artifacts');const profile=await fs.mkdtemp(path.join(os.tmpdir(),'zhiyi-test-'));let context;const server=http.createServer(async(req,res)=>{if(req.url==='/visibility'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(path.join(root,'tests/fixtures/visibility.html')));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><title>Agent Reading Fixture</title></head><body style="max-width:720px;margin:60px auto;font:18px/1.8 system-ui"><h1>Reading about reliable agents</h1><p>A reliable agent needs clear context and a well-defined tool contract.</p><p>Preserve the <strong>original structure</strong> and keep links <a href="#test">readable for everyone</a>.</p><pre>const original = true;</pre><input value="Do not translate this input"><div id="dynamic"></div></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;

async function browserLocation() {
  if (process.env.BROWSER_EXECUTABLE) return { executablePath: process.env.BROWSER_EXECUTABLE };
  const channel = process.env.BROWSER_CHANNEL || 'msedge';
  if (channel === 'msedge' && process.platform === 'win32') {
    const driveRoot = path.parse(os.homedir()).root;
    const directories = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES,
      path.join(driveRoot, 'Program Files (x86)'), path.join(driveRoot, 'Program Files'),
      process.env.LOCALAPPDATA, path.join(os.homedir(), 'AppData', 'Local')].filter(Boolean);
    for (const directory of new Set(directories)) {
      const executablePath = path.join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
      try { await fs.access(executablePath); return { executablePath }; } catch {}
    }
  }
  return { channel };
}

try{context=await chromium.launchPersistentContext(profile,{...await browserLocation(),headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root],viewport:{width:1440,height:1000}});console.log('Browser launched');context.setDefaultTimeout(12000);const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');console.log('Worker ready');const extensionId=new URL(worker.url()).host;await worker.evaluate(()=>{globalThis.__mockCalls=0;globalThis.__sources=[];globalThis.__delay=0;globalThis.fetch=async(url,opts)=>{globalThis.__mockCalls++;const body=JSON.parse(opts.body);const src=body.messages[1].content;globalThis.__sources.push(src);if(globalThis.__delay)await new Promise(r=>setTimeout(r,globalThis.__delay));return new Response(JSON.stringify({choices:[{message:{content:'测试译文：'+src},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,prompt_cache_hit_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}});};});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome-extension://'+extensionId+'/dashboard.html');console.log('Dashboard loaded');await page.locator('#apiKey').fill('test-key-not-real');console.log('Key filled');await page.locator('#test').click();console.log('Test clicked');await page.getByText('连接测试通过',{exact:true}).waitFor();await page.locator('#translate').click();await page.getByText('翻译完成',{exact:true}).waitFor();const before=await worker.evaluate(()=>globalThis.__mockCalls);await page.locator('#translate').click();await page.waitForFunction(()=>!document.querySelector('#translate').disabled);assert.equal(await worker.evaluate(()=>globalThis.__mockCalls),before+1);assert.equal(await page.locator('#memory,#data,#correct').count(),0);await page.locator('#toast').evaluate(el=>el.hidden=true);await page.locator('#overview').scrollIntoViewIfNeeded();await fs.mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'dashboard-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,'dashboard-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
console.log('Dashboard checks passed');const article=await context.newPage();article.on('pageerror',e=>errors.push(e.message));await article.goto(base);await article.bringToFront();const cdp=await context.browser().newBrowserCDPSession();const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{}]});const target=targetInfos.find(t=>t.type==='tab'&&t.url.startsWith(base))||targetInfos.find(t=>t.type==='page'&&t.url.startsWith(base));await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});await article.bringToFront();const inject=(url=base+'/')=>worker.evaluate(async url=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===url);await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});},url);await inject();await article.waitForFunction(()=>document.querySelectorAll('.zhiyi-translation').length===3);assert.equal(await article.locator('p a').count(),1);
const controls=article.locator('#zhiyi-toolbar');
const ball=controls.getByRole('button',{name:'展开或收起翻译面板',exact:true});
await ball.click();assert.equal(await controls.locator('aside').isHidden(),true);
await ball.click();assert.equal(await controls.locator('aside').isVisible(),true);
await controls.getByRole('button',{name:'关闭控制条',exact:true}).click();
assert.equal(await ball.isVisible(),true);assert.equal(await controls.locator('aside').isHidden(),true);
await ball.click();
const oldBall=await ball.boundingBox();
await article.mouse.move(oldBall.x+24,oldBall.y+24);await article.mouse.down();
await article.mouse.move(oldBall.x-76,oldBall.y-56,{steps:8});await article.mouse.up();
const movedBall=await ball.boundingBox();
assert.ok(movedBall.x<oldBall.x-40&&movedBall.y<oldBall.y-40,'ball should drag');
assert.equal(await controls.locator('aside').isVisible(),true,'drag must not collapse panel');
await ball.focus();await ball.press('Enter');assert.equal(await controls.locator('aside').isHidden(),true);
await ball.press('Enter');assert.equal(await controls.locator('aside').isVisible(),true);

await article.setViewportSize({width:390,height:844});
const smallBall=await ball.boundingBox();
assert.ok(smallBall.x>=0&&smallBall.y>=0&&smallBall.x+smallBall.width<=390&&smallBall.y+smallBall.height<=844,'ball must stay in viewport');
await article.setViewportSize({width:1440,height:1000});
const resizedBall=await ball.boundingBox();
await article.mouse.move(resizedBall.x+24,resizedBall.y+24);await article.mouse.down();
await article.mouse.move(oldBall.x+24,oldBall.y+24,{steps:8});await article.mouse.up();
console.log('PASS: floating ball click, close, drag, keyboard controls and resize bounds.');

assert.equal(await article.locator('pre').textContent(),'const original = true;');assert.equal(await article.locator('input').inputValue(),'Do not translate this input');await article.locator('#zhiyi-toolbar').getByRole('button',{name:'仅译文',exact:true}).click();assert.ok(await article.locator('[data-zhiyi-hidden]').count()>0);await article.locator('#zhiyi-toolbar').getByRole('button',{name:'双语对照',exact:true}).click();assert.equal(await article.locator('[data-zhiyi-hidden]').count(),0);await article.evaluate(()=>{const p=document.createElement('p');p.id='new-p';p.textContent='New dynamic content should also be translated.';document.querySelector('#dynamic').append(p);});await article.locator('#new-p').scrollIntoViewIfNeeded();await article.waitForFunction(()=>document.querySelectorAll('.zhiyi-translation').length===4);await article.locator('#new-p').evaluate(el=>{el.firstChild.textContent='Updated dynamic content has a different meaning.';});await article.waitForFunction(()=>document.querySelector('#new-p .zhiyi-translation')?.textContent.includes('Updated dynamic'));await article.screenshot({path:path.join(artifacts,'bilingual-reading.png'),fullPage:true});await article.locator('#zhiyi-toolbar').getByRole('button',{name:'恢复原文',exact:true}).click();assert.equal(await article.locator('.zhiyi-translation').count(),0);assert.equal(await article.locator('#zhiyi-toolbar').count(),0);assert.equal(await article.locator('p a').count(),1);await article.evaluate(()=>scrollTo(0,0));await inject();await article.locator('#new-p').scrollIntoViewIfNeeded();await article.waitForFunction(()=>document.querySelectorAll('.zhiyi-translation').length===4);
// Regression: a profile form must not expose options or grow to thousands of pixels.
await article.goto(base+'/visibility');
await article.bringToFront();
const baselineHeight=await article.evaluate(()=>document.documentElement.scrollHeight);
const baselineForm=await article.locator('#settings').evaluate(el=>el.outerHTML.replaceAll(' style=""',''));
await worker.evaluate(()=>{globalThis.__sources=[];});
await inject(base+'/visibility');
await article.waitForFunction(()=>document.querySelector('#mixed .zhiyi-translation'));
await article.waitForTimeout(500);
let sources=await worker.evaluate(()=>globalThis.__sources);
assert.ok(sources.some(text=>text.includes('VISIBLE_PROSE')));
assert.ok(sources.some(text=>text.includes('MIXED_VISIBLE')));
assert.ok(sources.every(text=>!/(SECRET|PRIVATE_INPUT|PRIVATE_TEXTAREA|EDITABLE_PRIVATE|TIMEZONE_PRIVATE_BETA|TIMEZONE_PRIVATE_GAMMA|CLIPPED_PROSE|COLLAPSED_PROSE|REVEALED_PROSE|OFFSCREEN_PROSE|QUEUED_PROSE)/.test(text)),JSON.stringify(sources));
assert.ok(sources.includes('Choose a timezone'));
assert.ok(sources.includes('Navigation home'));
assert.ok(sources.includes('Bio'));
assert.ok(sources.includes('Account settings'));
assert.ok(sources.includes('Search documentation'));
assert.ok(sources.includes('Public visibility'));
assert.ok((await article.locator('#nav-link').textContent()).includes('测试译文'));
assert.equal(await article.locator('#nav-link').getAttribute('href'),'#help');
assert.equal(await article.locator('#empty-search').inputValue(),'');
assert.equal(await article.locator('#label-option').inputValue(),'public');
assert.equal(await article.locator('#label-option option').textContent(),'OPTION_LABEL_SECRET');
assert.ok(sources.includes('FORM_PRIVATE_HEADING'));
assert.ok(sources.includes('Save profile settings'));
assert.ok(sources.includes('TIMEZONE_PRIVATE_ALPHA'));
assert.equal(await article.locator('#timezone').inputValue(),'TIMEZONE_PRIVATE_ALPHA','translation must preserve implicit option value');
assert.equal(await article.locator('#profile-name').inputValue(),'PRIVATE_INPUT_VALUE');
assert.equal(await article.locator('#form textarea').inputValue(),'PRIVATE_TEXTAREA_VALUE');
assert.equal(await article.locator('#timezone option').count(),3);
assert.ok(await article.evaluate(()=>document.documentElement.scrollHeight)<baselineHeight+450,'visible translation must not explode page height');
await article.screenshot({path:path.join(artifacts,'visible-prose-regression.png'),fullPage:true});
await article.locator('#timezone').selectOption({index:1});
await article.waitForFunction(()=>document.querySelector('#timezone').selectedOptions[0].textContent.startsWith('测试译文'));
assert.equal(await article.locator('#timezone').inputValue(),'TIMEZONE_PRIVATE_BETA');
assert.equal(await article.locator('#timezone option').first().textContent(),'TIMEZONE_PRIVATE_ALPHA');
assert.ok(!(await worker.evaluate(()=>globalThis.__sources)).includes('TIMEZONE_PRIVATE_GAMMA'));
await article.evaluate(()=>{window.__submits=0;document.querySelector('#form').addEventListener('submit',e=>{e.preventDefault();window.__submits++;});});
await article.locator('#form button').click();assert.equal(await article.evaluate(()=>window.__submits),1,'translated button remains functional');
await article.locator('#collapsed summary').click();
await article.waitForFunction(()=>document.querySelector('#detail .zhiyi-translation'));
await article.evaluate(()=>{document.querySelector('#delayed').style.display='block';});
await article.locator('#delayed').scrollIntoViewIfNeeded();await article.waitForFunction(()=>document.querySelector('#delayed .zhiyi-translation'));
// A scrollable container has its own visible window.
await article.locator('#scroller').scrollIntoViewIfNeeded();await article.locator('#scroller').evaluate(el=>el.scrollTop=el.scrollHeight);
await article.waitForFunction(()=>document.querySelector('#clipped .zhiyi-translation'));
// Stop queuing after a fast scroll; an already transmitted request cannot be unsent.
await worker.evaluate(()=>{globalThis.__delay=800;});
await article.locator('#offscreen').scrollIntoViewIfNeeded();
for(let i=0;i<30;i++){if(await worker.evaluate(()=>globalThis.__sources.some(text=>text.includes('OFFSCREEN_PROSE'))))break;await article.waitForTimeout(30);}
await article.evaluate(()=>scrollTo(0,0));
await article.waitForTimeout(1100);
assert.ok(!(await worker.evaluate(()=>globalThis.__sources)).some(text=>text.includes('QUEUED_PROSE')),'stale offscreen queue must not dispatch');
assert.equal(await article.locator('#offscreen .zhiyi-translation').count(),0,'offscreen response must not change layout');
await worker.evaluate(()=>{globalThis.__delay=0;});
await article.locator('#offscreen').scrollIntoViewIfNeeded();
await article.waitForFunction(()=>document.querySelector('#offscreen .zhiyi-translation'));
assert.ok((await worker.evaluate(()=>globalThis.__sources)).some(text=>text.includes('OFFSCREEN_PROSE')));
await worker.evaluate(()=>{globalThis.__delay=0;});
await article.locator('#zhiyi-toolbar').getByRole('button',{name:'恢复原文',exact:true}).click();
assert.equal(await article.locator('.zhiyi-translation').count(),0);
assert.equal(await article.locator('#settings').evaluate(el=>el.outerHTML.replaceAll(' style=""','')),baselineForm);
assert.equal(await article.locator('#nav-link').textContent(),'Navigation home');
assert.equal(await article.locator('#tiny-label').textContent(),'Bio');
assert.equal(await article.locator('#empty-search').getAttribute('placeholder'),'Search documentation');
assert.equal(await article.locator('#label-option option').getAttribute('label'),'Public visibility');
assert.ok(await article.evaluate(()=>document.documentElement.scrollHeight)<baselineHeight+400);assert.equal(await article.locator('[data-zhiyi-hidden]').count(),0);
sources=await worker.evaluate(()=>globalThis.__sources);
assert.ok(sources.every(text=>!/(SECRET|PRIVATE_INPUT|PRIVATE_TEXTAREA|EDITABLE_PRIVATE|TIMEZONE_PRIVATE_GAMMA)/.test(text)),JSON.stringify(sources));
console.log('PASS: viewport-only prose, hidden descendants, selected option value preservation, visible form labels/buttons, clipped areas, expansion and DOM restoration.');
assert.deepEqual(errors,[]);console.log('PASS: real MV3 load; Dashboard save/test/translate; repeated requests bypass old cache; responsive layout; page bilingual DOM preservation; dynamic insertion and text update; original-only toggle; restore and reinject; no page errors.');console.log('Mock API requests:',await worker.evaluate(()=>globalThis.__mockCalls));
}catch(error){await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,'browser-test-result.log'),String(error));console.error('FAIL',error);if(context){for(const p of context.pages()){console.error('PAGE',p.url(),await p.locator('body').innerText().catch(()=>''));}await fs.mkdir(artifacts,{recursive:true});await context.pages().at(-1)?.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}finally{if(context)await Promise.race([context.close(),new Promise(r=>setTimeout(r,5000))]);await new Promise(r=>server.close(r));if(path.dirname(path.resolve(profile))===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('zhiyi-test-'))await fs.rm(profile,{recursive:true,force:true});}
