import * as store from '/js/store.js';
import {navigate} from '/js/ui.js';
const results = [];
const errors = [];
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, name) { for(let i=0;i<200;i++){ if(check()) return; await wait(20); } throw new Error('Timed out: '+name); }
function assert(value,name){if(!value)throw new Error(name);results.push('PASS '+name);}
function fill(selector,value){const input=document.querySelector(selector);if(!input)throw new Error('Missing '+selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));return input;}
function click(selector){const element=document.querySelector(selector);if(!element)throw new Error('Missing '+selector);element.click();}
async function checkpoint(name){document.documentElement.dataset.checkpoint=name;await until(()=>document.documentElement.dataset.checkpoint==='done','capture '+name);}
async function login(email,password){click('[data-login]');fill('#auth-email',email);fill('#auth-password',password);document.querySelector('[data-auth-form]').requestSubmit();await until(()=>store.getState().user&&!document.querySelector('dialog[open]'),'login');}
try {
  await store.ready;
  navigate('/');
  await until(()=>document.querySelector('#hero-title'),'home');
  await document.fonts.ready;
  assert(document.querySelector('#hero-title').textContent.includes('공간과 장비'),'home renders');
  assert([...document.images].every(img=>img.complete&&img.naturalWidth>0),'home assets loaded');
  assert(document.documentElement.scrollWidth<=innerWidth,'home has no horizontal overflow');
  click('[data-keyword="팀 회의"]');
  assert(document.querySelector('#activity').value==='팀 회의','keyword populates input');
  navigate('/equipment');
  assert(document.querySelectorAll('[data-resource]').length===7,'equipment shows seven original resources');
  document.querySelector('[data-search-form]').requestSubmit();
  const selectable=document.querySelector('[data-select]:not(:disabled)');
  assert(!!selectable,'conditions enable available equipment');
  const resourceId=selectable.dataset.select;
  selectable.click();
  await until(()=>store.getState().selection.length===1,'selection');
  click('[data-request]');
  await until(()=>document.querySelector('#auth-email'),'request login');
  await checkpoint('auth-dialog');
  assert(store.getState().selection.length===1,'selection survives login prompt');
  fill('#auth-email','demo@campusrent.example');fill('#auth-password','Campus123!');
  document.querySelector('[data-auth-form]').requestSubmit();
  await until(()=>store.getState().user&&!document.querySelector('dialog[open]'),'student authentication');
  assert(store.getState().records.length===0,'login does not submit application');
  click('[data-request]');
  assert(!!document.querySelector('[data-final-submit]'),'final submission confirmation opens');
  click('[data-final-submit]');
  await until(()=>store.getState().records.length===1&&location.pathname==='/records','application submit');
  assert(document.querySelector('.record-item').textContent.includes('승인 대기'),'student sees pending status');
  const record=store.getState().records[0], item=record.items[0];
  assert(item.resourceId===resourceId,'submitted item matches selection');
  assert(!store.getState().selection.length,'selection clears after successful submit');
  await store.logout();
  navigate('/admin');
  assert(document.getElementById('page').textContent.includes('관리자 로그인이 필요'),'admin view denied before authentication');
  await login('admin@campusrent.example','CampusAdmin123!');
  assert(!!document.querySelector('[data-admin-action="approve"]'),'admin sees approval action');
  await checkpoint('admin-pending');
  click('[data-admin-action="approve"]');
  const approvalForm=document.querySelector('dialog form');
  assert(!!approvalForm,'approval confirmation opens');
  await checkpoint('admin-approval-dialog');
  approvalForm.requestSubmit();
  await until(()=>store.getState().records[0].items[0].status==='승인·수령 대기','approval');
  assert(!document.querySelector('[data-admin-action="approve"]'),'approved item no longer exposes approval');
  await store.logout();
  await login('demo@campusrent.example','Campus123!');
  navigate('/records');
  assert(document.querySelector('.record-item').textContent.includes('승인·수령 대기'),'student sees latest approval');
  assert(!document.querySelector('[data-record-action="cancel"]'),'approved item cannot be cancelled by student');
  navigate('/facilities');
  assert(document.querySelectorAll('[data-resource]').length===5,'facilities shows five original spaces');
  fill('[name="search-condition-people"]','6');
  fill('[name="search-condition-use"]','팀 회의');
  document.querySelector('[data-search-form]').requestSubmit();
  assert(document.querySelector('[data-resource="room01"] [data-select]').disabled && document.querySelector('[data-resource="room01"]').textContent.includes('이용 인원 6명'),'facility availability validates capacity');
  navigate('/equipment?q=존재하지않는장비');
  assert(document.getElementById('page').textContent.includes('검색 결과가 없습니다'),'empty search state renders');
  navigate('/purpose?activity='+encodeURIComponent('학생회 회의 6명'));
  assert(document.querySelector('[name="purpose-facility-people"]').value==='6','purpose applies recognized participants');
  document.querySelector('[data-purpose-form]').requestSubmit();
  assert(document.querySelector('[data-purpose-results]').textContent.includes('팀 회의 추천 구성'),'purpose renders recommendation');
  assert(![...document.querySelectorAll('[data-purpose-results] [data-resource]')].some(card=>card.textContent.includes('수용 4명')),'six-person recommendation excludes four-person rooms');
  fill('[name="purpose-facility-people"]','8');
  assert(document.querySelector('[data-purpose-results]').textContent.includes('조건이 변경'),'changed recommendation needs refresh');
  document.querySelector('[data-purpose-form]').requestSubmit();
  assert(document.querySelector('[name="purpose-facility-people"]').value==='8','manual participant override is retained');
  await checkpoint('recommendation-results');
  assert(document.documentElement.scrollWidth<=innerWidth,'rental view has no horizontal overflow');
  assert(!errors.length,'no runtime errors: '+errors.join('; '));
} catch(error){results.push('FAIL '+error.stack);}
const output=document.createElement('pre');output.id='browser-check-results';output.textContent=results.join('\n');document.body.append(output);
document.documentElement.dataset.checksDone='true';
