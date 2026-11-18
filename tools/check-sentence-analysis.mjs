import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({console,setTimeout,clearTimeout,AbortController,DOMException,
  e:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  store:{subscribe(){},getState:()=>({user:null}),requestApi:async()=>{throw Error('No real network');}},window:{addEventListener(){}}});
const data=await readFile(new URL('../src/main/resources/static/js/data.js',import.meta.url),'utf8');
vm.runInContext(data.replace(/^export /gm,''),context);
const source=await readFile(new URL('../src/main/resources/static/js/sentence-analysis.js',import.meta.url),'utf8');
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.sentenceTest={createSentenceAnalysisController,createSentenceAnalysisState,sentenceAnalysisHtml,normalizeSentenceResponse};',context);
const api=context.sentenceTest;
const baseline=()=>({activity:'면접 4명',people:3,peopleEdited:true,needs:{space:true,video:false,audio:false,presentation:false},needsEdited:true,revision:'draft1'});
const good=()=>({source:'ai',reason:'',analysis:{activity:'면접 연습',people:4,peopleStatus:'explicit',needs:{space:true,video:true,audio:false,presentation:false},needsClarification:false}});
let passed=0;const check=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
await check('disabled provider uses honest rules without sending any request',async()=>{
 let calls=0;const c=api.createSentenceAnalysisController({getSnapshot:baseline,getCapabilities:()=>({available:false}),request:async()=>{calls++;}});
 await c.analyze();assert.equal(calls,0);assert.equal(c.state.proposal.source,'rules');assert.equal(c.state.proposal.analysis.people,4);
});
await check('AI proposal never applies before explicit field confirmation',async()=>{
 const applied=[];let requestOptions;
 const c=api.createSentenceAnalysisController({getSnapshot:baseline,getCapabilities:()=>({available:true}),request:async(path,options)=>{requestOptions=options;return good();},onApply:v=>applied.push(v)});
 await c.analyze();assert.equal(applied.length,0);assert.deepEqual(Object.keys(requestOptions.body),['activity']);assert.equal(requestOptions.notifyChanges,false);assert(requestOptions.signal);
 assert(c.apply({video:true}));assert.equal(applied.length,1);assert.equal(applied[0].needs.video,true);assert(!Object.hasOwn(applied[0],'people'));assert(!Object.hasOwn(applied[0],'facilityUse'));
});
await check('manual fields remain unchecked in comparison by default',()=>{
 const state=api.createSentenceAnalysisState();state.proposal={...good(),baseline:baseline()};
 const html=api.sentenceAnalysisHtml(state,{available:true,externalProcessing:true});
 assert.match(html,/data-sentence-choose="people"\s+>/);assert.match(html,/data-sentence-choose="video"\s+>/);assert.match(html,/직접 입력한 인원을 유지/);
});
await check('busy button deduplicates requests and owner changes discard late response',async()=>{
 let resolve,calls=0,owner='student:1';const wait=new Promise(r=>resolve=r);
 const c=api.createSentenceAnalysisController({getSnapshot:baseline,getOwner:()=>owner,getCapabilities:()=>({available:true}),request:()=>{calls++;return wait;}});
 const first=c.analyze();await c.analyze();assert.equal(calls,1);owner='guest';resolve(good());await first;assert.equal(c.state.proposal,null);assert.equal(c.state.busy,false);
});
await check('changed draft and cancellation prevent applying stale analysis',async()=>{
 let resolve;const state=baseline();const wait=new Promise(r=>resolve=r);
 const c=api.createSentenceAnalysisController({getSnapshot:()=>state,getCapabilities:()=>({available:true}),request:()=>wait});
 const pending=c.analyze();state.revision='draft2';resolve(good());await pending;assert.equal(c.state.proposal,null);assert.equal(c.apply({people:true}),false);
});
await check('request timeout yields rules fallback and releases loading state',async()=>{
 const c=api.createSentenceAnalysisController({getSnapshot:baseline,getCapabilities:()=>({available:true}),request:()=>new Promise(()=>{}),timeoutMs:10});
 await c.analyze();assert.equal(c.state.proposal.source,'rules');assert.equal(c.state.proposal.reason,'timeout');assert.equal(c.state.busy,false);
});
await check('invalid model data falls back and ambiguous people are never guessed',()=>{
 const invalid=good();invalid.analysis.people=1000;assert.equal(api.normalizeSentenceResponse(invalid,'면접 4명').source,'rules');
 const result=api.normalizeSentenceResponse(null,'면접 4~6명');assert.equal(result.analysis.people,null);assert.equal(result.analysis.peopleStatus,'ambiguous');
});
await check('untrusted text is escaped and external notice follows actual capability',()=>{
 const state=api.createSentenceAnalysisState();const response=good();response.analysis.activity='<script>bad</script>';state.proposal={...response,baseline:baseline()};
 let html=api.sentenceAnalysisHtml(state,{available:true,externalProcessing:true});assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('외부 AI'));
 html=api.sentenceAnalysisHtml(state,{available:false,externalProcessing:false});assert(!html.includes('문장을 외부 AI로 분석합니다'));
});
console.log(`${passed} sentence analysis checks passed; provider and browser are mocked.`);
