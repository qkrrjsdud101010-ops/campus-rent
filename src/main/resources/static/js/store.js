import {serverMode} from './data.js';
const adapter = await import(serverMode ? './store-server.js' : './store-demo.js');
export const {ready,getState,subscribe,refreshRecords,login,signup,logout,availability,getReservations,getRestrictions,toggleSelection,updateSelection,removeSelection,clearSelection,submitSelection,cancelItem,requestReturn,processItem}=adapter;
export async function requestApi(path, options = {}) {
  if (!serverMode) throw new Error('이 기능은 실제 개발 서버에서 이용해주세요.');
  return adapter.requestApi(path, options);
}
