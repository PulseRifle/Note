const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const file=req.url==='/recording.js'?'recording.js':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',file)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage({deviceScaleFactor:3});
  await page.route('https://cdn.tailwindcss.com/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#newNoteBtn').click();await page.locator('#newDrawingNoteBtn').click();
  const results=await page.evaluate(async()=>{
   const capture=canvas.setPointerCapture,originalLine=strokeCtx.lineTo,originalDraw=ctx.drawImage;
   let segments=0,frames=0;
   canvas.setPointerCapture=()=>{};
   strokeCtx.lineTo=function(...args){segments++;return originalLine.apply(this,args);};
   ctx.drawImage=function(...args){frames++;return originalDraw.apply(this,args);};
   const r=canvas.getBoundingClientRect();
   const event=(x,y)=>({pointerId:42,pointerType:'pen',pressure:.5,button:0,clientX:r.left+x*r.width/ink.width,clientY:r.top+y*r.height/ink.height,preventDefault(){}});
   try {
    resetInk();segments=0;frames=0;startDrawing(event(10,100));
    for(let i=1;i<=1200;i++) draw(event(10+i*.5,100+Math.sin(i/20)*20));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const result={segments,frames,previewWidth:canvas.width,sourceWidth:ink.width};
    stopDrawing();
    // No animation frame is allowed between these events. Final ink must still
    // include the last point when tool changes or pen-up flush the pending frame.
    resetInk();startDrawing(event(100,100));draw(event(300,100));stopDrawing();
    result.finalPointSaved=inkCtx.getImageData(300,100,1,1).data[3]>0;
    result.noPendingFrame=strokeFrame===0;
    return result;
   } finally {canvas.setPointerCapture=capture;strokeCtx.lineTo=originalLine;ctx.drawImage=originalDraw;}
  });
  assert(results.segments<=1201,JSON.stringify(results));assert(results.frames<=4,JSON.stringify(results));
  assert(results.previewWidth<=results.sourceWidth);assert(results.finalPointSaved);assert(results.noPendingFrame);
  console.log('PASS: 1200 inputs processed once, batched display frames, bounded preview resolution, synchronous final-stroke flush',JSON.stringify(results));
 } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
