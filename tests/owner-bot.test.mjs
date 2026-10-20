import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source=['Code.gs','OwnerBot.gs'].map(n=>fs.readFileSync(new URL('../backend/'+n,import.meta.url),'utf8')).join('\n');
function service(){
  let now='2026-10-20T11:00:00Z',locked=false;
  const properties=new Map([['BOOKING_SHEET_ID','private'],['BOOKINGS_ENABLED','true'],['OWNER_BOT_CONFIG',JSON.stringify({token:'123456:abcdefghijklmnopqrstuvwxyz',ownerId:123,offset:0})]]);
  const sheets={},triggers=[],sent=[],calls=[];let updates=[],failure=null;
  function sheet(name){
    const table=[];
    return sheets[name]={table,getDataRange:()=>({getDisplayValues:()=>table.map(r=>r.map(v=>String(v).replace(/^'/,'')))}),appendRow:r=>table.push(r),getLastRow:()=>table.length,setFrozenRows:()=>{},getRange:(row,col)=>({setNumberFormat:()=>{},setValues:values=>values.forEach((r,i)=>r.forEach((v,j)=>table[row-1+i][col-1+j]=v)),setValue:v=>table[row-1][col-1]=v})};
  }
  const bookings=sheet('Bookings');
  class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({Date:Clock,console:{log:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},
    SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n],insertSheet:n=>sheet(n)}),flush:()=>{}},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
    ScriptApp:{AuthMode:{FULL:'FULL'},requireAllScopes:()=>{},getProjectTriggers:()=>triggers.map(n=>({getHandlerFunction:()=>n})),newTrigger:n=>({timeBased:()=>({everyMinutes:()=>({create:()=>triggers.push(n)})})})},
    Utilities:{getUuid:()=>crypto.randomUUID(),computeDigest:(_,v)=>Array.from(crypto.createHash('sha256').update(v).digest()),DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},formatDate:(d,zone,format)=>{
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
      return {'yyyy-MM-dd':`${parts.year}-${parts.month}-${parts.day}`,'dd.MM':`${parts.day}.${parts.month}`,'dd.MM HH:mm':`${parts.day}.${parts.month} ${parts.hour}:${parts.minute}`,'HH:mm':`${parts.hour}:${parts.minute}`}[format];
    }},
    UrlFetchApp:{fetch:(url,options)=>{
      const method=url.split('/').at(-1),payload=JSON.parse(options.payload);calls.push({method,payload});
      let result={ok:true,result:true};
      if(method==='getMe')result.result={username:'checkmytime_bot'};
      if(method==='getChat')result.result={id:123,type:'private',username:'ealpopov'};
      if(method==='getWebhookInfo')result.result={url:''};
      if(method==='getUpdates')result.result=updates.filter(u=>u.update_id>=payload.offset);
      if(method==='sendMessage'){
        if(failure==='timeout')throw new Error('transport failed');
        if(failure)result=failure;
        else{sent.push(payload);result.result={message_id:sent.length};}
      }
      return {getContentText:()=>JSON.stringify(result)};
    }}
  });
  vm.runInContext(source,context);
  bookings.table.push(JSON.parse(vm.runInContext('JSON.stringify(COLUMNS)',context)));
  const call=(name,...args)=>context[name](...args);
  const book=(id='2026-10-20_1500',contact='@testclient')=>{
    const payload={slotId:id,contact,name:'Тестовый участник',role:'master',format:'meet',consent:true,consentVersion:'2026-10-19-v1',requestId:crypto.randomUUID(),manageToken:crypto.randomBytes(32).toString('hex'),website:''};
    return {result:call('book_',payload),token:payload.manageToken};
  };
  return {call,book,properties,sheets,triggers,sent,calls,context,setTime:v=>{now=v;},setFailure:v=>{failure=v;},setUpdates:v=>{updates=v;}};
}
test('installation preserves all bookings, sends existing agenda only to owner and installs one trigger',()=>{
  const s=service();s.book('2026-10-21_1545');const before=JSON.stringify(s.sheets.Bookings.table);
  s.call('installOwnerBot');s.call('installOwnerBot');
  assert.equal(s.triggers.length,1);assert.equal(s.sent.length,1);
  assert.match(s.sent[0].text,/21.10 15:45/);assert.match(s.sent[0].text,/@testclient/);
  assert.ok(s.sent.every(m=>m.chat_id===123));assert.equal(JSON.stringify(s.sheets.Bookings.table),before);
  assert.equal(s.calls.find(c=>c.method==='setMyCommands').payload.scope.chat_id,123);
});
test('numeric private owner ID authorizes commands; impostors and groups get no booking data',()=>{
  const s=service();s.book();s.call('installOwnerBot');const count=s.sent.length;
  s.setUpdates([
    {update_id:1,message:{from:{id:999,username:'ealpopov'},chat:{id:999,type:'private'},text:'/bookings'}},
    {update_id:2,message:{from:{id:123},chat:{id:-99,type:'group'},text:'/bookings'}},
    {update_id:3,callback_query:{id:'forged',from:{id:999},message:{chat:{id:123,type:'private'}},data:'owner_bookings'}},
    {update_id:4,message:{from:{id:123},chat:{id:123,type:'private'},text:'/today'}}
  ]);
  s.call('ownerBotTick');assert.equal(s.sent.length,count+1);assert.match(s.sent.at(-1).text,/Сегодня/);
  assert.equal(s.properties.get('OWNER_UPDATE_OFFSET'),'5');
  s.call('ownerBotTick');assert.equal(s.sent.length,count+1);
});
test('new and cancelled booking notifications are each sent once; cancellation suppresses reminders',()=>{
  const s=service();s.call('installOwnerBot');const booking=s.book();
  s.call('ownerBotTick');s.call('ownerBotTick');assert.equal(s.sent.filter(m=>m.text.startsWith('Новая запись')).length,1);
  s.call('cancel_',booking.token);s.call('ownerBotTick');s.call('ownerBotTick');
  assert.equal(s.sent.filter(m=>m.text.startsWith('Запись отменена')).length,1);
  s.setTime('2026-10-20T11:56:00Z');s.call('ownerBotTick');assert.equal(s.sent.filter(m=>m.text.startsWith('Скоро')).length,0);
});
test('30 and 5 minute reminders catch delayed ticks without duplicate or stale sends',()=>{
  const s=service();s.book();s.call('installOwnerBot');
  s.setTime('2026-10-20T11:32:00Z');s.call('ownerBotTick');s.call('ownerBotTick');
  assert.equal(s.sent.filter(m=>m.text.startsWith('Скоро')).length,1);assert.match(s.sent.at(-1).text,/28 мин/);
  s.setTime('2026-10-20T11:56:00Z');s.call('ownerBotTick');s.call('ownerBotTick');
  assert.equal(s.sent.filter(m=>m.text.startsWith('Скоро')).length,2);
  s.setTime('2026-10-20T12:01:00Z');s.call('ownerBotTick');assert.equal(s.sent.filter(m=>m.text.startsWith('Скоро')).length,2);
  const late=service();late.book();late.call('installOwnerBot');late.setTime('2026-10-20T11:58:00Z');late.call('ownerBotTick');
  assert.equal(late.sent.filter(m=>m.text.startsWith('Скоро')).length,1);
});
test('explicit rate limit retries later, unknown outcome never silently becomes sent or duplicates',()=>{
  const s=service();s.call('installOwnerBot');s.book();
  s.setFailure({ok:false,error_code:429,parameters:{retry_after:120}});s.call('ownerBotTick');
  assert.equal(s.sent.length,1);s.setFailure(null);s.setTime('2026-10-20T11:01:00Z');s.call('ownerBotTick');assert.equal(s.sent.length,1);
  s.setTime('2026-10-20T11:02:00Z');s.call('ownerBotTick');assert.equal(s.sent.length,2);
  const unknown=service();unknown.call('installOwnerBot');unknown.book();unknown.setFailure('timeout');unknown.call('ownerBotTick');
  unknown.setFailure(null);unknown.setTime('2026-10-20T11:10:00Z');unknown.call('ownerBotTick');assert.equal(unknown.sent.length,1);
  assert.ok(unknown.sheets.OwnerNotifications.table.some(r=>r[1]==='uncertain'));
});
test('morning digest uses Moscow date and sends once; pause does not alter bookings',()=>{
  const s=service();s.book();s.call('installOwnerBot');s.setTime('2026-10-20T05:31:00Z');s.call('ownerBotTick');s.call('ownerBotTick');
  assert.equal(s.sent.filter(m=>m.text.startsWith('Сегодня')).length,1);
  const before=JSON.stringify(s.sheets.Bookings.table);s.call('pauseOwnerBot');s.book('2026-10-21_1500','@nextclient');
  const count=s.sent.length;s.call('ownerBotTick');assert.equal(s.sent.length,count);
  assert.notEqual(JSON.stringify(s.sheets.Bookings.table),before);
  assert.ok(!JSON.stringify(s.sheets.OwnerNotifications.table).includes('@testclient'));
});
test('daily digest stops after focus dates instead of sending empty messages forever',()=>{
  const s=service();s.call('installOwnerBot');s.setTime('2026-10-23T05:31:00Z');s.call('ownerBotTick');
  assert.equal(s.sent.length,1);
});
