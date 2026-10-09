/* SENSO PULSO - Prototipo interactivo sin servidor.
 * IMPORTANTE: detección y dispositivos SON SIMULADOS; la grabación utiliza el micrófono real.
 * Metadatos guardados en localStorage; archivos de audio guardados en IndexedDB del navegador.
 */
'use strict';
const STORAGE_KEY='senso-pulso-v2';
const DEFAULT_DEVICES=[
  {id:'demo-sala',name:'Micrófono Sala',loc:'Sala principal',battery:72,connected:true},
  {id:'demo-cocina',name:'Micrófono Cocina',loc:'Cocina',battery:43,connected:true},
  {id:'demo-dormitorio',name:'Micrófono Dormitorio',loc:'Dormitorio',battery:18,connected:false}
];
const CANDIDATES=[
  {name:'Pulse Senso A02',loc:'Sala',battery:85},
  {name:'Micrófono Jardín',loc:'Jardín',battery:74},
  {name:'Micrófono Oficina',loc:'Oficina',battery:91}
];
const SOUND_ICONS={'Timbre':'🔔','Bebé':'👶','Emergencia':'🚨','Llamada':'📞','Vehículo':'🚗','Personalizado':'⭐'};
const ICON_BG_DARK={'Timbre':'#2a2a10','Bebé':'#2a1a00','Emergencia':'#2a1010','Llamada':'#1a2a1a','Vehículo':'#1e1e30','Personalizado':'#1e2a2e'};
const ICON_BG_LIGHT={'Timbre':'#fff9e0','Bebé':'#fff5e0','Emergencia':'#fff0f0','Llamada':'#f0fff0','Vehículo':'#f0f0ff','Personalizado':'#f0fff5'};
const VIBRATIONS={corto:[150],doble:[150,120,150],largo:[650],continua:[200,100,200,100,200]};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const $=id=>document.getElementById(id);
const uuid=()=> typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const freshState=()=>({theme:'dark',sounds:[],events:[],devices:DEFAULT_DEVICES.map(d=>({...d}))});
let state=freshState();
try {
 const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
 if(raw&&typeof raw==='object'){
  state={theme:raw.theme==='light'?'light':'dark',
    sounds:Array.isArray(raw.sounds)?raw.sounds.filter(s=>s&&typeof s.name==='string'):[],
    events:Array.isArray(raw.events)?raw.events.filter(e=>e&&typeof e.name==='string').slice(0,300):[],
    devices:Array.isArray(raw.devices)?raw.devices.filter(d=>d&&typeof d.name==='string'):DEFAULT_DEVICES.map(d=>({...d}))};
 }
} catch(e) { console.warn('No fue posible restaurar los datos:',e); }
let sounds=state.sounds;
let isDark=state.theme==='dark';
let currentFilter='todos', soundQuery='',historyFilter='todos';
let pendingSound=null, pendingBlob=null, pendingDuration=0, recording=null, recordStream=null, recordChunks=[], recInterval=null, recSecs=0;
let ctxSoundIdx=-1, lastPlaying=null, modalOnSave=null, toastTimer=null, chosenCandidate='';
let selectedHistoryId=null, shuttingRecording=false;
function persist(){
 state.sounds=sounds; state.theme=isDark?'dark':'light';
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}
 catch(e){toast('No fue posible guardar cambios: revisa el espacio o los permisos del navegador.');return false;}
}
function toast(message){const el=$('app-toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600);}
function dateFmt(ms){return new Date(ms).toLocaleString('es-BO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function clock(ms){return new Date(ms).toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});}
function timeDuration(n){const s=Math.round(n);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function goTo(id){
 const el=$(id); if(!el)return;
 if(recording && id!=='v-add2')cleanupRecording(false);
 if(lastPlaying){lastPlaying.pause();lastPlaying=null;}
 document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
 el.classList.add('active');
 if(id==='v-add1')resetAddFlow();
 if(id==='v-add2')resetRecorderUi();
 if(id==='v-add3')buildWaveform();
 if(id==='v-sonidos')renderSounds();
 if(id==='v-home')renderHome();
 if(id==='v-historial')renderHistory();
 if(id==='v-dispositivos')renderDevices();
 if(id==='v-dev-scan')renderCandidates();
 if(id==='v-hist-detail')renderHistoryDetail();
 closeCtxSound();
}
async function requestFullScreen(){
 const el=document.documentElement;
 try{
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if(el.requestFullscreen){await el.requestFullscreen();return;}
 }catch(e){console.warn(e)}
 toast('Tu navegador no permite pantalla completa aquí. Puedes agregar la página a la pantalla de inicio.');
}
function toggleMode(){isDark=!isDark;applyTheme();persist();renderSounds();renderDevices();renderHistory();renderHistoryDetail();}
function applyTheme(){
 document.body.className=isDark?'dark':'light';
 $('phone').className='phone '+(isDark?'dark':'light');
 $('theme-icon').className='ti ti-'+(isDark?'sun':'moon');
 $('sw-knob').style.left=isDark?'3px':'19px';
 document.querySelector('meta[name="theme-color"]').setAttribute('content',isDark?'#1D1D2E':'#F5F5F0');
}
function renderHome(){
 const last=state.events[0];
 $('home-event-name').textContent=last?last.name:'Sin eventos todavía';
 $('home-event-time').textContent=last?'Prueba · '+dateFmt(last.time):'Prueba una alerta desde Sonidos';
 $('bell-dot').style.display=last?'block':'none';
}
function resetAddFlow(){
 document.querySelectorAll('.sg-item').forEach(el=>el.classList.remove('selected'));
 $('sound-name-input').value='';$('ubicacion-select').value='puerta';$('custom-ubicacion-input').value='';
 $('custom-ubicacion-wrap').style.display='none';$('btn-add1').disabled=true;
 document.querySelectorAll('.radio-dot').forEach(d=>d.classList.remove('sel'));
 const rows=document.querySelectorAll('.radio-row');if(rows[1])rows[1].querySelector('.radio-dot').classList.add('sel');
 document.querySelectorAll('.pri-btn').forEach(b=>b.classList.remove('sel-pri'));
 if(document.querySelector('.pri-btn'))document.querySelector('.pri-btn').classList.add('sel-pri');
 $('custom-vibration-wrapper').style.display='none';$('custom-vibration').value='150,100,150';
 pendingSound=null;pendingBlob=null;pendingDuration=0;stopSoundPlayback();
}
function selectSound(name,id,icon,cat){
 document.querySelectorAll('.sg-item').forEach(el=>el.classList.remove('selected'));
 $(id).classList.add('selected');
 pendingSound={name,icon:icon||SOUND_ICONS[name]||'⭐',cat:cat||'personalizados'};
 $('sound-name-input').value=name==='Personalizado'?'':name+' principal';
 $('add4-icon').textContent=pendingSound.icon;$('add4-name').textContent=name;
 $('btn-add1').disabled=false;
}
function resetRecorderUi(){
 $('record-status').textContent='Listo para grabar';$('rec-timer').textContent='00:00';
 $('record-start').disabled=false;$('record-stop').disabled=true;
}
function stopSoundPlayback(){if(lastPlaying){lastPlaying.pause();lastPlaying=null;}}
async function startRecording(){
 if(recording || shuttingRecording)return;
 if(!window.isSecureContext){toast('La grabación requiere HTTPS. Abre la página publicada en Netlify.');return;}
 if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined'){
  toast('Tu navegador no permite grabar audio. Prueba Chrome actualizado en Android.');return;
 }
 $('record-start').disabled=true;
 $('record-status').textContent='Solicitando acceso al micrófono...';
 let stream;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false},video:false});
  if(!$('v-add2').classList.contains('active')){stream.getTracks().forEach(t=>t.stop());return;}
  const options=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=options?new MediaRecorder(stream,{mimeType:options}):new MediaRecorder(stream);
  recordStream=stream;recording=rec;recordChunks=[];recSecs=0;
  rec.ondataavailable=e=>{if(e.data&&e.data.size)recordChunks.push(e.data)};
  rec.onerror=e=>{console.error(e);toast('No se pudo finalizar la grabación.');cleanupRecording(false);resetRecorderUi()};
  rec.start(250);
  $('record-stop').disabled=false;$('record-status').textContent='Grabando audio real...';
  recInterval=setInterval(()=>{
   recSecs++;$('rec-timer').textContent=timeDuration(recSecs);
   if(recSecs>=30)stopRecording(true);
  },1000);
 }catch(e){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  $('record-status').textContent='No se pudo activar el micrófono';$('record-start').disabled=false;
  toast(e.name==='NotAllowedError'?'Permiso de micrófono denegado. Permítelo en los ajustes del sitio.':'Error del micrófono: '+e.message);
 }
}
function cleanupRecording(keepBlob){
 if(recInterval){clearInterval(recInterval);recInterval=null;}
 const rec=recording;recording=null;
 if(rec&&rec.state!=='inactive'){try{rec.onstop=null;rec.stop()}catch(e){console.warn(e)}}
 if(recordStream){recordStream.getTracks().forEach(t=>t.stop());recordStream=null;}
 if(!keepBlob)recordChunks=[];
}
function stopRecording(shouldReview){
 if(shuttingRecording||!recording||recording.state==='inactive')return;
 shuttingRecording=true;
 if(recInterval){clearInterval(recInterval);recInterval=null;}
 const rec=recording;
 $('record-stop').disabled=true;
 $('record-status').textContent='Finalizando grabación...';
 rec.onstop=()=>{
  const blob=new Blob(recordChunks,{type:rec.mimeType||recordChunks[0]?.type||'audio/webm'});
  if(recordStream){recordStream.getTracks().forEach(t=>t.stop());recordStream=null;}
  recording=null;recordChunks=[];shuttingRecording=false;
  if(shouldReview && blob.size>0){pendingBlob=blob;pendingDuration=Math.max(1,recSecs);$('record-duration').textContent=timeDuration(pendingDuration);goTo('v-add3');}
  else{resetRecorderUi();toast('La grabación está vacía. Vuelve a intentarlo.');}
 };
 try{rec.stop()}catch(e){shuttingRecording=false;cleanupRecording(false);toast('No se pudo detener el micrófono.');}
}
function cancelRecording(){cleanupRecording(false);shuttingRecording=false;pendingBlob=null;pendingDuration=0;goTo('v-add1');}
function buildWaveform(){
 const c=$('waveform-bars');c.innerHTML='';
 [10,19,29,15,34,23,37,19,26,40,18,31,24,14,35,29,15,23,17,11].forEach(h=>{
  const b=document.createElement('div');b.className='wf-bar';b.style.width='5px';b.style.height=h+'px';c.appendChild(b);
 });
 $('record-duration').textContent=timeDuration(pendingDuration);
}
function playBlob(blob){
 if(!blob){toast('Este sonido no tiene una grabación asociada.');return;}
 stopSoundPlayback();const url=URL.createObjectURL(blob);const audio=new Audio(url);lastPlaying=audio;
 audio.onended=()=>{URL.revokeObjectURL(url);if(lastPlaying===audio)lastPlaying=null};
 audio.onerror=()=>{URL.revokeObjectURL(url);toast('El navegador no pudo reproducir el audio.')};
 audio.play().catch(()=>{URL.revokeObjectURL(url);toast('No se pudo reproducir la grabación.')});
}
function playPendingRecording(){playBlob(pendingBlob);}
function handleUbicacion(sel){$('custom-ubicacion-wrap').style.display=sel.value==='personalizado'?'block':'none';if(sel.value==='personalizado')$('custom-ubicacion-input').focus();}
function validateSoundDetails(){
 if(!pendingBlob){toast('Primero graba una muestra de audio.');goTo('v-add2');return;}
 if(!$('sound-name-input').value.trim()){toast('Escribe un nombre para el sonido.');$('sound-name-input').focus();return;}
 if($('ubicacion-select').value==='personalizado'&&!$('custom-ubicacion-input').value.trim()){
  toast('Escribe la ubicación personalizada.');$('custom-ubicacion-input').focus();return;
 }
 $('add4-name').textContent=$('sound-name-input').value.trim();goTo('v-add4');
}
function selVib(row){document.querySelectorAll('.radio-dot').forEach(d=>d.classList.remove('sel'));row.querySelector('.radio-dot').classList.add('sel');$('custom-vibration-wrapper').style.display=Array.from(document.querySelectorAll('.radio-row')).indexOf(row)===4?'block':'none';}
function selPri(btn){document.querySelectorAll('.pri-btn').forEach(b=>b.classList.remove('sel-pri'));btn.classList.add('sel-pri');}
function customVibration(){
 const raw=$('custom-vibration').value.trim();const items=raw.split(',').map(x=>Number(x.trim()));
 if(!items.length||items.length>12||items.some(v=>!Number.isInteger(v)||v<30||v>2000))return null;
 return items;
}
function chosenVibration(){
 const row=document.querySelector('.radio-dot.sel')?.closest('.radio-row');
 const idx=Array.from(document.querySelectorAll('.radio-row')).indexOf(row);
 if(idx===4){const pattern=customVibration();if(!pattern)return null;return {type:'personalizada',pattern};}
 const types=['corto','doble','largo','continua'];const type=types[idx]||'doble';return {type,pattern:VIBRATIONS[type]};
}
function vibratePattern(pattern){
 if(navigator.vibrate){const ok=navigator.vibrate(pattern);if(ok){toast('Vibración enviada a este celular (si el sistema la permite).');return;}}
 toast('Este dispositivo/navegador no admite vibración web.');
}
function testCurrentVibration(){const v=chosenVibration();if(!v){toast('Patrón inválido: usa hasta 12 valores de 30 a 2000 ms, separados por comas.');return;}vibratePattern(v.pattern);}

// Grabaciones: persistencia local en IndexedDB sin servidor.
let audioDbPromise=null;
function audioDB(){
 if(!('indexedDB' in window))return Promise.reject(Error('IndexedDB no disponible'));
 if(!audioDbPromise){audioDbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('senso-pulso-audio',1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('recordings'))req.result.createObjectStore('recordings')};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 }).catch(e=>{audioDbPromise=null;throw e});}
 return audioDbPromise;
}
async function writeAudio(id,blob){const db=await audioDB();return new Promise((res,rej)=>{
 const tx=db.transaction('recordings','readwrite');tx.objectStore('recordings').put(blob,id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);
});}
async function readAudio(id){const db=await audioDB();return new Promise((res,rej)=>{
 const tx=db.transaction('recordings','readonly');const req=tx.objectStore('recordings').get(id);
 req.onsuccess=()=>res(req.result||null);req.onerror=()=>rej(req.error);
});}
async function removeAudio(id){try{const db=await audioDB();await new Promise((res,rej)=>{
 const tx=db.transaction('recordings','readwrite');tx.objectStore('recordings').delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);
});}catch(e){console.warn('No se pudo borrar audio',e)}}
async function saveSound(){
 if(!pendingSound||!pendingBlob){toast('Completa la grabación primero.');return;}
 const vibration=chosenVibration();if(!vibration){toast('El patrón personalizado no es válido.');return;}
 const btn=document.querySelector('#v-add4 .btn-main');btn.disabled=true;
 const locSel=$('ubicacion-select');const loc=locSel.value==='personalizado' ? $('custom-ubicacion-input').value.trim():locSel.options[locSel.selectedIndex].text;
 const pri=document.querySelector('.pri-btn.sel-pri')?.textContent.toLowerCase()||'baja';
 const sound={id:uuid(),name:$('sound-name-input').value.trim().slice(0,70),icon:pendingSound.icon,cat:pendingSound.cat,
   loc:loc||'Sin ubicación',pri,active:true,vibration:vibration.type,pattern:vibration.pattern,hasAudio:false,
   duration:pendingDuration,created:Date.now()};
 try{await writeAudio(sound.id,pendingBlob);sound.hasAudio=true;}
 catch(e){console.warn(e);toast('No se pudo guardar el audio. El sonido quedará como demostración sin archivo.');}
 sounds.push(sound);persist();
 $('saved-sound-title').textContent=sound.name+' guardado';
 $('saved-sound-desc').textContent=sound.hasAudio?'Audio guardado localmente en este navegador; sin detección automática.':'Configuración guardada. El audio no pudo conservarse en este navegador.';
 pendingBlob=null;pendingSound=null;btn.disabled=false;goTo('v-add5');
}
function quickAdd(name,icon,cat){
 sounds.push({id:uuid(),name:name+' principal',icon,cat,loc:'Sin ubicación',pri:'baja',active:true,
  vibration:'doble',pattern:VIBRATIONS.doble,hasAudio:false,duration:0,created:Date.now()});
 persist();renderSounds();toast('Sonido de demostración añadido. No tiene audio grabado.');
}
function filteredSounds(){return sounds.filter(s=>{
 if(currentFilter==='activos'&&!s.active)return false;
 if(!['todos','activos'].includes(currentFilter)&&s.cat!==currentFilter)return false;
 return (s.name+' '+s.loc).toLowerCase().includes(soundQuery.trim().toLowerCase());
});}
function renderSounds(){
 const list=$('sonidos-list'),active=sounds.filter(s=>s.active).length;
 $('sonidos-subtitle').textContent=`${sounds.length} registrados · ${active} activos · Datos locales de demostración`;
 list.innerHTML='';const result=filteredSounds();
 if(!sounds.length){
  list.innerHTML=`<div class="empty-state"><i class="ti ti-wave-sine empty-icon"></i><div class="empty-title">No tienes sonidos configurados</div><div class="empty-desc">Registra una muestra con el micrófono o añade un sonido de demostración.</div><button class="btn-add-sound" onclick="goTo('v-add1')">Grabar nuevo sonido</button><div class="empty-suggestions"><button class="sug-chip" onclick="quickAdd('Timbre','🔔','hogar')">🔔 Añadir timbre demo</button><button class="sug-chip" onclick="quickAdd('Emergencia','🚨','emergencia')">🚨 Emergencia demo</button></div></div>`;return;
 }
 if(!result.length){list.innerHTML='<div class="empty-state"><i class="ti ti-search empty-icon"></i><div class="empty-title">Sin resultados</div><div class="empty-desc">Prueba otro término o filtro.</div></div>';return;}
 result.forEach(s=>{
  const bg=isDark?(ICON_BG_DARK[s.name.split(' ')[0]]||'#1e2a2e'):(ICON_BG_LIGHT[s.name.split(' ')[0]]||'#e0fff5');
  const dots=(s.vibration==='continua'?'<div class="pulse-line"></div><div class="pulse-line"></div>':Array.from({length:Math.min(5,s.pattern?.filter((_,i)=>i%2===0).length||1)},()=>'<div class="pulse-dot"></div>').join(''));
  const card=document.createElement('div');card.className='sound-card';
  card.innerHTML=`<div class="sc-icon-wrap"><div class="sc-icon" style="background:${bg}">${esc(s.icon)}</div><div class="pri-dot pri-${['baja','media','alta','critica'].includes(s.pri)?s.pri:'baja'}"></div></div>
    <div style="flex:1;min-width:0;"><div class="sc-name">${esc(s.name)}</div><div class="sc-loc"><i class="ti ti-map-pin"></i>${esc(s.loc)}</div>
    <div class="sc-precision">${s.hasAudio?'Grabación local · '+timeDuration(s.duration||0):'Sin grabación · demo'}</div>
    <div class="sc-pulses">${dots}</div><div class="sound-actions"><button class="btn-mini" data-action="test"><i class="ti ti-bell-ringing"></i> Probar alerta</button>
    ${s.hasAudio?'<button class="btn-mini" data-action="play"><i class="ti ti-player-play"></i> Escuchar</button>':''}</div></div>
    <div class="sc-right"><button class="sw-toggle ${s.active?'on':'off'}" data-action="toggle" role="switch" aria-checked="${s.active}" aria-label="Activar o desactivar ${esc(s.name)}"><div class="sw-toggle-knob"></div></button>
    <button class="menu-btn" data-action="menu" aria-label="Opciones de ${esc(s.name)}"><i class="ti ti-dots-vertical"></i></button></div>`;
  card.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
   const act=button.dataset.action;
   if(act==='toggle')toggleSoundById(s.id);
   if(act==='test')testSound(s.id);
   if(act==='play')playSavedRecording(s.id);
   if(act==='menu')showCtxSound(s.id,button);
  }));
  list.appendChild(card);
 });
 const sum=document.createElement('div');sum.className='summary-card';sum.innerHTML=`<div class="sum-title">Biblioteca local</div><div class="sum-pct">${active} / ${sounds.length}</div><div class="sum-sub">Sonidos activos · Sin reconocimiento automático</div>`;list.appendChild(sum);
}
function toggleSoundById(id){const s=sounds.find(x=>x.id===id);if(!s)return;s.active=!s.active;persist();renderSounds();toast(s.active?'Alerta activada para pruebas.':'Alerta desactivada.');}
function filterChip(chip,filter){document.querySelectorAll('#v-sonidos .filter-row .chip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');currentFilter=filter;renderSounds();}
function filterSounds(q){soundQuery=q;renderSounds();}
function toggleSoundQuickFilter(){
 const next=currentFilter==='activos'?'todos':'activos';
 const chip=Array.from(document.querySelectorAll('#v-sonidos .filter-row .chip'))
  .find(el=>el.textContent.trim().toLowerCase()===next);
 if(chip)filterChip(chip,next);
 toast(next==='activos'?'Mostrando solo sonidos activos.':'Mostrando todos los sonidos.');
}
function showBandPreview(){
 const name=$('sound-name-input').value.trim()||pendingSound?.name||'Sonido';
 const vib=chosenVibration();
 if(!vib){toast('Corrige el patrón de vibración personalizado.');return;}
 showModal('Vista previa en pulsera',`<div style="text-align:center;font-size:44px;margin:16px">${esc(pendingSound?.icon||'🔔')}</div><p style="text-align:center;font-size:17px;font-weight:700">${esc(name)}</p><p class="field-help" style="text-align:center">Vista de demostración. La vibración se reproducirá en este teléfono, si el sistema lo permite; no en una pulsera real.</p>`,()=>{vibratePattern(vib.pattern);return true;},'Probar vibración');
}
async function playSavedRecording(id){
 const sound=sounds.find(s=>s.id===id);if(!sound||!sound.hasAudio){toast('No hay grabación disponible.');return;}
 try{const blob=await readAudio(id);playBlob(blob);}catch(e){toast('No se pudo leer el audio guardado en este navegador.');}
}
function showCtxSound(id,btn){
 closeCtxSound();ctxSoundIdx=sounds.findIndex(s=>s.id===id);if(ctxSoundIdx<0)return;
 const menu=document.createElement('div');menu.id='ctx-sound';menu.className='ctx-menu';menu.style.cssText='position:absolute;right:8px;top:40px;z-index:1000;display:block';
 menu.innerHTML='<button class="ctx-item" data-action="edit"><i class="ti ti-pencil"></i> Editar</button><button class="ctx-item" data-action="dup"><i class="ti ti-copy"></i> Duplicar</button><button class="ctx-item danger" data-action="del"><i class="ti ti-trash"></i> Eliminar</button>';
 btn.closest('.sound-card').appendChild(menu);
 menu.querySelector('[data-action="edit"]').addEventListener('click',()=>editSound(id));
 menu.querySelector('[data-action="dup"]').addEventListener('click',()=>dupSound(id));
 menu.querySelector('[data-action="del"]').addEventListener('click',()=>delSound(id));
 setTimeout(()=>document.addEventListener('click',closeMenuOutside,{once:true}),0);
}
function closeMenuOutside(event){const menu=$('ctx-sound');if(menu&&!menu.contains(event.target)&&!event.target.closest('[data-action="menu"]'))closeCtxSound();}
function closeCtxSound(){$('ctx-sound')?.remove();}
function editSound(id){
 closeCtxSound();const s=sounds.find(x=>x.id===id);if(!s)return;
 showModal('Editar sonido',`<label class="field-label" for="edit-name">Nombre</label><input id="edit-name" class="field-input" maxlength="70" value="${esc(s.name)}" required/>
 <label class="field-label" for="edit-loc">Ubicación</label><input id="edit-loc" class="field-input" maxlength="70" value="${esc(s.loc)}"/>
 <label class="field-label" for="edit-pri">Prioridad</label><select id="edit-pri" class="field-select">${['baja','media','alta','critica'].map(p=>`<option value="${p}" ${p===s.pri?'selected':''}>${p}</option>`).join('')}</select>
 <label class="field-label" for="edit-vib">Vibración</label><select id="edit-vib" class="field-select">${['corto','doble','largo','continua'].map(v=>`<option value="${v}" ${v===s.vibration?'selected':''}>${v}</option>`).join('')}</select>`,()=>{
  const name=$('edit-name').value.trim();if(!name){toast('Escribe un nombre válido.');return false;}
  s.name=name;s.loc=$('edit-loc').value.trim()||'Sin ubicación';s.pri=$('edit-pri').value;s.vibration=$('edit-vib').value;s.pattern=VIBRATIONS[s.vibration];
  persist();renderSounds();toast('Sonido actualizado.');return true;
 });
}
async function dupSound(id){
 closeCtxSound();const s=sounds.find(x=>x.id===id);if(!s)return;
 const copy={...s,id:uuid(),name:s.name+' (copia)',created:Date.now()};
 if(s.hasAudio){try{const blob=await readAudio(s.id);if(blob){await writeAudio(copy.id,blob)}else copy.hasAudio=false}catch(e){copy.hasAudio=false;}}
 sounds.push(copy);persist();renderSounds();toast('Sonido duplicado.');
}
function delSound(id){
 closeCtxSound();const s=sounds.find(x=>x.id===id);if(!s)return;
 showModal('Eliminar sonido',`<p>¿Eliminar <strong>${esc(s.name)}</strong> y su grabación local? Esta acción no se puede deshacer.</p>`,async()=>{
  sounds=sounds.filter(x=>x.id!==id);state.sounds=sounds;persist();await removeAudio(id);renderSounds();toast('Sonido eliminado.');return true;
 },'Eliminar');
}
function showModal(title,body,onSave,saveLabel='Guardar'){
 $('modal-heading').textContent=title;$('modal-body').innerHTML=body;
 $('modal-save').textContent=saveLabel;$('app-modal').hidden=false;modalOnSave=onSave;
 setTimeout(()=>$('app-modal').querySelector('input,select')?.focus(),30);
}
function closeAppModal(){$('app-modal').hidden=true;modalOnSave=null;}
$('modal-save').addEventListener('click',async()=>{
 if(!modalOnSave)return;const fn=modalOnSave;
 try{const result=await fn();if(result!==false)closeAppModal();}catch(e){console.error(e);toast('No se pudo completar la operación.');}
});
$('app-modal').addEventListener('click',e=>{if(e.target===$('app-modal'))closeAppModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAppModal();closeCtxSound()}});

function testSound(id){
 const s=sounds.find(x=>x.id===id);if(!s)return;
 if(!s.active){toast('Activa este sonido antes de probar la alerta.');return;}
 const event={id:uuid(),name:s.name,icon:s.icon,loc:s.loc,cat:s.cat,pri:s.pri,time:Date.now(),vibration:s.vibration,pattern:s.pattern};
 state.events.unshift(event);state.events=state.events.slice(0,300);persist();renderHome();
 if(navigator.vibrate)navigator.vibrate(s.pattern||VIBRATIONS.doble);
 toast('Alerta de prueba registrada en Historial. No se detectó un sonido real.');
}
function setHistoryFilter(chip){historyFilter=chip.dataset.filter;document.querySelectorAll('#history-filters .chip').forEach(x=>x.classList.toggle('active',x===chip));renderHistory();}
function filteredEvents(){const q=($('history-search')?.value||'').toLowerCase().trim();const today=new Date().toDateString();return state.events.filter(e=>{
 if(historyFilter==='hoy'&&new Date(e.time).toDateString()!==today)return false;
 if(!['todos','hoy'].includes(historyFilter)&&e.cat!==historyFilter)return false;
 return (e.name+' '+e.loc).toLowerCase().includes(q);
});}
function renderHistory(){
 const list=$('historial-list');if(!list)return;
 const events=filteredEvents();list.innerHTML='';
 const sum=document.createElement('div');sum.className='hist-summary';sum.innerHTML=`<div class="hist-sum-title">Registro local de pruebas</div><div class="hist-stats"><div class="hist-stat"><div class="hist-stat-num green">${state.events.length}</div><div class="hist-stat-lbl">Eventos totales</div></div><div class="hist-divider"></div><div class="hist-stat"><div class="hist-stat-num orange">${state.events.filter(e=>e.cat==='emergencia').length}</div><div class="hist-stat-lbl">Emergencias simuladas</div></div></div><p class="field-help">Estos eventos son pruebas manuales, no detecciones automáticas.</p>`;list.appendChild(sum);
 if(!events.length){const div=document.createElement('div');div.className='empty-state';div.innerHTML='<i class="ti ti-clock empty-icon"></i><div class="empty-title">Sin eventos de prueba</div><div class="empty-desc">Ve a Sonidos y pulsa «Probar alerta». Aquí aparecerá el historial.</div>';list.appendChild(div);return;}
 let day='';events.forEach(ev=>{
  const key=new Date(ev.time).toDateString();
  if(key!==day){day=key;const d=document.createElement('div');d.className='date-label hist-date';d.textContent=key===new Date().toDateString()?'Hoy':new Date(ev.time).toLocaleDateString('es-BO',{day:'numeric',month:'long',year:'numeric'});list.appendChild(d);}
  const card=document.createElement('button');card.type='button';card.className='hist-card';card.style.cssText='border:0;width:calc(100% - 24px);text-align:left;';
  card.innerHTML=`<div class="hist-icon" style="background:${ev.cat==='emergencia'?'#2a1010':'#1e2e29'}">${esc(ev.icon||'🔔')}</div><div style="flex:1;min-width:0;"><div class="hist-name">${esc(ev.name)}</div><div class="hist-loc"><i class="ti ti-map-pin"></i>${esc(ev.loc)}</div><span class="hist-badge ${ev.cat==='emergencia'?'badge-emerg':'badge-green'}">Prueba ${ev.cat==='emergencia'?'de emergencia':''}</span></div><div class="hist-time">${clock(ev.time)} <i class="ti ti-chevron-right"></i></div>`;
  card.addEventListener('click',()=>{selectedHistoryId=ev.id;goTo('v-hist-detail')});list.appendChild(card);
 });
}
function renderHistoryDetail(){const out=$('history-detail-content');if(!out)return;const ev=state.events.find(e=>e.id===selectedHistoryId);if(!ev){out.innerHTML='<p class="s-lbl">Selecciona un evento del historial.</p>';return;}
 out.innerHTML=`<div style="text-align:center;font-size:54px;margin:10px">${esc(ev.icon||'🔔')}</div><h2 class="step-title" style="text-align:center;margin-bottom:20px">${esc(ev.name)}</h2><div class="card" style="margin:0 0 14px"><div class="hist-detail-grid"><div><div class="s-lbl">Ubicación</div><strong>${esc(ev.loc)}</strong></div><div><div class="s-lbl">Fecha y hora</div><strong>${dateFmt(ev.time)}</strong></div><div><div class="s-lbl">Prioridad</div><strong>${esc(ev.pri)}</strong></div><div><div class="s-lbl">Vibración</div><strong>${esc(ev.vibration)}</strong></div></div></div><div class="demo-note">Evento generado manualmente con «Probar alerta». No corresponde a una detección acústica real.</div><button class="btn-main contained" id="repeat-event">Repetir vibración de prueba</button>`;
 $('repeat-event').addEventListener('click',()=>vibratePattern(ev.pattern||VIBRATIONS.doble));
}
function confirmClearHistory(){if(!state.events.length){toast('El historial ya está vacío.');return;}showModal('Vaciar historial','<p>¿Eliminar todos los eventos de prueba almacenados en este navegador?</p>',()=>{state.events=[];selectedHistoryId=null;persist();renderHistory();renderHome();toast('Historial vaciado.');return true;},'Vaciar');}
function exportHistory(){
 if(!state.events.length){toast('Todavía no hay eventos para exportar.');return;}
 const rows=[['Fecha','Sonido','Ubicación','Prioridad','Tipo'],...state.events.map(e=>[dateFmt(e.time),e.name,e.loc,e.pri,'Prueba simulada'])];
 const csv='\ufeff'+rows.map(row=>row.map(v=>{let str=String(v??'');if(/^[=+@-]/.test(str))str="'"+str;return '"'+str.replaceAll('"','""')+'"';}).join(';')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='senso-pulso-historial-demo.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
 toast('Historial de pruebas exportado.');
}

function renderDevices(){
 const list=$('devices-list');if(!list)return;list.innerHTML='';
 const header=document.createElement('div');header.className='dev-main-card';header.innerHTML=`<div class="dev-main-label">Pulsera principal · demostración</div><div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><div class="dev-main-name">Pulse Senso A01</div><div class="dev-main-loc"><i class="ti ti-map-pin"></i> Muñeca derecha (ejemplo)</div><div style="margin-top:8px"><span class="dev-badge-connected">⚪ No enlazada físicamente</span></div></div><i class="ti ti-device-watch" style="font-size:42px;color:#5DCAA5"></i></div><p class="field-help">Batería ilustrativa: 85 %. Para conectar pulseras reales se requiere hardware y protocolo compatible.</p>`;
 list.appendChild(header);
 const sec=document.createElement('div');sec.className='sec-lbl';sec.textContent=`Dispositivos simulados (${state.devices.length})`;list.appendChild(sec);
 if(!state.devices.length){const e=document.createElement('div');e.className='empty-state';e.innerHTML='<div class="empty-title">Sin dispositivos</div><div class="empty-desc">Pulsa + para agregar un dispositivo de prueba.</div>';list.appendChild(e);}
 state.devices.forEach(d=>{
  const c=document.createElement('div');c.className='dev-card';
  c.innerHTML=`<div class="dev-icon" style="background:#1a2e26"><i class="ti ti-microphone" style="color:#5DCAA5"></i></div><div style="flex:1;min-width:0"><div class="dev-name">${esc(d.name)}</div><div class="dev-loc"><i class="ti ti-map-pin"></i>${esc(d.loc)}</div><div class="dev-status" style="color:${d.connected?'#5DCAA5':'#E24B4A'}">${d.connected?'● Conectado (demo)':'○ Desconectado (demo)'}</div></div><div class="device-controls"><button class="small-action" data-do="toggle" aria-label="Cambiar conexión simulada">${d.connected?'Desconectar':'Conectar'}</button><button class="menu-btn" data-do="edit" aria-label="Editar dispositivo"><i class="ti ti-pencil"></i></button><button class="menu-btn" data-do="delete" aria-label="Olvidar dispositivo"><i class="ti ti-trash"></i></button></div>`;
  c.querySelector('[data-do="toggle"]').addEventListener('click',()=>{d.connected=!d.connected;persist();renderDevices();toast('Estado de conexión simulado actualizado.');});
  c.querySelector('[data-do="edit"]').addEventListener('click',()=>editDevice(d.id));
  c.querySelector('[data-do="delete"]').addEventListener('click',()=>forgetDevice(d.id));
  list.appendChild(c);
 });
 const sec2=document.createElement('div');sec2.className='sec-lbl';sec2.textContent='Cobertura simulada';list.appendChild(sec2);
 const cover=document.createElement('div');cover.className='coverage-grid';
 ['Sala','Cocina','Dormitorio','Baño'].forEach((room,idx)=>{
  const covered=state.devices.some(d=>d.connected&&(d.loc+' '+d.name).toLowerCase().includes(room.toLowerCase()));
  cover.innerHTML+=`<div class="cov-card"><div class="cov-icon">${['🛋️','🍳','🛏️','🛁'][idx]}</div><div class="cov-name">${room}</div><div class="cov-status ${covered?'cov-active':'cov-none'}">${covered?'● Activa (demo)':'Sin cobertura'}</div></div>`;
 });list.appendChild(cover);
}
function renderCandidates(){
 chosenCandidate='';$('new-device-name').value='';$('new-device-location').value='';
 const out=$('device-candidates');out.innerHTML='';
 CANDIDATES.filter(c=>!state.devices.some(d=>d.name===c.name)).forEach(candidate=>{
  const b=document.createElement('button');b.className='dev-result-card';b.style.cssText='text-align:left;background:transparent;border:1px solid #5DCAA5;';
  b.innerHTML=`<div class="dev-icon"><i class="ti ti-microphone" style="color:#5DCAA5"></i></div><div style="flex:1"><div class="dev-name">${esc(candidate.name)}</div><div class="dev-act">${esc(candidate.loc)} · Simulado</div></div><i class="ti ti-plus" style="color:#5DCAA5"></i>`;
  b.addEventListener('click',()=>{addDevice(candidate.name,candidate.loc,candidate.battery)});out.appendChild(b);
 });
 if(!out.children.length)out.innerHTML='<div class="field-help">Ya agregaste todos los ejemplos disponibles. Puedes crear uno personalizado.</div>';
}
function addDevice(name,loc,battery=80){
 state.devices.push({id:uuid(),name:name.slice(0,50),loc:loc.slice(0,60),battery,connected:true});persist();goTo('v-dispositivos');toast('Dispositivo simulado añadido. No se conectó por Bluetooth.');
}
function addCustomDevice(){const name=$('new-device-name').value.trim(),loc=$('new-device-location').value.trim();if(!name||!loc){toast('Completa nombre y ubicación.');return;}addDevice(name,loc);}
function editDevice(id){
 const d=state.devices.find(d=>d.id===id);if(!d)return;
 showModal('Editar dispositivo demo',`<label class="field-label" for="d-name">Nombre</label><input id="d-name" class="field-input" maxlength="50" value="${esc(d.name)}"/><label class="field-label" for="d-loc">Ubicación</label><input id="d-loc" class="field-input" maxlength="60" value="${esc(d.loc)}"/>`,()=>{
  const name=$('d-name').value.trim(),loc=$('d-loc').value.trim();if(!name||!loc){toast('Completa nombre y ubicación.');return false;}
  d.name=name;d.loc=loc;persist();renderDevices();toast('Dispositivo actualizado.');return true;
 });
}
function forgetDevice(id){const d=state.devices.find(d=>d.id===id);if(!d)return;showModal('Olvidar dispositivo',`<p>¿Quitar <strong>${esc(d.name)}</strong> de tu lista de dispositivos simulados?</p>`,()=>{state.devices=state.devices.filter(x=>x.id!==id);persist();renderDevices();toast('Dispositivo eliminado.');return true;},'Quitar');}

applyTheme();renderHome();renderSounds();renderHistory();renderDevices();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.warn));}
