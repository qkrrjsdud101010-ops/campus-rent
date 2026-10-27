import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, copyFile, access} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = resolve(root, '.work');
const screenshots = resolve(work, 'screenshots');
const fixture = resolve(work, 'ui-checks');
await mkdir(screenshots, {recursive: true});
await mkdir(fixture, {recursive: true});
const template = await readFile(resolve(root, 'src/main/resources/templates/index.html'), 'utf8');
await writeFile(resolve(fixture, 'ui-check.html'), template.replace('</body>', '<script type="module" src="/_checks/ui-check.js"></script></body>'));
await copyFile(resolve(root, 'tools/ui-browser-scenario.js'), resolve(fixture, 'ui-check.js'));
await copyFile(resolve(root, 'tools/store-browser-scenario.js'), resolve(fixture, 'store-check.js'));
await writeFile(resolve(fixture, 'store-check.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><title>CampusRent IndexedDB checks</title><body data-result="running"><pre id="results">Running...</pre><script type="module" src="/_checks/store-check.js"></script></body></html>');
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Set CHROME_PATH to a Chrome executable for browser validation.');
const profile = resolve(work, 'chrome-validation-' + Date.now());
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {windowsHide: true, stdio: ['ignore','ignore','pipe']});
let log = '';
browser.stderr.on('data', chunk => { log += chunk; });
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 150; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    if (browser.exitCode !== null) throw new Error('Chrome exited: ' + log.slice(-3000));
    await delay(100);
  }
  if (!port) throw new Error('Chrome did not start: ' + log.slice(-3000));
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const tab = tabs.find(tab => tab.type === 'page');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', event => { const response = JSON.parse(event.data); const task = pending.get(response.id); if (!task) return; pending.delete(response.id); response.error ? task.reject(new Error(JSON.stringify(response.error))) : task.resolve(response.result); });
  const call = (method,params={}) => new Promise((resolve,reject) => { const next = ++id; pending.set(next,{resolve,reject}); socket.send(JSON.stringify({id:next,method,params})); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  async function waitFor(expression,name) { for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(100);}throw new Error('Timed out: '+name); }
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  for (const [name,path] of [['home-desktop','/'],['equipment-desktop','/equipment'],['facilities-desktop','/facilities'],['purpose-desktop','/purpose?activity='+encodeURIComponent('학생회 회의 6명')]]) {
    await call('Page.navigate',{url:'http://127.0.0.1:8080'+path});
    await waitFor('document.querySelector("#page h1") && !document.querySelector("#page h1").textContent.includes("불러오지")',name);
    await evaluate('document.fonts.ready');
    await waitFor('[...document.images].every(image=>image.complete&&image.naturalWidth>0)',name+' images');
    const geometry=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:[...document.images].map(i=>({src:new URL(i.src).pathname,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,naturalWidth:i.naturalWidth}))})');
    if(geometry.scrollWidth>geometry.width) throw new Error(name+' horizontal overflow');
    await writeFile(resolve(screenshots,name+'.json'),JSON.stringify(geometry,null,2));
    const result=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshots,name+'.png'),Buffer.from(result.data,'base64'));
    console.log('PASS '+name+' render, assets and geometry');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for (const [name,path] of [['home-mobile','/'],['equipment-mobile','/equipment']]) {
    await call('Page.navigate',{url:'http://127.0.0.1:8080'+path});
    await waitFor('document.querySelector("#page h1")',name); await evaluate('document.fonts.ready');
    await waitFor('[...document.images].every(i=>i.complete&&i.naturalWidth>0)',name+' images');
    if(!await evaluate('document.documentElement.scrollWidth<=innerWidth')) throw new Error(name+' horizontal overflow');
    const result=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshots,name+'.png'),Buffer.from(result.data,'base64'));
    console.log('PASS '+name+' render and no horizontal overflow');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8080/_checks/ui-check.html'});
  for (const name of ['auth-dialog','admin-pending','admin-approval-dialog','recommendation-results']) {
    await waitFor(`document.documentElement.dataset.checkpoint===${JSON.stringify(name)} || document.documentElement.dataset.checksDone==='true'`,name);
    if(await evaluate("document.documentElement.dataset.checksDone==='true'"))break;
    await evaluate('document.fonts.ready');
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshots,name+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate("document.documentElement.dataset.checkpoint='done'");
  }
  await waitFor('document.documentElement.dataset.checksDone==="true"','interactive browser checks');
  const result=await evaluate('document.getElementById("browser-check-results").textContent');
  console.log(result);
  await writeFile(resolve(work,'browser-check-results.txt'),result);
  if(result.includes('FAIL '))process.exitCode=1;
  if(!process.exitCode){
    await call('Page.navigate',{url:'http://localhost:8080/_checks/store-check.html'});
    await waitFor("document.body.dataset.result && document.body.dataset.result!=='running'",'IndexedDB checks');
    const report=await evaluate('({state:document.body.dataset.result,output:document.getElementById("results").textContent})');
    console.log(report.output);
    await writeFile(resolve(work,'store-check-results.txt'),report.output);
    if(report.state!=='passed')process.exitCode=1;
  }
  await call('Browser.close');
} finally {
  socket?.close();
  if (browser.exitCode === null) browser.kill();
}
