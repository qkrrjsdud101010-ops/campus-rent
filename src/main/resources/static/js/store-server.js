import {resources,availability as checkAvailability,replaceCatalog,markCatalogUnavailable,catalogRestrictions} from './data.js';
const listeners=new Set(),key='campusrent.server.selection.v1';
const state={user:null,selection:[],records:[],equipmentStates:{},storageError:''};
const clone=value=>structuredClone(value);
let csrf=null,submitting=false;
try{const saved=JSON.parse(sessionStorage.getItem(key)||'[]');if(Array.isArray(saved))state.selection=saved.filter(item=>item&&typeof item.id==='string'&&typeof item.resourceId==='string');}catch{}
export const getState=()=>clone(state);
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
function emit(){for(const listener of listeners)listener(getState());}
function save(){try{sessionStorage.setItem(key,JSON.stringify(state.selection));}catch{state.storageError='선택 내용을 임시 보관하지 못했습니다.';}emit();}
async function api(path,{method='GET',body}={}){
  if(method!=='GET'&&!csrf){const response=await fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('보안 토큰을 준비하지 못했습니다.');csrf=await response.json();}
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{[csrf.headerName]:csrf.token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const result=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok){if(response.status===401){state.user=null;state.records=[];state.equipmentStates={};csrf=null;emit();}if(response.status===403)csrf=null;throw new Error(result?.message||'요청을 처리하지 못했습니다. 다시 확인해주세요.');}
  return result;
}
async function catalog(){try{replaceCatalog(await api('/api/catalog'));state.storageError='';}catch(error){markCatalogUnavailable(error.message);state.storageError=error.message;throw error;}}
export const ready=(async()=>{await catalog();state.user=(await api('/api/auth/me')).user;state.selection=state.selection.filter(item=>resources.some(r=>r.id===item.resourceId));if(state.user){const result=await api('/api/requests');state.records=result.records;state.equipmentStates=result.equipmentStates;}return getState();})();
export async function refreshRecords(){await catalog();state.user=(await api('/api/auth/me')).user;if(state.user){const result=await api('/api/requests');state.records=result.records;state.equipmentStates=result.equipmentStates||{};}else{state.records=[];state.equipmentStates={};}emit();return getState();}
export async function login(email,password){const result=await api('/api/auth/login',{method:'POST',body:{email,password}});state.user=result.user;csrf=null;await refreshRecords();return clone(state.user);}
export async function signup(profile){const result=await api('/api/auth/signup',{method:'POST',body:profile});state.user=result.user;csrf=null;await refreshRecords();return clone(state.user);}
export async function logout(){await api('/api/auth/logout',{method:'POST'});state.user=null;state.records=[];state.equipmentStates={};csrf=null;emit();}
export function getReservations(){return [];}
export function getRestrictions(){return {...catalogRestrictions};}
export function availability(resource,condition){return checkAvailability(resource,condition,[],getRestrictions());}
function resource(id){const result=resources.find(r=>r.id===id);if(!result)throw new Error('자원을 찾을 수 없습니다.');return result;}
export function toggleSelection(id,condition=null){const index=state.selection.findIndex(item=>item.resourceId===id);if(index>=0){state.selection.splice(index,1);save();return;}const r=resource(id);if(!r.rentable||r.status!=='정상')throw new Error('현재 이용할 수 없는 자원입니다.');if(condition){const errors=availability(r,condition);if(errors.length)throw new Error(errors.join(' '));}state.selection.push({id:crypto.randomUUID(),resourceId:id,condition:condition?clone(condition):null});save();}
export function updateSelection(id,condition){const item=state.selection.find(i=>i.id===id);if(!item)throw new Error('선택 항목을 찾을 수 없습니다.');const errors=availability(resource(item.resourceId),condition);if(errors.length)throw new Error(errors.join(' '));item.condition=clone(condition);save();}
export function removeSelection(id){state.selection=state.selection.filter(item=>item.id!==id);save();}
export function clearSelection(){state.selection=[];save();}
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('campusrent.server.changed.v1'):null;
channel?.addEventListener('message',()=>refreshRecords().catch(()=>{}));
async function changed(){await refreshRecords();channel?.postMessage({changed:true});}
export async function submitSelection(){if(submitting)throw new Error('신청을 저장하고 있습니다.');if(state.user?.role!=='student')throw new Error('학생 계정으로 로그인해주세요.');if(!state.selection.length)throw new Error('신청할 자원을 선택해주세요.');submitting=true;const selected=clone(state.selection);try{const result=await api('/api/requests',{method:'POST',body:{items:selected.map(({resourceId,condition})=>({resourceId,condition}))}});const submitted=new Set(selected.map(item=>item.id));state.selection=state.selection.filter(item=>!submitted.has(item.id));save();await changed();return result.record;}finally{submitting=false;}}
export async function cancelItem(number,id,expectedVersion){const result=await api(`/api/requests/${encodeURIComponent(number)}/items/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{expectedVersion}});await changed();return result.item;}
export async function requestReturn(number,id,expectedVersion){const result=await api(`/api/requests/${encodeURIComponent(number)}/items/${encodeURIComponent(id)}/return-request`,{method:'POST',body:{expectedVersion}});await changed();return result.item;}
export async function processItem(number,id,action,details={}){const result=await api(`/api/admin/requests/${encodeURIComponent(number)}/items/${encodeURIComponent(id)}/actions`,{method:'POST',body:{action,details}});await changed();return result.item;}
