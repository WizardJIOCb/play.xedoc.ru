const $ = (id) => document.getElementById(id);
const labels = {running:'Работает',busy:'Выполняет задание',stopped:'Остановлен',starting:'Запускается',degraded:'Требует внимания',missing:'Не настроен',error:'Ошибка запуска'};
const icons = {yue2:'♫',comfy:'◈',studio:'⬡',kimodo:'↝',ollama:'◎',gptoss:'✳',codex:'⌘',giga:'▦',rag:'▤'};
let state = {workers:[],events:[]}, filter = 'all', search = '', signature = '', inFlight = false;
const pending = new Set();
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function draw() {
  const workers = state.workers;
  $('total').textContent=workers.length;
  $('running').textContent=workers.filter(w=>['running','busy'].includes(w.status)).length;
  $('stopped').textContent=workers.filter(w=>w.canStart).length;
  const gpu = state.gpu?.[0];
  $('gpu-name').textContent=gpu?.name || 'Видеокарта · данные недоступны';
  $('gpu-values').textContent=gpu ? `${(gpu.used/1024).toFixed(1)} / ${(gpu.total/1024).toFixed(1)} ГБ VRAM · GPU ${gpu.usage}% · ${gpu.temperature} °C` : 'Не удалось получить показания GPU';
  $('vram').value=gpu ? gpu.used/gpu.total*100 : 0;
  const visible=workers.filter(w=>(filter==='all'||(filter==='active' ? ['running','busy'].includes(w.status):w.canStart))&&`${w.name} ${w.description}`.toLowerCase().includes(search));
  const next=JSON.stringify([visible,[...pending]]);
  if(next!==signature){
    signature=next;
    $('workers').innerHTML=[...new Set(visible.map(w=>w.group))].map(group=>`<h2 class="group-title">${escape(group)}</h2><div class="grid">${visible.filter(w=>w.group===group).map(w=>{
      const starting=pending.has(w.id)||w.status==='starting';
      return `<article class="card" data-worker="${escape(w.id)}"><div class="card-top"><div class="icon" aria-hidden="true">${icons[w.id]||'◈'}</div><span class="badge ${starting?'starting':escape(w.status)}">${starting?'Запускается':labels[w.status]}</span></div><h3>${escape(w.name)}</h3><p class="description">${escape(w.description)}</p><div class="detail">${escape(w.detail)}${w.missing?.length?'<br>'+escape(w.missing.join(' · ')):''}</div><div class="card-meta" title="${escape(w.path)}">${w.pids.length?'PID '+w.pids.join(', ')+' · ':''}${escape(w.task ? 'Windows Task · '+w.task.state : w.path)}</div><div class="card-actions"><button class="launch" data-start="${escape(w.id)}" ${!w.canStart||starting?'disabled':''}>${starting?'Запускается…':w.canStart?'▶ Запустить':['running','busy'].includes(w.status)?'✓ Запущен':'Проверьте журнал'}</button><button class="log-button" data-logs="${escape(w.id)}">Журнал</button>${w.url?`<a class="open-link" href="${escape(w.url)}" target="_blank" rel="noopener" aria-label="Открыть ${escape(w.name)}">Открыть ↗</a>`:''}</div></article>`;
    }).join('')}</div>`).join('')||'<div class="empty">Нет воркеров по выбранному фильтру.</div>';
  }
  $('events').innerHTML=state.events.length ? state.events.map(e=>`<li><time>${escape(e.at)}</time>${escape(e.message)}</li>`).join('') : '<li>Вы ещё не запускали воркеры из центра.</li>';
}
async function refresh(){
  if(inFlight)return;
  inFlight=true;
  try{
    const response=await fetch('/api/status');if(!response.ok)throw Error('Центр недоступен');
    state=await response.json();
    const stale=state.updatedAt && Date.now()-Date.parse(state.updatedAt)>25000;
    $('connection').textContent=state.error?'Ошибка проверки':stale?'Данные устарели':state.loading?'Проверяем сервисы…':`${state.computer} · подключён`;
    if(state.error||stale)$('notice').textContent=state.error||'Не удалось обновить состояние. Кнопки запуска временно отключены.';
    if(state.error||stale)state.workers=state.workers.map(w=>({...w,canStart:false}));
    $('updated').textContent=state.updatedAt?'Проверено в '+new Date(state.updatedAt).toLocaleTimeString('ru-RU'):'Первая проверка…';
    if(!state.loading)draw();
  }catch(error){
    $('connection').textContent='Нет связи с центром';$('notice').textContent='Центр недоступен. Откройте ярлык «Центр воркеров XEDOC» на рабочем столе.';
    document.querySelectorAll('[data-start]').forEach(b=>b.disabled=true);signature='';
  }finally{inFlight=false}
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));draw()}));
$('search').addEventListener('input',event=>{search=event.target.value.toLowerCase();draw()});
$('workers').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.start){
    const id=button.dataset.start;pending.add(id);draw();
    try{
      const response=await fetch(`/api/workers/${id}/start`,{method:'POST',headers:{'X-Center-Token':state.token}});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      $('notice').textContent=result.message;
    }catch(error){$('notice').textContent=error.message}
    finally{pending.delete(id);await refresh();draw()}
  }
  if(button.dataset.logs){
    const id=button.dataset.logs;
    $('log-title').textContent='Журнал · '+state.workers.find(w=>w.id===id).name;
    $('log-text').textContent='Загружаем…';$('logs').showModal();
    try{const r=await fetch(`/api/workers/${id}/logs`);const body=await r.json();$('log-text').textContent=body.text||body.error}catch{$('log-text').textContent='Не удалось загрузить журнал'}
  }
});
$('close-logs').addEventListener('click',()=>$('logs').close());
refresh();setInterval(refresh,5000);
