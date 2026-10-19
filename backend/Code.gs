/** Чик! — private reservation storage. No bot tokens or participant data in Git. */
const SETTINGS = Object.freeze({
  dates:['2026-10-20','2026-10-21','2026-10-22'],
  start:'15:00',end:'19:00',duration:30,buffer:15,
  timezone:'Europe/Moscow',offset:'+03:00',noticeMinutes:30,
  origins:['https://b0ver.github.io'],
  consentVersion:'2026-10-19-v1'
});
const COLUMNS=['ID','Slot','Name','Contact','Role','Format','Created','Status','TokenHash','RequestID','Updated','CalendarEventID','CalendarSyncState','ConsentVersion'];

/** Run once as the owner. The spreadsheet remains private. */
function setup(){
  const properties=PropertiesService.getScriptProperties();
  if(!properties.getProperty('BOOKING_SHEET_ID')){
    const ss=SpreadsheetApp.create('Чик! — встречи фокус-группы');
    ss.setSpreadsheetTimeZone(SETTINGS.timezone);
    const sheet=ss.getSheets()[0];sheet.setName('Bookings');
    sheet.appendRow(COLUMNS);sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,COLUMNS.length).setFontWeight('bold').setBackground('#244d40').setFontColor('#ffffff');
    sheet.getRange('A:N').setNumberFormat('@');
    properties.setProperty('BOOKING_SHEET_ID',ss.getId());
  }
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='cleanupExpiredData')){
    ScriptApp.newTrigger('cleanupExpiredData').timeBased().everyDays(1).atHour(7).inTimezone(SETTINGS.timezone).create();
  }
  properties.setProperty('BOOKINGS_ENABLED','true');
  console.log('Хранилище готово. Таблица доступна только владельцу: https://docs.google.com/spreadsheets/d/'+properties.getProperty('BOOKING_SHEET_ID'));
}

/** Public, read-only health check. Contains no participants or spreadsheet identifiers. */
function doGet(){
  return ContentService.createTextOutput(JSON.stringify({service:'chik-focus',version:1,ready:ready_(),serverTime:new Date().toISOString()})).setMimeType(ContentService.MimeType.JSON);
}

/** RPC uses a POST form + postMessage to avoid third-party CORS/preflight dependencies. */
function doPost(e){
  let request;
  try{
    if(!e||!e.postData||e.postData.length>8192)throw new Error('invalid_request');
    request=JSON.parse(e.parameter.payload||'{}');
    if(!/^[a-f0-9]{64}$/.test(request.nonce)||SETTINGS.origins.indexOf(request.origin)<0)throw new Error('invalid_request');
  }catch(error){return HtmlService.createHtmlOutput('Invalid request.');}
  let result;
  try{
    if(!ready_())throw new Error('closed');
    result=dispatch_(request);
  }catch(error){
    const allowed=['invalid_request','invalid_name','invalid_contact','invalid_consent','invalid_format','unavailable','already_booked','rate_limited','closed','not_found','expired','busy'];
    result={ok:false,code:allowed.indexOf(error.message)>=0?error.message:'server_error'};
    // Do not log request payloads, names, contact details, management tokens or full exception messages.
  }
  const envelope=JSON.stringify({channel:'chik-focus-v1',nonce:request.nonce,result:result}).replace(/</g,'\\u003c');
  const target=JSON.stringify(request.origin);
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>window.top.postMessage('+envelope+','+target+');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function ready_(){const p=PropertiesService.getScriptProperties();return Boolean(p.getProperty('BOOKING_SHEET_ID'))&&p.getProperty('BOOKINGS_ENABLED')==='true';}
function dispatch_(request){
  if(request.action==='availability')return {ok:true,slots:availability_(),serverTime:new Date().toISOString()};
  if(request.action==='book')return locked_(function(){return book_(request);});
  if(request.action==='lookup')return {ok:true,booking:publicBooking_(lookup_(request.manageToken))};
  if(request.action==='cancel')return locked_(function(){return cancel_(request.manageToken);});
  throw new Error('invalid_request');
}
function locked_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('busy');try{return fn();}finally{lock.releaseLock();}}
function sheet_(){return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID')).getSheetByName('Bookings');}
function rows_(){const values=sheet_().getDataRange().getDisplayValues();if(JSON.stringify(values[0])!==JSON.stringify(COLUMNS))throw new Error('storage_error');return values.slice(1).map(function(row,index){const obj={row:index+2};COLUMNS.forEach(function(key,i){obj[key]=String(row[i]||'').replace(/^'/,'');});return obj;});}
function slotList_(){
  const toMinutes=function(t){const parts=t.split(':').map(Number);return parts[0]*60+parts[1];};
  const pad=function(n){return String(n).padStart(2,'0');};
  const list=[];
  SETTINGS.dates.forEach(function(day){for(let t=toMinutes(SETTINGS.start);t+SETTINGS.duration<=toMinutes(SETTINGS.end);t+=SETTINGS.duration+SETTINGS.buffer){const time=pad(Math.floor(t/60))+':'+pad(t%60);const start=new Date(day+'T'+time+':00'+SETTINGS.offset);list.push({id:day+'_'+time.replace(':',''),start:start.toISOString(),end:new Date(start.getTime()+SETTINGS.duration*60000).toISOString()});}});
  return list;
}
function availability_(){const rows=rows_();const occupied={};rows.forEach(function(b){if(b.Status==='confirmed')occupied[b.Slot]=true;});const cutoff=Date.now()+SETTINGS.noticeMinutes*60000;return slotList_().map(function(s){return {id:s.id,start:s.start,end:s.end,available:!occupied[s.id]&&Date.parse(s.start)>cutoff};});}
function hash_(token){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token,Utilities.Charset.UTF_8).map(function(b){return (b+256).toString(16).slice(-2);}).join('');}
function validToken_(token){return typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);}
function normalizedContact_(contact){return String(contact||'').trim().toLowerCase();}
function validate_(r){
  if(!validToken_(r.manageToken)||typeof r.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(r.requestId)||r.website)throw new Error('invalid_request');
  if(typeof r.name!=='string'||r.name.trim().length<2||r.name.length>80||/[\x00-\x1f]/.test(r.name))throw new Error('invalid_name');
  if(typeof r.contact!=='string'||r.contact.length>120||!/^(?:@[A-Za-z][A-Za-z0-9_]{4,31}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(r.contact.trim()))throw new Error('invalid_contact');
  if(['meet','telemost'].indexOf(r.format)<0)throw new Error('invalid_format');
  if(r.consent!==true||r.consentVersion!==SETTINGS.consentVersion)throw new Error('invalid_consent');
  if(['master','client','other'].indexOf(r.role)<0)throw new Error('invalid_request');
}
function safeCell_(value){return "'"+String(value??'');}
function book_(r){
  validate_(r);
  const rows=rows_(),tokenHash=hash_(r.manageToken);
  const previous=rows.find(function(b){return b.RequestID===r.requestId;});
  if(previous){if(previous.TokenHash!==tokenHash)throw new Error('invalid_request');return {ok:true,booking:publicBooking_(previous)};}
  // A token identifies one booking, including after cancellation. Never silently reuse it for another slot.
  if(rows.some(function(b){return b.TokenHash===tokenHash;}))throw new Error('invalid_request');
  const slot=slotList_().find(function(s){return s.id===r.slotId;});
  if(!slot||Date.parse(slot.start)<=Date.now()+SETTINGS.noticeMinutes*60000||rows.some(function(b){return b.Status==='confirmed'&&b.Slot===r.slotId;}))throw new Error('unavailable');
  const contact=normalizedContact_(r.contact);
  if(rows.some(function(b){return b.Status==='confirmed'&&normalizedContact_(b.Contact)===contact;}))throw new Error('already_booked');
  if(rows.filter(function(b){return normalizedContact_(b.Contact)===contact&&Date.parse(b.Created)>Date.now()-86400000;}).length>=5)throw new Error('rate_limited');
  const instant=new Date().toISOString();
  const booking={ID:Utilities.getUuid(),Slot:slot.id,Name:r.name.trim(),Contact:r.contact.trim(),Role:r.role,Format:r.format,Created:instant,Status:'confirmed',TokenHash:tokenHash,RequestID:r.requestId,Updated:instant,CalendarEventID:'',CalendarSyncState:'not_connected',ConsentVersion:r.consentVersion};
  // The optional research note is intentionally not stored: avoid collecting unnecessary free-form personal information.
  sheet_().appendRow(COLUMNS.map(function(key){return safeCell_(booking[key]);}));
  SpreadsheetApp.flush();
  return {ok:true,booking:publicBooking_(booking)};
}
function lookup_(token){if(!validToken_(token))throw new Error('not_found');const hashed=hash_(token);const booking=rows_().find(function(b){return b.TokenHash===hashed;});if(!booking)throw new Error('not_found');return booking;}
function publicBooking_(b){const slot=slotList_().find(function(s){return s.id===b.Slot;});if(!slot)throw new Error('not_found');return {id:b.ID,slotId:b.Slot,start:slot.start,end:slot.end,format:b.Format,status:b.Status};}
function cancel_(token){const booking=lookup_(token);if(booking.Status==='cancelled')return {ok:true,booking:publicBooking_(booking)};const slot=slotList_().find(function(s){return s.id===booking.Slot;});if(!slot||Date.parse(slot.start)<=Date.now())throw new Error('expired');const sheet=sheet_();sheet.getRange(booking.row,COLUMNS.indexOf('Status')+1).setValue(safeCell_('cancelled'));sheet.getRange(booking.row,COLUMNS.indexOf('Updated')+1).setValue(safeCell_(new Date().toISOString()));SpreadsheetApp.flush();booking.Status='cancelled';return {ok:true,booking:publicBooking_(booking)};}

/** Data retention: clear participants after 30 days; configured as a daily owner-only trigger. */
function cleanupExpiredData(){return locked_(function(){const rows=rows_();const cutoff=Date.now()-30*86400000;const sheet=sheet_();for(let i=rows.length-1;i>=0;i--){const slot=slotList_().find(function(s){return s.id===rows[i].Slot;});if(slot&&Date.parse(slot.end)<cutoff)sheet.deleteRow(rows[i].row);}SpreadsheetApp.flush();});}

/** Owner can stop bookings instantly without publishing new code. */
function closeBookings(){PropertiesService.getScriptProperties().setProperty('BOOKINGS_ENABLED','false');}
