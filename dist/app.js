'use strict';
const config = window.CHIK_FOCUS;
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const STORE = 'chik-focus-reservation-v1';
const FORMATS = {meet:'Google Meet',telemost:'Телемост'};
const icons = {
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  video:'<rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 5"/>'
};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`;}
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
function formatDate(value,options={day:'numeric',month:'long'}){return new Intl.DateTimeFormat('ru-RU',{timeZone:config.timezone,...options}).format(new Date(value.length===10?value+'T12:00:00+03:00':value));}
function formatTime(value){return new Intl.DateTimeFormat('ru-RU',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function datePart(value){return new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function stored(){try{return JSON.parse(localStorage.getItem(STORE));}catch{return null;}}
function saveReservation(value){try{if(value)localStorage.setItem(STORE,JSON.stringify(value));else localStorage.removeItem(STORE);}catch{/* A blocked local store must not turn a successful reservation into an error. */}}
let saved = stored();
const state={step:'time',date:config.dates[0],slot:null,format:'meet',slots:[],loaded:false,loading:false,error:'',submitting:false,reservation:null,request:saved?.request||null,contact:{name:'',contact:'',role:'master',consent:false},refreshTime:null};
let serverSkew=0;
function now(){return Date.now()+serverSkew;}
function rpc(action,data={}){
  return new Promise((resolve,reject)=>{
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.apiUrl)){reject(new Error('not_configured'));return;}
    const nonce=randomToken();
    const name='chik_rpc_'+nonce;
    const frame=document.createElement('iframe');
    frame.name=name;frame.hidden=true;frame.title='Сервис записи';frame.referrerPolicy='no-referrer';
    const form=document.createElement('form');
    form.method='POST';form.action=config.apiUrl;form.target=name;form.hidden=true;
    const field=document.createElement('input');field.name='payload';field.value=JSON.stringify({action,nonce,origin:location.origin,...data});form.append(field);
    let timer;
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);form.remove();frame.remove();};
    const receive=event=>{
      if(!/^https:\/\/(?:[a-z0-9-]+\.)?(?:script\.google\.com|googleusercontent\.com)$/.test(event.origin))return;
      const message=event.data;
      if(!message||message.channel!=='chik-focus-v1'||message.nonce!==nonce)return;
      cleanup();
      if(message.result?.ok)resolve(message.result);else reject(new Error(message.result?.code||'server_error'));
    };
    window.addEventListener('message',receive);document.body.append(frame,form);
    timer=setTimeout(()=>{cleanup();reject(new Error('uncertain'));},60000);
    form.submit();
  });
}
const errorText=code=>({
  not_configured:'Самостоятельная запись пока закрыта. Напишите Евгению — он поможет выбрать время.',
  unavailable:'Это время только что заняли или оно уже недоступно. Выберите другой слот.',
  already_booked:'У этого контакта уже есть активная запись. Чтобы её изменить, напишите Евгению.',
  rate_limited:'Слишком много попыток. Попробуйте позже или напишите Евгению.',
  uncertain:'Не удалось получить ответ. Бронь могла сохраниться. Нажмите «Проверить запись» — мы проверим её, не создавая новую.',
  invalid_contact:'Укажите Telegram @username (от 5 символов) или корректный email.',
  invalid_name:'Укажите имя: от 2 до 80 символов.',
  invalid_consent:'Для записи нужно согласие на обработку контактных данных.',
  closed:'Запись на эти даты завершена. Спасибо за интерес — напишите Евгению о следующей встрече.',
  expired:'Встреча уже началась. По вопросам переноса напишите Евгению.',
  not_found:'Запись не найдена. Возможно, она отменена. Если вы уже записывались, напишите Евгению.',
  busy:'Сервис сейчас занят. Попробуйте ещё раз через несколько секунд.'
}[code]||'Не получилось связаться с сервисом записи. Попробуйте ещё раз или напишите Евгению.');
function intro(){return `<section class="intro"><span class="live-badge"><i></i>Запись на встречу · 20–22 октября</span><h1>Потестим<br><span class="accent">«Чик!»</span> вместе?</h1><p class="intro-lead">Посмотрим сервис записи в деле.<br>Вы расскажете, что удобно, что бесит и чего не хватает. Я послушаю и покажу, что задумал.</p><div class="facts"><span class="fact">${icon('clock')}30 минут</span><span class="fact">${icon('video')}Онлайн</span><span class="fact">${icon('people')}Один на один</span><span class="fact">Бесплатно</span></div><div class="host"><span class="host-avatar">ЕП</span><div><strong>${esc(config.organizer)}</strong><p>Автор «Чика!» · буду на другой стороне экрана</p></div></div><div class="mascot-sticker"><img src="assets/chik-avatar.jpg" alt="Лаймовый календарик Чик"><p>Без правильных ответов.<br>Нужен ваш честный взгляд.</p></div></section>`;}
function steps(){const current=state.step==='time'?0:state.step==='contacts'?1:2;return `<div class="steps" aria-label="Шаги записи">${['Время','О вас','Готово'].map((v,i)=>`<span class="step ${current===i?'active':current>i?'done':''}" ${current===i?'aria-current="step"':''}><b>${current>i?'✓':i+1}</b>${v}</span>`).join('')}</div>`;}
function statusBar(){return `<div class="status"><span>${state.refreshTime?'Обновлено в '+new Date(state.refreshTime).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'Всё время — московское · UTC+3'}</span><button type="button" data-action="refresh" ${state.loading||state.submitting?'disabled':''}>${state.loading?'Обновляем…':'Обновить время ↻'}</button></div>`;}
function render(){
  const content=state.step==='done'?confirmation():state.step==='contacts'?contacts():chooseTime();
  app.innerHTML=`<div class="booking-layout">${intro()}<section class="booking-card" aria-label="Запись на фокус-группу">${steps()}<div class="card-body">${content}</div>${state.step==='time'?statusBar():''}</section></div>`;
  if(inTelegram&&tg.isVersionAtLeast?.('6.1')){if(state.step==='contacts')tg.BackButton.show();else tg.BackButton.hide();}
}
function chooseTime(){
  const daySlots=state.slots.filter(s=>datePart(s.start)===state.date);
  const days=config.dates.map(day=>{const count=state.slots.filter(s=>datePart(s.start)===day&&s.available&&new Date(s.start).getTime()>now()).length;return `<button class="day ${day===state.date?'selected':''}" data-action="day" data-value="${day}" aria-pressed="${day===state.date}" aria-label="${formatDate(day)}"><span>${formatDate(day,{weekday:'short'})}</span><strong>${formatDate(day,{day:'numeric'})}</strong><span>октября</span><small>${state.loaded?count+' '+(count===1?'окно':'окон'):'15:00–19:00'}</small></button>`;}).join('');
  const loadedTimes=daySlots.map(s=>`<button class="time ${state.slot?.id===s.id?'selected':''}" data-action="slot" data-value="${s.id}" aria-label="${formatTime(s.start)}${s.available?'':' — недоступно'}" aria-pressed="${state.slot?.id===s.id}" ${!s.available||new Date(s.start).getTime()<=now()?'disabled':''}>${formatTime(s.start)}</button>`).join('');
  const placeholders=config.times.map(t=>`<button class="time" disabled>${t}</button>`).join('');
  const notice=state.error?`<div class="notice ${state.error==='not_configured'?'':'error'}" role="status">${errorText(state.error)} <a href="https://t.me/${config.organizerTelegram}" target="_blank" rel="noopener noreferrer">@${config.organizerTelegram}</a></div>`:'';
  return `<div class="card-heading-row"><h2>Выберите время</h2><span class="eyebrow">МСК · UTC+3</span></div><p class="section-note">Полчаса на разговор. Ничего готовить не нужно.</p><div class="days" aria-label="Даты встреч">${days}</div><div class="time-heading"><h3>${formatDate(state.date)}</h3><small>Встреча · 30 мин</small></div><div class="times" aria-label="Время встречи">${state.loaded?loadedTimes:placeholders}</div>${state.loaded&&!daySlots.some(s=>s.available)?'<p class="no-slots">На этот день свободного времени нет.<br>Попробуйте соседнюю дату.</p>':''}${state.loading&&!state.loaded?'<p class="connection-label" role="status">Проверяем свободное время…</p>':''}${notice}<p class="format-label">Где созвонимся?</p><div class="formats" aria-label="Площадка встречи">${Object.entries(FORMATS).map(([k,v])=>`<button class="format ${state.format===k?'selected':''}" data-action="format" data-value="${k}" aria-pressed="${state.format===k}">${icon('video')}${v}<i aria-hidden="true"></i></button>`).join('')}</div><button class="btn primary continue" data-action="continue" ${!state.slot||!state.loaded?'disabled':''}>Продолжить ${icon('arrow')}</button><p class="under-button">${icon('shield')}Выбранное время закрепим после подтверждения</p>`;
}
function contacts(){return `<h2>Давайте познакомимся</h2><p class="section-note">Оставьте контакт — Евгений пришлёт ссылку на созвон.</p><div class="summary">${icon('calendar')}<div><strong>${formatDate(state.slot.start)}, ${formatTime(state.slot.start)}–${formatTime(state.slot.end)}</strong><small>МСК · ${FORMATS[state.format]} · бесплатно</small></div><button type="button" data-action="back">Изменить</button></div><form id="booking-form"><label class="field"><span>Как вас зовут?</span><input name="name" autocomplete="given-name" minlength="2" maxlength="80" required value="${esc(state.contact.name)}" placeholder="Ваше имя"></label><label class="field"><span>Telegram или email</span><input name="contact" autocomplete="off" maxlength="120" required value="${esc(state.contact.contact)}" placeholder="@username или name@example.com"><p class="field-help">Сюда придёт ссылка на встречу. Проверьте контакт.</p></label><label class="field"><span>Вы записываетесь к мастерам или работаете сами?</span><select name="role"><option value="master" ${state.contact.role==='master'?'selected':''}>Я мастер / специалист</option><option value="client" ${state.contact.role==='client'?'selected':''}>Я клиент</option><option value="other" ${state.contact.role==='other'?'selected':''}>У меня другой опыт</option></select></label><label class="hp" aria-hidden="true">Оставьте пустым<input name="website" tabindex="-1" autocomplete="off"></label><label class="consent"><input type="checkbox" name="consent" required ${state.contact.consent?'checked':''}><span>Согласен(на) передать имя и контакт Евгению Попову для организации встречи. <button type="button" data-action="privacy">Как хранятся данные</button></span></label>${state.error?`<p class="error-text" role="alert">${errorText(state.error)}</p>`:''}<div class="form-actions"><button type="button" class="btn secondary back" data-action="back" ${state.submitting||state.error==='uncertain'?'disabled':''}>Назад</button><button class="btn primary" type="submit" ${state.submitting?'disabled':''}>${state.submitting?'Закрепляем время…':state.error==='uncertain'?'Проверить запись':'Подтвердить запись'} ${icon('arrow')}</button></div><p class="under-button">Без оплаты. Отменить запись можно по вашей ссылке.</p></form>`;}
function confirmation(){const b=state.reservation;const cancelled=b?.status==='cancelled';return `<div class="success"><div class="success-icon">${cancelled?'×':'✓'}</div><h2>${cancelled?'Запись отменена':'Вы записаны.<br>Увидимся на созвоне!'}</h2><p class="section-note">${cancelled?'Время снова доступно другим участникам. Если планы изменятся — выберите новую встречу.':'Евгений пришлёт ссылку на встречу в указанный вами Telegram или на email.'}</p><div class="ticket"><span class="eyebrow">Фокус-группа «Чик!»</span><h3>${formatDate(b.start)}, ${formatTime(b.start)}–${formatTime(b.end)}</h3><p>Московское время · ${FORMATS[b.format]}</p><p>Евгений Попов · 30 минут · бесплатно</p><div class="ticket-meta"><span>ЗАПИСЬ № ${esc(b.id.slice(0,8).toUpperCase())}</span><span>${cancelled?'ОТМЕНЕНА':'ПОДТВЕРЖДЕНА'}</span></div></div>${!cancelled?`<button class="btn primary" data-action="save-link">Скопировать мою запись ${icon('arrow')}</button><p class="under-button">Сохраните личную ссылку — по ней можно отменить встречу.</p><div class="success-links"><a class="btn secondary" href="${calendarUrl(b)}" target="_blank" rel="noopener noreferrer">В Google Календарь ↗</a><button class="btn secondary" data-action="ics">Скачать .ics</button></div><button class="subtle-button" data-action="cancel" ${state.submitting?'disabled':''}>${state.submitting?'Отменяем…':'Отменить запись'}</button>`:'<button class="btn primary" data-action="new">Выбрать другое время</button>'}${state.error?`<p class="error-text" role="alert">${errorText(state.error)}</p>`:''}<p class="section-note"><a class="inline-link" href="https://t.me/${config.organizerTelegram}" target="_blank" rel="noopener noreferrer">Написать Евгению</a></p></div>`;}
function calendarUrl(b){const p=new URLSearchParams({action:'TEMPLATE',text:'Фокус-группа «Чик!» — встреча с Евгением',dates:icsTime(b.start)+'/'+icsTime(b.end),details:'30 минут о сервисе записи Чик! Площадка: '+FORMATS[b.format]+'. Ссылку на созвон Евгений пришлёт отдельно. Контакт: https://t.me/ealpopov',ctz:config.timezone});return 'https://calendar.google.com/calendar/render?'+p;}
function foldCalendar(line){let part='',out='';for(const ch of line){if(new TextEncoder().encode(part+ch).length>75){out+=part+'\r\n';part=' ';}part+=ch;}return out+part;}
function icsTime(date){return new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function captureContact(){const form=document.querySelector('#booking-form');if(!form)return;const d=new FormData(form);state.contact={name:String(d.get('name')||'').trim(),contact:String(d.get('contact')||'').trim(),role:String(d.get('role')||'other'),consent:d.has('consent')};}
async function refresh(silent=false){
  if(state.loading||state.submitting||!config.apiUrl)return;
  state.loading=true;if(!silent)render();
  try{const result=await rpc('availability');serverSkew=Date.parse(result.serverTime)-Date.now();state.slots=result.slots;state.loaded=true;state.error='';state.refreshTime=Date.now();if(state.slot&&!state.slots.some(s=>s.id===state.slot.id&&s.available)){state.slot=null;if(state.step==='contacts'){captureContact();state.step='time';state.error='unavailable';}}}
  catch(error){state.error=error.message;/* Do not retain a selectable stale slot after a failed refresh. */state.slot=null;state.loaded=false;if(state.step==='contacts'){captureContact();state.step='time';}}
  finally{state.loading=false;if(state.step==='time')render();}
}
function manageLink(){return config.publicUrl+'#booking='+state.request.manageToken;}
async function submit(form){
  if(state.submitting)return;
  captureContact();
  if(state.contact.name.length<2){state.error='invalid_name';render();return;}
  if(!/^(?:@[A-Za-z][A-Za-z0-9_]{4,31}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(state.contact.contact)){state.error='invalid_contact';render();return;}
  if(!state.contact.consent){state.error='invalid_consent';render();return;}
  const honeypot=new FormData(form).get('website');
  if(!state.request){state.request={requestId:crypto.randomUUID(),manageToken:randomToken()};saveReservation({request:state.request});}
  const request={...state.request,slotId:state.slot.id,format:state.format,...state.contact,website:honeypot||'',consentVersion:'2026-10-19-v1'};
  state.submitting=true;state.error='';render();
  try{const result=await rpc('book',request);state.reservation=result.booking;state.step='done';history.replaceState(null,'','#booking='+state.request.manageToken);tg?.HapticFeedback?.notificationOccurred?.('success');}
  catch(error){state.error=error.message;if(error.message==='unavailable'){state.step='time';state.slot=null;state.request=null;saveReservation(null);}}
  finally{state.submitting=false;render();if(state.step==='done')document.querySelector('.booking-card').scrollIntoView({block:'start',behavior:'smooth'});}
}
function showPrivacy(){dialog.innerHTML=`<h2>О ваших данных</h2><p>Организатор — Евгений Попов, Telegram <a class="inline-link" href="https://t.me/ealpopov" target="_blank" rel="noopener noreferrer">@ealpopov</a>.</p><p>Имя, контакт, выбранное время и формат встречи передаются организатору и хранятся в его закрытой Google-таблице. Эти данные нужны, чтобы договориться о созвоне. Они не появляются на публичной странице и не добавляются в GitHub.</p><p>Рекламных рассылок и платной подписки здесь нет. Для удаления записи и контактных данных напишите организатору. После завершения исследования контакты будут удалены в течение 30 дней.</p><p>Личная ссылка на управление записью сохраняется на этом устройстве. Берегите её: любой, у кого она есть, сможет отменить вашу встречу. Сторонняя аналитика не подключена.</p><button class="btn primary" data-action="close">Понятно</button>`;dialog.showModal();}
async function cancel(){
  if(state.submitting)return;
  dialog.innerHTML='<h2>Отменить встречу?</h2><p>Время освободится для другого участника. Если захотите перенести встречу — отмените текущую и выберите другую.</p><button class="btn danger" data-action="confirm-cancel">Да, отменить запись</button><button class="btn secondary" data-action="close">Оставить запись</button>';dialog.showModal();
}
async function confirmCancel(){dialog.close();state.submitting=true;state.error='';render();try{const r=await rpc('cancel',{manageToken:state.request.manageToken});state.reservation=r.booking;}catch(error){state.error=error.message;}finally{state.submitting=false;render();}}
async function restore(token){state.loading=true;state.error='';state.request={manageToken:token};render();try{const result=await rpc('lookup',{manageToken:token});state.reservation=result.booking;state.step='done';saveReservation({request:{manageToken:token}});}catch(error){state.error=error.message;state.request=null;}finally{state.loading=false;render();}}
document.addEventListener('submit',event=>{if(event.target.id==='booking-form'){event.preventDefault();submit(event.target);}});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,value=button.dataset.value;
  if(action==='day'){state.date=value;state.error='';state.slot=null;render();}
  if(action==='slot'){state.slot=state.slots.find(s=>s.id===value&&s.available);state.error='';render();}
  if(action==='format'){state.format=value;render();}
  if(action==='continue'&&state.slot){state.step='contacts';state.error='';render();document.querySelector('.booking-card').scrollIntoView({block:'start',behavior:'smooth'});}
  if(action==='back'){captureContact();state.step='time';state.error='';render();}
  if(action==='refresh')refresh();
  if(action==='privacy')showPrivacy();
  if(action==='close')dialog.close();
  if(action==='cancel')cancel();
  if(action==='confirm-cancel')confirmCancel();
  if(action==='new'){state.step='time';state.reservation=null;state.request=null;state.slot=null;state.error='';saveReservation(null);history.replaceState(null,'',location.pathname);render();refresh();}
  if(action==='save-link'){try{await navigator.clipboard.writeText(manageLink());button.textContent='Ссылка скопирована ✓';}catch{dialog.innerHTML=`<h2>Ваша личная ссылка</h2><p>Скопируйте и сохраните её:</p><input aria-label="Ссылка на вашу запись" readonly value="${esc(manageLink())}"><button class="btn primary" data-action="close">Закрыть</button>`;dialog.showModal();}}
  if(action==='ics'){const b=state.reservation;const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Chik//Focus group//RU','BEGIN:VEVENT','UID:'+b.id+'@chik-focus','DTSTAMP:'+icsTime(new Date()),'DTSTART:'+icsTime(b.start),'DTEND:'+icsTime(b.end),'SUMMARY:Фокус-группа Чик! — встреча с Евгением','DESCRIPTION:Площадка: '+FORMATS[b.format]+'. Ссылку на созвон Евгений пришлёт отдельно. Контакт: t.me/ealpopov','END:VEVENT','END:VCALENDAR',''].map(foldCalendar).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type:'text/calendar;charset=utf-8'}));a.download='chik-focus.ics';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
});
if(inTelegram){tg.ready();tg.expand();if(tg.isVersionAtLeast?.('6.1')){tg.setHeaderColor('#111a16');tg.setBackgroundColor('#111a16');tg.BackButton.onClick(()=>{if(state.step==='contacts'){captureContact();state.step='time';render();}});}if(tg.isVersionAtLeast?.('7.10'))tg.setBottomBarColor('#111a16');if(tg.isVersionAtLeast?.('8.0')){const safe=()=>{for(const edge of ['top','bottom'])document.documentElement.style.setProperty('--safe-'+edge,Math.max(0,Number(tg.safeAreaInset?.[edge])||0)+Math.max(0,Number(tg.contentSafeAreaInset?.[edge])||0)+'px');};safe();tg.onEvent('safeAreaChanged',safe);tg.onEvent('contentSafeAreaChanged',safe);}}
const token=location.hash.match(/^#booking=([a-f0-9]{64})$/)?.[1]||saved?.request?.manageToken;
render();
if(!config.apiUrl){state.error='not_configured';render();}
else if(token)restore(token);
else refresh();
setInterval(()=>{if(state.step==='time'&&document.visibilityState==='visible')refresh(true);},30000);
