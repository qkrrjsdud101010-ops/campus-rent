import {serverMode} from './data.js';
const adapter = await import(serverMode ? './store-server.js' : './store-demo.js');
export const {ready,getState,subscribe,refreshRecords,login,signup,logout,availability,getReservations,getRestrictions,toggleSelection,updateSelection,removeSelection,clearSelection,submitSelection,cancelItem,requestReturn,processItem}=adapter;
