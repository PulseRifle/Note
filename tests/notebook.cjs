const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const file=req.url==='/recording.js'?'recording.js':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'..',file)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('https://cdn.tailwindcss.com/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);assert(await page.locator('#contentsView').isVisible());
  const fab=await page.locator('#newNoteBtn').boundingBox();assert(fab.y>700);assert.equal(fab.width,fab.height);
  await page.locator('#newNoteBtn').click();assert(await page.locator('#newNoteMenu').isVisible());
  await page.locator('#newTextNoteBtn').click();assert(await page.locator('#textPanel').isVisible());assert(!await page.locator('#drawingPanel').isVisible());
  await page.locator('#noteTextarea').fill('분리된 텍스트 메모를 저장하고 복원합니다.');await page.locator('#textPreview').fill('텍스트 검증');await page.locator('#saveTextBtn').click();await page.locator('#backToContentsBtn').click();
  await page.locator('#newNoteBtn').click();await page.locator('#newDrawingNoteBtn').click();assert(!await page.locator('#textPanel').isVisible());
  for(const tool of ['pen','fountain','pencil','highlighter','eraser','line','rectangle','ellipse']){assert(await page.locator(`[data-tool="${tool}"]`).getAttribute('aria-label'));assert(!/^[가-힣\s]+$/.test(await page.locator(`[data-tool="${tool}"]`).textContent()));}
  const toolbar=await page.locator('.drawing-toolbar').boundingBox();assert(toolbar.height<180,`compact toolbar: ${toolbar.height}`);
  const canvasBox=await page.locator('#drawingCanvas').boundingBox();assert(Math.abs(canvasBox.width/canvasBox.height-210/297)<.002);
  const blank=await page.evaluate(()=>exportInk());
  async function draw(x,y){
   await page.locator('#drawingCanvas').evaluate(c=>window.scrollTo(0,window.scrollY+c.getBoundingClientRect().top-160));
   const b=await page.locator('#drawingCanvas').boundingBox();await page.mouse.move(b.x+x,b.y+y);await page.mouse.down();await page.mouse.move(b.x+x+70,b.y+y+70,{steps:5});await page.mouse.up();
  }
  await draw(30,30);const first=await page.evaluate(()=>exportInk());assert.notEqual(first,blank);
  await page.locator('#audioRecordBtn').click();await page.waitForFunction(()=>document.getElementById('audioRecordBtn').getAttribute('aria-pressed')==='true');
  await page.locator('#addPageBtn').click();assert.equal(await page.locator('#pageIndicator').textContent(),'2 / 2');assert.equal(await page.evaluate(()=>exportInk()),blank);
  await draw(100,100);const second=await page.evaluate(()=>exportInk());assert.notEqual(second,first);
  await page.locator('#previousPageBtn').click();await page.waitForFunction(()=>!pageLoading);assert.equal(await page.evaluate(()=>exportInk()),first);
  await page.locator('#nextPageBtn').click();await page.waitForFunction(()=>!pageLoading);assert.equal(await page.evaluate(()=>exportInk()),second);
  assert.equal(await page.locator('#audioRecordBtn').getAttribute('aria-pressed'),'true');
  await page.waitForTimeout(1200);await page.locator('#audioRecordBtn').click();await page.waitForFunction(()=>document.getElementById('recordingCount').textContent==='1' && !window.hasPendingAudio());
  assert.equal(await page.locator('#recordingList audio').count(),1);await page.locator('#recordingList audio').evaluate(a=>a.play());await page.waitForTimeout(100);assert(await page.locator('#recordingList audio').evaluate(a=>!a.paused && !a.error));
  const downloadPromise=page.waitForEvent('download');await page.locator('#recordingList a').click();const download=await downloadPromise;assert.equal(await download.failure(),null);assert(download.suggestedFilename().endsWith('.m4a'));const audioFile=fs.readFileSync(await download.path());assert.equal(audioFile.toString('ascii',4,8),'ftyp','download must contain real MP4 data');
  await page.locator('.drawing-metadata summary').click();await page.locator('#drawingPreview').fill('두 페이지 필기');await page.locator('#saveDrawingBtn').click();
  await page.locator('#backToContentsBtn').click();assert.equal(await page.locator('.note-card').count(),2);
  await page.reload();await page.waitForFunction(()=>document.getElementById('recordingCount').textContent==='1');
  await page.getByRole('button',{name:'필기 메모 두 페이지 필기'}).click();await page.waitForFunction(()=>!pageLoading);assert.equal(await page.locator('#pageIndicator').textContent(),'1 / 2');assert.equal(await page.evaluate(()=>exportInk()),first);
  await page.locator('#nextPageBtn').click();await page.waitForFunction(()=>!pageLoading);assert.equal(await page.evaluate(()=>exportInk()),second);
  await page.locator('#previousPageBtn').click();await page.waitForFunction(()=>!pageLoading);await page.locator('.drawing-options summary').click();await page.locator('#clearCanvasBtn').click();await page.locator('#undoDrawingBtn').click();assert.equal(await page.evaluate(()=>exportInk()),first);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Legacy single-page landscape notes stay readable without stretching.
  await page.locator('#backToContentsBtn').click();
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=600;const cx=c.getContext('2d');cx.fillStyle='red';cx.fillRect(100,100,100,100);localStorage.setItem('smart-ai-notes-v1',JSON.stringify([{id:'legacy',type:'drawing',date:'2026-10-20',content:c.toDataURL(),preview:'이전 메모'}]));});
  await page.reload();await page.getByRole('button',{name:'필기 메모 이전 메모'}).click();await page.waitForFunction(()=>!pageLoading);
  assert(await page.evaluate(()=>inkCtx.getImageData(100,100,1,1).data[3]>0));assert.equal(await page.locator('#pageIndicator').textContent(),'1 / 1');
  // Permission denial leaves the editor usable and does not claim a recording exists.
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await page.locator('#audioRecordBtn').click();await page.waitForFunction(()=>document.getElementById('audioRecordStatus').textContent.includes('권한'));assert.equal(await page.locator('#audioRecordBtn').getAttribute('aria-pressed'),'false');
  // Unsupported M4A must not silently record WebM or request the microphone.
  await page.evaluate(()=>{MediaRecorder.isTypeSupported=()=>false;navigator.mediaDevices.getUserMedia=async()=>{throw new Error('must not request microphone');};});
  await page.locator('#audioRecordBtn').click();await page.waitForFunction(()=>document.getElementById('audioRecordStatus').textContent.includes('M4A 녹음을 지원하지'));
  assert.equal(await page.locator('#audioRecordBtn').getAttribute('aria-pressed'),'false');
  assert.deepEqual(errors,[]);
  console.log('PASS: floating type picker, separate editors, compact icons, A4 pages, page navigation, persistence, legacy import, recording while drawing/changing pages, M4A container/playback/download/reload, permission denial, unsupported M4A, mobile fit');
 } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
