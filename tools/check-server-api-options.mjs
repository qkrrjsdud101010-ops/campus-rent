import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/main/resources/static/js/store-server.js',import.meta.url),'utf8');
const calls=[],broadcast=[];
const reply=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>data});
const context=vm.createContext({
  resources:[],checkAvailability:()=>[],replaceCatalog(){},markCatalogUnavailable(){},catalogRestrictions:{},
  structuredClone,crypto:{randomUUID:()=> 'selection-id'},sessionStorage:{getItem:()=>null,setItem(){}},
  BroadcastChannel:class{addEventListener(){}postMessage(value){broadcast.push(value);}},
  fetch:async(path,options={})=>{
    calls.push({path,options});
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(path==='/api/auth/csrf')return reply({headerName:'X-CSRF-TOKEN',token:'synthetic-token'});
    if(path==='/api/auth/me')return reply({user:null});
    if(path==='/api/catalog')return reply({resources:[],purposes:[],reservations:[]});
    return reply({source:'rules',reason:'disabled',analysis:null});
  },
});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.testApi={ready,requestApi};',context);
await context.testApi.ready;
calls.length=0;
const controller=new AbortController();
await context.testApi.requestApi('/api/recommendations/analyze',{method:'POST',body:{activity:'면접 4명'},signal:controller.signal,notifyChanges:false});
assert.equal(calls.length,2);
assert.equal(calls[0].path,'/api/auth/csrf');assert.equal(calls[0].options.signal,controller.signal);
assert.equal(calls[1].options.signal,controller.signal);
assert.equal(calls[1].options.headers['X-CSRF-TOKEN'],'synthetic-token');
assert.equal(calls[1].options.body,JSON.stringify({activity:'면접 4명'}));
assert.equal(broadcast.length,0);
console.log('PASS guest analysis preserves CSRF and cancellation signal across token and analysis requests');
console.log('PASS read-only analysis POST does not broadcast a resource mutation to other tabs');
await context.testApi.requestApi('/api/admin/facilities/1',{method:'PUT',body:{name:'synthetic'}});
assert.equal(broadcast.length,1);
console.log('PASS real management mutations still notify other tabs by default');
controller.abort();
await assert.rejects(context.testApi.requestApi('/api/recommendations/analyze',{method:'POST',body:{activity:'스터디'},signal:controller.signal,notifyChanges:false}),error=>error.name==='AbortError');
assert.equal(broadcast.length,1);
console.log('PASS cancelled analysis cannot broadcast a completed mutation');
console.log('4 server API option checks passed; network and browser are mocked.');
