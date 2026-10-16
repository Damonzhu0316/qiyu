'use strict';
(() => {
  const path=location.pathname,root=document.documentElement,app=document.querySelector('#app');
  if(!['/','/volunteer'].includes(path)&&!path.startsWith('/annotation/'))return;
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role=sessionStorage.getItem('ridechoice.role'),nickname=sessionStorage.getItem('ridechoice.nickname');
  const api=async(url,data)=>{const r=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'操作失败');return j;};
  const frame=(title,subtitle,body)=>{document.body.classList.add('portal-page');document.querySelector('nav').innerHTML=`<span class="portal-greeting">${esc(nickname||'')}</span><button id="portal-logout" class="portal-logout">退出登录</button>`;document.querySelector('.local-tag').innerHTML='<i></i> 志愿者与研究者空间';$('.footer>span').textContent='骑遇 · 骑行街景实验平台';app.innerHTML=`<section class="portal-shell"><div class="portal-topline"><span>RIDECHOICE · V1.2</span><span>本机研究空间</span></div><div class="portal-heading"><div class="eyebrow">${esc(subtitle)}</div><h1>${esc(title)}</h1></div>${body}</section>`;$('#portal-logout').addEventListener('click',async()=>{try{await api('/api/logout',{});}finally{sessionStorage.removeItem('ridechoice.role');sessionStorage.removeItem('ridechoice.nickname');location.replace('/');}});};
  function fail(message){app.innerHTML=`<section class="portal-shell"><div class="notice error">${esc(message)}</div><a class="btn" href="/">返回登录</a></section>`;}
  async function enter(){
    if(!role||!nickname){if(path!=='/')location.replace('/');else login();return;}
    try{const identity=await api('/api/identity');if(identity.role!==role||identity.nickname!==nickname)throw Error('登录身份已失效，请重新登录');}
    catch{sessionStorage.removeItem('ridechoice.role');sessionStorage.removeItem('ridechoice.nickname');if(path==='/')login();else location.replace('/');return;}
    if(path==='/'){location.replace(role==='manager'?'/admin':'/volunteer');return;}
    if(path==='/volunteer'){if(role!=='volunteer'){location.replace('/admin');return;}lobby();return;}
    if(role!=='volunteer'){location.replace('/admin');return;}
    if(path.startsWith('/annotation/')){annotationPage(path.split('/')[2]);return;}
  }
  function login(){
    document.body.classList.add('portal-page','login-page');document.querySelector('nav').innerHTML='';document.querySelector('.local-tag').innerHTML='<i></i> 骑行街景研究平台';$('.footer>span').textContent='骑遇 · 看见风景，也看见选择';
    app.innerHTML=`<section class="login-wrap"><div class="login-art"><div class="login-art-mark">RIDE<br>CHOICE</div><div><span>街景 × 骑行 × 选择</span><h1>把真实街景，<br><em>变成可研究的回答。</em></h1><p>参与者完成选择或打分实验，研究人员集中管理数据与结果。</p></div><div class="login-art-foot">骑遇研究空间 · 本地保存</div></div><form id="login-form" class="login-card"><div class="eyebrow">欢迎进入骑遇</div><h2>选择你的工作空间</h2><label class="field"><span>昵称</span><input name="nickname" maxlength="40" placeholder="例如：小林" autocomplete="nickname" required></label><div class="role-label">选择身份</div><div class="role-options"><label class="role-card"><input type="radio" name="role" value="volunteer" checked><span class="role-icon">↗</span><b>志愿者</b><small>参与选择或打分实验</small></label><label class="role-card"><input type="radio" name="role" value="manager"><span class="role-icon">▦</span><b>管理人员</b><small>发布实验、查看和导出数据</small></label></div><button class="btn login-submit" type="submit">进入工作空间 <span>→</span></button><p class="login-note">管理工作台仅在运行平台的电脑上开放。</p></form></section>`;
    $('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const button=e.currentTarget.querySelector('button');button.disabled=true;try{const data=await api('/api/login',{nickname:String(form.get('nickname')).trim(),role:form.get('role')});sessionStorage.setItem('ridechoice.role',data.role);sessionStorage.setItem('ridechoice.nickname',data.nickname);location.assign(data.role==='manager'?'/admin':'/volunteer');}catch(err){alert(err.message);button.disabled=false;}});
  }
  async function lobby(){
    frame('志愿者实验大厅','VOLUNTEER SPACE',`<p class="portal-lead">你好，${esc(nickname)}。选择一种参与方式，再进入已开放的实验。</p><div class="mode-grid"><button class="mode-card" data-mode="choice"><span class="mode-icon">◫</span><span class="eyebrow">MODE 01</span><b>选择模式</b><small>看街景、读题目，从备选答案中选择最符合的一项。</small><span class="mode-cta">查看选择实验 →</span></button><button class="mode-card" data-mode="rating"><span class="mode-icon">☆</span><span class="eyebrow">MODE 02</span><b>打分模式</b><small>根据题目标准，对每份街景或自采集资料进行评分。</small><span class="mode-cta">查看打分实验 →</span></button></div><div id="task-list" class="task-list"></div>`);
    document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>loadTasks(button.dataset.mode)));
  }
  async function loadTasks(mode){
    const box=$('#task-list');box.innerHTML='<div class="portal-empty">正在查找开放实验…</div>';
    try{const data=await api('/api/volunteer/tasks?mode='+mode);box.innerHTML=`<div class="section-heading"><div><div class="eyebrow">${mode==='choice'?'CHOICE TASKS':'RATING TASKS'}</div><h2>${mode==='choice'?'选择实验':'打分实验'}</h2></div><span class="pill gray">${data.tasks.length} 项开放</span></div>${data.tasks.length?data.tasks.map(t=>`<article class="task-card"><div><div class="task-card-kicker">${t.kind==='route'?'骑行路线对比':`${t.is_demo?'示范练习题库':'街景题库'} · 共 ${t.item_count} 题，每次随机抽 ${t.sample_size||t.item_count} 题`}</div><h3>${esc(t.title)}</h3><p>${esc(t.description||t.prompt||'按题目要求完成实验。')}</p>${t.is_demo?'<small>演示素材与作答，仅用于熟悉流程，不属于正式研究数据。</small>':''}${t.mode==='rating'?`<small>评分范围：${t.score_min}–${t.score_max} 分</small>`:''}</div><button class="btn small" data-enter-task="${esc(t.id)}" data-task-kind="${t.kind}">${t.kind==='route'?'进入实验':'开始作答'} →</button></article>`).join(''):'<div class="portal-empty">目前没有开放的实验。可以稍后再来查看。</div>'}`;box.querySelectorAll('[data-enter-task]').forEach(button=>button.addEventListener('click',()=>{location.assign(button.dataset.taskKind==='route'?'/p/'+encodeURIComponent(button.dataset.enterTask):'/annotation/'+encodeURIComponent(button.dataset.enterTask));}));}
    catch(e){box.innerHTML=`<div class="notice error">${esc(e.message)}</div>`;}
  }
  async function annotationPage(projectId){
    let state=null,elapsed=0;
    const paint=()=>{
      if(state.complete){sessionStorage.removeItem(key);frame('感谢你的认真参与','TASK COMPLETED',`<div class="complete-card"><span class="complete-check">✓</span><h2>本次实验已完成</h2><p>你的回答已保存给管理人员。完成 ${state.done} / ${state.total} 题。</p><a class="btn" href="/volunteer">返回实验大厅</a></div>`);return;}
      const p=state.project,item=state.item;
      const comparison=p.mode==='choice'&&p.selection_type!=='single';
      const comparePrompt={best:'请选择你认为最好的场景',worst:'请选择你认为最差的场景',realistic:'请选择最符合真实骑行的场景'}[p.selection_type]||'请选择一幅场景';
      const task= p.mode==='choice'?(comparison?`<div class="comparison-hint">${comparePrompt}，点击图片作答，答案将自动保存。</div><div class="comparison-grid">${item.candidates.map((candidate,i)=>`<button class="comparison-card" data-choice="${esc(candidate.image)}"><img src="${esc(candidate.image)}" alt="候选场景 ${i+1}"><span>${esc(candidate.name||`场景 ${i+1}`)}</span></button>`).join('')}</div>`:`<div class="annotation-options">${p.options.map(option=>`<button class="annotation-option" data-choice="${esc(option)}">${esc(option)}</button>`).join('')}</div>`):`<div class="score-scale"><div class="scale-labels"><span>${esc(p.score_min_label||p.score_min)}</span><span>${esc(p.score_max_label||p.score_max)}</span></div><div class="score-options">${Array.from({length:p.score_max-p.score_min+1},(_,i)=>p.score_min+i).map(n=>`<button class="score-option" data-score="${n}">${n}</button>`).join('')}</div></div>`;
      frame(p.mode==='choice'?'选择模式':'打分模式',p.mode==='choice'?'IMAGE CHOICE':'IMAGE RATING',`<div class="annotation-progress"><span>${esc(p.title)}</span><span>第 ${state.done+1} / ${state.total} 题</span></div><progress value="${state.done}" max="${state.total}"></progress><div class="annotation-instruction">${esc(p.description||'请按题目要求完成回答。')}</div><article class="annotation-question"><div class="annotation-image"><img src="${esc(item.image)}" alt="${esc(item.name)}"><span>${esc(item.name)}</span></div><div class="annotation-answer"><div class="eyebrow">QUESTION ${String(state.done+1).padStart(2,'0')}</div><h2>${esc(item.prompt||p.prompt)}</h2><p class="annotation-metadata">${esc([item.metadata.location,item.metadata.captured,item.metadata.heading].filter(Boolean).join(' · '))}</p>${task}<label class="field"><span>补充说明（选填）</span><textarea id="annotation-note" maxlength="500" rows="3" placeholder="记录判断依据"></textarea></label></div></article><div class="annotation-footer"><a class="text-btn" href="/volunteer">暂时退出</a><span>每题提交后自动保存，可返回继续</span></div>`);
      document.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',()=>saveAnswer({choice:button.dataset.choice})));
      document.querySelectorAll('[data-score]').forEach(button=>button.addEventListener('click',()=>saveAnswer({score:Number(button.dataset.score)})));
    };
    async function saveAnswer(value){const note=$('#annotation-note')?.value||'';document.querySelectorAll('.annotation-option,.score-option,.comparison-card').forEach(x=>x.disabled=true);try{state=await api(`/api/annotation/sessions/${state.session_id}/answer`,{item_id:state.item.id,...value,note});paint();}catch(e){fail(e.message);}}
    const key='ridechoice.annotation.'+encodeURIComponent(nickname)+'.'+projectId;
    try{
      const saved=sessionStorage.getItem(key);
      if(saved){state=await api('/api/annotation/sessions/'+saved);paint();return;}
      const project=await api('/api/volunteer/projects/'+projectId);
      frame(project.mode==='choice'?'选择模式':'打分模式','BEFORE YOU START',`<div class="annotation-intro-card"><span class="pill ${project.mode==='rating'?'gray':'success'}">${project.mode==='rating'?'打分实验':project.selection_type==='single'?'单图选择':'多图比较 · '+({best:'选最佳',worst:'选最差',realistic:'选最符合真实骑行'}[project.selection_type]||'')}</span>${project.is_demo?'<span class="pill gray">演示数据</span>':''}<h2>${esc(project.title)}</h2><p>${esc(project.description||'')}</p><div class="annotation-instruction"><b>每题任务</b><br>${esc(project.prompt)}<br><small>题库共 ${project.item_count} 道题，本次随机抽取 ${project.sample_size||project.item_count} 题 · 每题提交后自动保存；中途退出可继续本次题目</small></div><div class="consent-copy">${esc(project.consent)}</div><label class="checkbox annotation-consent"><input type="checkbox" id="annotation-consent-check"><span>我已阅读参与说明，自愿参加本次实验</span></label><button class="btn" id="annotation-begin" disabled>开始作答 <span>→</span></button><p class="small-text">昵称：${esc(nickname)} · 完成后再次进入会重新抽题</p></div>`);
      $('#annotation-consent-check').addEventListener('change',e=>$('#annotation-begin').disabled=!e.target.checked);
      $('#annotation-begin').addEventListener('click',async e=>{e.currentTarget.disabled=true;try{state=await api('/api/annotation/sessions',{project_id:projectId,consent:true});sessionStorage.setItem(key,state.session_id);paint();}catch(error){fail(error.message);}});
    }catch(e){fail(e.message);}
  }
  enter();
})();
