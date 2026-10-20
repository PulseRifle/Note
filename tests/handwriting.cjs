// Run with Node.js, Playwright and Chromium available: node tests/handwriting.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
        const page = await browser.newPage({hasTouch: true, viewport: {width: 1000, height: 700}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Styling is irrelevant to input regression checks; avoid a CDN dependency.
        await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({body: '', contentType: 'application/javascript'}));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('#newNoteBtn').click();
        const cdp = await page.context().newCDPSession(page);
        async function stroke(tool, pressure, start, end) {
            await page.locator(`[data-tool="${tool}"]`).click();
            await page.locator('#clearCanvasBtn').click();
            await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();
            const box = await page.locator('#drawingCanvas').boundingBox();
            const coords = p => ({x: box.x + p[0] * box.width / 1000, y: box.y + p[1] * box.height / 600});
            await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...coords(start), button:'left', buttons:1, pointerType:'pen', force:pressure});
            for (let i=1;i<=15;i++) {
                const t=i/15;
                await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...coords([start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t]), button:'left', buttons:1, pointerType:'pen', force:pressure});
            }
            await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...coords(end), button:'left', buttons:0, pointerType:'pen', force:0});
            return page.evaluate(() => {
                const data=inkCtx.getImageData(0,0,ink.width,ink.height).data;
                let count=0;
                for(let i=3;i<data.length;i+=4) if(data[i]>0) count++;
                return count;
            });
        }
        for (const tool of ['pen', 'pencil', 'fountain']) {
            const light=await stroke(tool,.08,[100,140],[330,140]);
            const heavy=await stroke(tool,.95,[100,140],[330,140]);
            assert(heavy>light*1.8, `${tool}: light=${light}, heavy=${heavy}`);
        }
        const alongNib=await stroke('fountain',.5,[100,300],[250,150]);
        const acrossNib=await stroke('fountain',.5,[100,150],[250,300]);
        assert(acrossNib>alongNib*2, `Flat nib direction contrast: ${alongNib}, ${acrossNib}`);
        const inkBeforeResize=await page.evaluate(()=>exportInk());
        await page.setViewportSize({width:700,height:700});
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>exportInk()),inkBeforeResize);
        await page.locator('#stylusOnly').check();
        await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();
        const b=await page.locator('#drawingCanvas').boundingBox();
        const x=b.x+60,y=b.y+80;
        const before=await page.evaluate(()=>({ink:exportInk(),scroll:document.scrollingElement.scrollTop}));
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({id:p[0],x:p[1],y:p[2]}))});
        await touch('touchStart',[[1,x,y]]);
        await touch('touchMove',[[1,x,y-50]]);
        await touch('touchEnd',[]);
        assert.deepEqual(await page.evaluate(()=>({ink:exportInk(),scroll:document.scrollingElement.scrollTop})),before,'one finger must neither draw nor scroll');
        await touch('touchStart',[[1,x,y],[2,x+50,y]]);
        await touch('touchMove',[[1,x,y+45],[2,x+50,y+45]]);
        await touch('touchEnd',[]);
        assert(await page.evaluate(()=>document.scrollingElement.scrollTop)<before.scroll-30,'two fingers scroll vertically');
        assert.equal(await page.evaluate(()=>exportInk()),before.ink,'two fingers must not draw');
        const scrollBeforePen=await page.evaluate(()=>document.scrollingElement.scrollTop);
        const penBox=await page.locator('#drawingCanvas').boundingBox();
        await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:penBox.x+60,y:penBox.y+60,button:'left',buttons:1,pointerType:'pen',force:.8});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:penBox.x+80,y:penBox.y+120,button:'left',buttons:1,pointerType:'pen',force:.8});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:penBox.x+80,y:penBox.y+120,button:'left',buttons:0,pointerType:'pen',force:0});
        assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),scrollBeforePen,'pen must not scroll');
        assert.notEqual(await page.evaluate(()=>exportInk()),before.ink,'pen draws in stylus-only mode');
        const drawn=await page.evaluate(()=>exportInk());
        await page.locator('#undoDrawingBtn').click();
        await page.locator('#redoDrawingBtn').click();
        assert.equal(await page.evaluate(()=>exportInk()),drawn);
        // A finger tap must still be able to turn the mode off.
        const checkbox=await page.locator('#stylusOnly').boundingBox();
        await touch('touchStart',[[1,checkbox.x+checkbox.width/2,checkbox.y+checkbox.height/2]]);
        await touch('touchEnd',[]);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#stylusOnly').isChecked(),false);
        assert.deepEqual(errors,[]);
        console.log('PASS: pressure width on 3 brushes, flat nib direction, resize, one/two finger gestures, pen-only input, undo/redo, touch toggle');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
