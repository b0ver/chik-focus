import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const refreshSource=source.slice(source.indexOf('async function refresh('),source.indexOf('function manageLink('));
function pendingRefresh(){
  let resolve,reject,renders=0;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const state={step:'time',slot:{id:'first'},slots:[],loaded:true,loading:false,submitting:false,error:'',refreshTime:null};
  const context=vm.createContext({state,config:{apiUrl:'https://example.invalid/api'},rpc:()=>pending,render:()=>{renders++;},Date,serverSkew:0});
  vm.runInContext(refreshSource,context);
  return {state,resolve,reject,start:()=>context.refresh(true),renders:()=>renders};
}
test('late availability response never abandons a contact form or pending confirmation',async()=>{
  const p=pendingRefresh();const promise=p.start();p.state.step='contacts';p.state.submitting=true;
  p.resolve({serverTime:new Date().toISOString(),slots:[{id:'first',available:false}]});await promise;
  assert.equal(p.state.step,'contacts');assert.equal(p.state.slot.id,'first');assert.equal(p.state.submitting,true);assert.equal(p.state.error,'');assert.equal(p.renders(),0);
});
test('background timeout cannot replace a pending booking with an availability error',async()=>{
  const p=pendingRefresh();const promise=p.start();p.state.step='contacts';p.state.submitting=true;
  p.reject(new Error('uncertain'));await promise;
  assert.equal(p.state.step,'contacts');assert.equal(p.state.slot.id,'first');assert.equal(p.state.error,'');assert.equal(p.renders(),0);
});
test('availability timeout on time screen never suggests that a booking was created',async()=>{
  const p=pendingRefresh();const promise=p.start();p.reject(new Error('uncertain'));await promise;
  assert.equal(p.state.error,'availability_unreachable');assert.equal(p.state.loaded,false);assert.equal(p.state.slot,null);
});
