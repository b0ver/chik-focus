/** Private, single-owner Telegram desk. Runs as an installable timer, not a public RPC. */
const OWNER_BOT = Object.freeze({
  username:'checkmytime_bot',ownerUsername:'ealpopov',
  ledger:'OwnerNotifications',columns:['Key','State','Updated','MessageID'],
  reminderMinutes:[30,5]
});

/** Run as project owner after setting OWNER_BOT_CONFIG in Script Properties. */
function installOwnerBot(){
  // Granular Google consent must include external requests before any API error is caught.
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  return locked_(function(){
    const cfg=ownerConfig_();
    const me=ownerTelegram_('getMe',{});
    const chat=ownerTelegram_('getChat',{chat_id:cfg.ownerId});
    if(!me.ok||me.result.username!==OWNER_BOT.username||!chat.ok||chat.result.type!=='private'||
      String(chat.result.id)!==String(cfg.ownerId)||String(chat.result.username).toLowerCase()!==OWNER_BOT.ownerUsername)throw new Error('owner_bot_identity_mismatch');
    const webhook=ownerTelegram_('getWebhookInfo',{});
    if(!webhook.ok||webhook.result.url)throw new Error('owner_bot_webhook_conflict');
    const props=PropertiesService.getScriptProperties();
    ownerLedgerSheet_();
    if(!props.getProperty('OWNER_BOOKING_STATE')){
      const baseline={};rows_().forEach(function(b){baseline[b.ID]=b.Status;});
      props.setProperty('OWNER_BOOKING_STATE',JSON.stringify(baseline));
    }
    if(!props.getProperty('OWNER_UPDATE_OFFSET'))props.setProperty('OWNER_UPDATE_OFFSET',String(cfg.offset||0));
    const commands=ownerTelegram_('setMyCommands',{scope:{type:'chat',chat_id:cfg.ownerId},commands:[
      {command:'today',description:'Сегодня: записи и контакты'},
      {command:'bookings',description:'Все ближайшие записи'},
      {command:'status',description:'Работа уведомлений'},
      {command:'help',description:'Что умеет Чик для организатора'}
    ]});
    if(!commands.ok)throw new Error('owner_bot_commands_failed');
    if(!ownerNotifyOnce_('owner-setup-v1','Чик! Я на связи)\n\nБуду сообщать о новых записях и отменах, напоминать за 30 и 5 минут, а утром присылать план дня. Время — Москва.\n\n'+ownerAgenda_('bookings'),ownerLedger_()))throw new Error('owner_bot_welcome_failed');
    if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='ownerBotTick';})){
      ScriptApp.newTrigger('ownerBotTick').timeBased().everyMinutes(1).create();
    }
    props.setProperty('OWNER_BOT_ENABLED','true');
    props.setProperty('OWNER_BOT_INSTALLED_AT',new Date().toISOString());
    console.log('Личный бот подключён. Проверка записей — раз в минуту. Контакты и токен не записаны в журнал.');
  });
}

/** Owner-only minute trigger. A failure never changes or cancels a reservation. */
function ownerBotTick(){
  if(PropertiesService.getScriptProperties().getProperty('OWNER_BOT_ENABLED')!=='true')return;
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try{
    const props=PropertiesService.getScriptProperties();
    const ledger=ownerLedger_();
    ownerPoll_(ledger);
    ownerScan_(ledger);
    props.setProperty('OWNER_BOT_LAST_OK',new Date().toISOString());
    props.deleteProperty('OWNER_BOT_LAST_ERROR');
  }catch(error){
    // No payloads, contact details, Telegram response bodies or credential-bearing URLs in logs.
    PropertiesService.getScriptProperties().setProperty('OWNER_BOT_LAST_ERROR',new Date().toISOString());
    console.log('Личный бот: запуск не завершён; повтор на следующем тике.');
  }finally{lock.releaseLock();}
}

function ownerConfig_(){
  let cfg;try{cfg=JSON.parse(PropertiesService.getScriptProperties().getProperty('OWNER_BOT_CONFIG')||'{}');}catch(e){throw new Error('owner_bot_not_configured');}
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(cfg.token||'')||!/^\d+$/.test(String(cfg.ownerId||'')))throw new Error('owner_bot_not_configured');
  return cfg;
}
function ownerTelegram_(method,payload){
  const cfg=ownerConfig_();
  try{
    const response=UrlFetchApp.fetch('https://api.telegram.org/bot'+cfg.token+'/'+method,{
      method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true
    });
    const json=JSON.parse(response.getContentText());
    if(json.ok)return {ok:true,result:json.result};
    // Only an explicit 429 is safe to retry automatically; ambiguous outcomes are not reported as sent.
    return {ok:false,state:json.error_code===429?'retry':json.error_code>=500?'uncertain':'failed',code:json.error_code,retryAfter:Number((json.parameters||{}).retry_after||60)};
  }catch(e){return {ok:false,state:'uncertain'};}
}
/** Safe connectivity diagnostics: no credentials, IDs or booking contacts in the execution log. */
function verifyOwnerBotConnection(){
  const me=ownerTelegram_('getMe',{}),cfg=ownerConfig_();
  const chat=ownerTelegram_('getChat',{chat_id:cfg.ownerId});
  console.log(JSON.stringify({authorization:String(ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus()),botOK:me.ok,botName:me.ok?me.result.username:null,botError:me.code||me.state||null,chatOK:chat.ok,ownerName:chat.ok?chat.result.username:null,chatError:chat.code||chat.state||null}));
}
function ownerLedgerSheet_(){
  const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID'));
  let sheet=ss.getSheetByName(OWNER_BOT.ledger);
  if(!sheet){sheet=ss.insertSheet(OWNER_BOT.ledger);sheet.appendRow(OWNER_BOT.columns);sheet.setFrozenRows(1);sheet.getRange('A:D').setNumberFormat('@');}
  return sheet;
}
function ownerLedger_(){
  const sheet=ownerLedgerSheet_();const records={};
  sheet.getDataRange().getDisplayValues().slice(1).forEach(function(r,i){records[r[0]]={row:i+2,state:r[1],updated:r[2],messageId:r[3]};});
  return {sheet:sheet,records:records};
}
function ownerRecord_(ledger,key,state,messageId){
  const entry=ledger.records[key];
  const values=[key,state,new Date().toISOString(),String(messageId||'')];
  if(entry)ledger.sheet.getRange(entry.row,1,1,4).setValues([values]);
  else{ledger.sheet.appendRow(values);}
  SpreadsheetApp.flush();
  ledger.records[key]={row:entry?entry.row:ledger.sheet.getLastRow(),state:state,updated:values[2],messageId:values[3]};
}
function ownerKeyboard_(){return {inline_keyboard:[[{text:'Сегодня',callback_data:'owner_today'},{text:'Ближайшие записи',callback_data:'owner_bookings'}],[{text:'Запись на фокус',url:'https://b0ver.github.io/chik-focus/'}]]};}
function ownerNotifyOnce_(key,text,ledger){
  const existing=ledger.records[key];
  if(existing){
    if(existing.state==='sent')return true;
    // A pending marker after interruption means the API outcome is unknown: never blindly duplicate it.
    if(existing.state!=='retry'||Date.now()<Date.parse(existing.updated)+60000)return false;
  }
  const cfg=ownerConfig_();
  ownerRecord_(ledger,key,'pending','');
  const response=ownerTelegram_('sendMessage',{chat_id:cfg.ownerId,text:text.slice(0,4000),reply_markup:ownerKeyboard_(),link_preview_options:{is_disabled:true}});
  if(response.ok){ownerRecord_(ledger,key,'sent',response.result.message_id);return true;}
  ownerRecord_(ledger,key,response.state||'uncertain','');
  if(response.state==='retry'&&response.retryAfter>60){
    const entry=ledger.records[key];entry.updated=new Date(Date.now()+(response.retryAfter-60)*1000).toISOString();
    ledger.sheet.getRange(entry.row,3).setValue(entry.updated);SpreadsheetApp.flush();
  }
  return false;
}
function ownerDay_(date){return Utilities.formatDate(date,SETTINGS.timezone,'yyyy-MM-dd');}
function ownerTime_(iso){return Utilities.formatDate(new Date(iso),SETTINGS.timezone,'dd.MM HH:mm');}
function ownerActive_(){
  const slots=slotList_();
  return rows_().filter(function(b){return b.Status==='confirmed';}).map(function(b){
    const s=slots.find(function(s){return s.id===b.Slot;});return s?{booking:b,slot:s}:null;
  }).filter(function(b){return b&&Date.parse(b.slot.end)>Date.now();}).sort(function(a,b){return Date.parse(a.slot.start)-Date.parse(b.slot.start);});
}
function ownerBookingText_(b,slot){
  const role={master:'мастер',client:'клиент',other:'другой опыт'}[b.Role]||'участник';
  return ownerTime_(slot.start)+' МСК · 30 минут\n'+b.Name+' · '+role+'\n'+b.Contact+'\n'+(b.Format==='meet'?'Google Meet':'Телемост');
}
function ownerAgenda_(mode){
  const day=ownerDay_(new Date());
  const list=ownerActive_().filter(function(item){return mode!=='today'||ownerDay_(new Date(item.slot.start))===day;});
  const header=mode==='today'?'Сегодня, '+Utilities.formatDate(new Date(),SETTINGS.timezone,'dd.MM'):'Ближайшие записи';
  if(!list.length)return header+'\n\nЗаписей нет. Можно выдохнуть)';
  return header+' · '+list.length+'\n\n'+list.map(function(item){return ownerBookingText_(item.booking,item.slot);}).join('\n\n')+'\n\nСсылку на созвон отправь участнику вручную.';
}
function ownerPoll_(ledger){
  const cfg=ownerConfig_(),props=PropertiesService.getScriptProperties();
  const response=ownerTelegram_('getUpdates',{offset:Number(props.getProperty('OWNER_UPDATE_OFFSET')||cfg.offset||0),limit:50,timeout:0,allowed_updates:['message','callback_query']});
  if(!response.ok)throw new Error('owner_bot_poll_failed');
  response.result.forEach(function(update){
    const callback=update.callback_query;
    const message=callback?callback.message:update.message;
    const from=callback?callback.from:message&&message.from;
    const chat=message&&message.chat;
    if(from&&chat&&String(from.id)===String(cfg.ownerId)&&String(chat.id)===String(cfg.ownerId)&&chat.type==='private'){
      let command=callback?callback.data:String(message.text||'').split(/\s/)[0].split('@')[0];
      if(callback)ownerTelegram_('answerCallbackQuery',{callback_query_id:callback.id});
      let text;
      if(command==='/today'||command==='owner_today')text=ownerAgenda_('today');
      else if(command==='/bookings'||command==='owner_bookings'||command==='/start')text=ownerAgenda_('bookings');
      else if(command==='/status'){
        const entries=Object.keys(ledger.records).map(function(k){return ledger.records[k];});
        text='Личный Чик работает по Москве. Проверка — примерно раз в минуту.\nПоследний успешный запуск: '+(props.getProperty('OWNER_BOT_LAST_OK')?ownerTime_(props.getProperty('OWNER_BOT_LAST_OK')):'первый запуск')+'\nУведомлений, принятых Telegram: '+entries.filter(function(r){return r.state==='sent';}).length+'\nТребуют проверки: '+entries.filter(function(r){return r.state!=='sent';}).length+'\n\nПринято Telegram — не подтверждение прочтения. Отправка участникам и Google Календарь пока не подключены.';
      }else if(command==='/help')text='Твой кабинет организатора в Чике)\n\n/today — записи на сегодня\n/bookings — все ближайшие записи и контакты\n/status — состояние уведомлений\n\nСообщаю о новых записях и отменах, напоминаю за 30 и 5 минут, в 08:30 — план дня. Ссылку на созвон отправляешь сам. Остальным пользователям эти данные недоступны.';
      if(text)ownerNotifyOnce_('update-'+update.update_id,text,ledger);
    }
    // Other users are ignored; owner identity is numeric, never based on a user-supplied username.
    props.setProperty('OWNER_UPDATE_OFFSET',String(update.update_id+1));
  });
}
function ownerScan_(ledger){
  const props=PropertiesService.getScriptProperties();
  const state=JSON.parse(props.getProperty('OWNER_BOOKING_STATE')||'{}');
  const rows=rows_(),slots=slotList_();
  rows.forEach(function(b){
    const slot=slots.find(function(s){return s.id===b.Slot;});
    if(!slot)return;
    if(state[b.ID]!==b.Status){
      if(!state[b.ID]&&b.Status==='cancelled'){state[b.ID]=b.Status;return;}
      const title=b.Status==='confirmed'?'Новая запись. Чик!':'Запись отменена';
      if(ownerNotifyOnce_('booking-'+b.ID+'-'+b.Status,title+'\n\n'+ownerBookingText_(b,slot)+'\n\n'+(b.Status==='confirmed'?'Ссылку на созвон отправь участнику вручную.':'Время снова свободно.'),ledger))state[b.ID]=b.Status;
    }
    if(b.Status==='confirmed'){
      const delta=Date.parse(slot.start)-Date.now();
      OWNER_BOT.reminderMinutes.forEach(function(minutes,index){
        const lower=index===0?OWNER_BOT.reminderMinutes[1]*60000:0;
        if(delta>lower&&delta<=minutes*60000)ownerNotifyOnce_('reminder-'+b.ID+'-'+minutes,
          'Скоро встреча — через '+Math.max(1,Math.ceil(delta/60000))+' мин.\n\n'+ownerBookingText_(b,slot)+'\n\nПроверь, что участнику отправлена ссылка на созвон.',ledger);
      });
    }
  });
  const time=Utilities.formatDate(new Date(),SETTINGS.timezone,'HH:mm');
  const day=ownerDay_(new Date());
  if(SETTINGS.dates.indexOf(day)>=0&&time>='08:30'&&time<'12:00')ownerNotifyOnce_('daily-'+day,ownerAgenda_('today'),ledger);
  props.setProperty('OWNER_BOOKING_STATE',JSON.stringify(state));
}

/** Owner can stop only notifications, preserving bookings and the public service. */
function pauseOwnerBot(){PropertiesService.getScriptProperties().setProperty('OWNER_BOT_ENABLED','false');}
