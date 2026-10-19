import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';

const code=fs.readFileSync(new URL('../backend/Code.gs',import.meta.url),'utf8');
function service(){
  let table,locked=false;
  const properties=new Map([['BOOKING_SHEET_ID','test-private-sheet'],['BOOKINGS_ENABLED','true']]);
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-19T13:00:00Z']));}static now(){return Date.parse('2026-10-19T13:00:00Z');}}
  const sheet={getDataRange:()=>({getDisplayValues:()=>table.map(row=>row.map(v=>String(v).replace(/^'/,'')))}),appendRow:row=>table.push(row),getRange:(row,col)=>({setValue:value=>{table[row-1][col-1]=value;}}),deleteRow:row=>table.splice(row-1,1)};
  const context=vm.createContext({Date:Clock,console,PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},Utilities:{getUuid:()=>crypto.randomUUID(),computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(value).digest()),DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'}}});
  vm.runInContext(code,context);
  table=[JSON.parse(vm.runInContext('JSON.stringify(COLUMNS)',context))];
  const call=(action,data={})=>JSON.parse(JSON.stringify(context.dispatch_({action,...data})));
  const payload=(slotId='2026-10-20_1500',contact='@testclient')=>({slotId,contact,name:'Тестовый участник',role:'master',format:'meet',consent:true,consentVersion:'2026-10-19-v1',requestId:crypto.randomUUID(),manageToken:crypto.randomBytes(32).toString('hex'),website:''});
  return {call,payload,table,context,setLock:value=>{locked=value;}};
}
test('15 slots, correct Moscow times and 15-minute gaps',()=>{
  const s=service();const result=s.call('availability');assert.equal(result.slots.length,15);
  assert.equal(result.slots[0].start,'2026-10-20T12:00:00.000Z');
  assert.equal(result.slots[4].end,'2026-10-20T15:30:00.000Z');
  for(let i=1;i<5;i++)assert.equal(Date.parse(result.slots[i].start)-Date.parse(result.slots[i-1].end),15*60000);
  assert.ok(result.slots.every(s=>s.available));
});
test('server reserves once, idempotently retries and rejects another person for same slot',()=>{
  const s=service(),p=s.payload();const first=s.call('book',p);assert.equal(first.booking.status,'confirmed');
  assert.deepEqual(s.call('book',p),first);assert.equal(s.table.length,2);
  assert.throws(()=>s.call('book',s.payload(p.slotId,'@otherclient')),/unavailable/);
  assert.equal(s.call('availability').slots[0].available,false);
  assert.equal(s.call('lookup',{manageToken:p.manageToken}).booking.id,first.booking.id);
});
test('script-wide lock rejects concurrent mutation instead of double reserving',()=>{
  const s=service();s.setLock(true);assert.throws(()=>s.call('book',s.payload()),/busy/);assert.equal(s.table.length,1);
  s.setLock(false);assert.equal(s.call('book',s.payload()).ok,true);
});
test('one active booking per contact; cancel releases slot and is idempotent',()=>{
  const s=service(),p=s.payload();s.call('book',p);
  assert.throws(()=>s.call('book',s.payload('2026-10-20_1545','@TESTCLIENT')),/already_booked/);
  assert.throws(()=>s.call('cancel',{manageToken:'0'.repeat(64)}),/not_found/);
  const cancellation=s.call('cancel',{manageToken:p.manageToken});assert.equal(cancellation.booking.status,'cancelled');
  assert.deepEqual(s.call('cancel',{manageToken:p.manageToken}),cancellation);
  assert.equal(s.call('availability').slots[0].available,true);
  assert.equal(s.call('book',s.payload('2026-10-20_1545')).ok,true);
});
test('private contacts and bearer tokens are absent from public availability and raw storage token is hashed',()=>{
  const s=service(),p=s.payload();p.name='=IMPORTXML("https://example.com","//x")';s.call('book',p);
  const publicData=JSON.stringify(s.call('availability'));
  assert.ok(!publicData.includes(p.contact));assert.ok(!publicData.includes(p.manageToken));assert.ok(!JSON.stringify(s.table).includes(p.manageToken));
  assert.ok(s.table[1][2].startsWith("'="),'spreadsheet formula injection must be escaped');
  assert.throws(()=>s.call('lookup',{manageToken:'0'.repeat(64)}),/not_found/);
});
test('server rejects forged slots, missing consent and invalid contact independently of frontend',()=>{
  const s=service();assert.throws(()=>s.call('book',{...s.payload(),slotId:'2026-10-20_1830'}),/unavailable/);
  assert.throws(()=>s.call('book',{...s.payload(),consent:false}),/invalid_consent/);
  assert.throws(()=>s.call('book',{...s.payload(),contact:'not a contact'}),/invalid_contact/);
  assert.equal(s.table.length,1);
});
