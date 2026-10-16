/* 骑遇骑行街景选择实验与偏好分析平台 V1.2 — research workspace. */
'use strict';

if(location.pathname==='/admin')(() => {
  const routes=[['overview','实验概览'],['library','街景素材'],['designer','设计助手'],['design','题目编辑'],['publish','发布投放'],['annotations','数据实验'],['quality','质量审查'],['results','结果分析'],['audit','操作日志']];
  let library=[],libraryQuery='',libraryFilter='active',activeAsset=null,qualityData=null,analysisData=null;
  let annotationAssets=[],annotationProjects=[],annotationSelected=new Set(),annotationQuery='',annotationMode='choice';
  let designPreview=null,designFor=null,pendingDesign=null,renderTicket=0;
  const specs=new Map();
  const names={pending:'待审查',include:'保留',exclude:'排除'};
  const section=()=>$('#admin-content');
  const errorBox=error=>`<div class="notice error">${esc(error.message)}</div>`;
  const labelInput=(label,key,value='',extra='')=>`<label class="field ${extra}"><span>${label}</span><input data-asset-field="${key}" value="${esc(value)}"></label>`;
  const seconds=value=>value===null||value===undefined?'—':(value/1000).toFixed(2)+' 秒';
  const imageName=path=>library.find(a=>a.image===path)?.name||path;

  document.querySelector('.local-tag').innerHTML='<i></i> V1.2 · 管理人员工作台';
  $('.footer>span').textContent='骑遇 · 骑行街景选择实验与偏好分析平台 V1.2';
  const roleNav=$('nav');roleNav.innerHTML='<span class="portal-greeting">管理人员</span><button id="manager-logout" class="portal-logout">退出登录</button>';
  $('#manager-logout').addEventListener('click',async()=>{try{await api('/api/logout',{});}finally{sessionStorage.removeItem('ridechoice.role');sessionStorage.removeItem('ridechoice.nickname');location.assign('/');}});

  function ensureDialog(id){
    let dialog=document.getElementById(id);
    if(!dialog){dialog=document.createElement('dialog');dialog.id=id;dialog.className='research-dialog';document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});}
    return dialog;
  }

  const originalRender=renderAdmin;
  renderAdmin=function(){
    originalRender();
    if(!isAdmin)return;
    const ticket=++renderTicket;
    const tabs=$('.workspace-tabs');
    tabs.innerHTML=routes.map(([key,label],index)=>`<button class="tab ${tab===key?'active':''}" role="tab" aria-selected="${tab===key}" data-action="tab" data-tab="${key}"><span>${String(index+1).padStart(2,'0')}</span>${label}</button>`).join('');
    $('.workspace-header p').textContent='科研工作台 · 素材、实验设计、投放、审查与偏好分析';
    if(tab==='overview'){
      section().insertAdjacentHTML('beforeend',`<section class="panel research-path"><div class="section-heading"><h3>管理工作流</h3><span class="pill success">V1.2 志愿者分流与数据标注</span></div><div class="research-path-grid">${[['library','▧','素材资产','批量导入、标签与来源记录'],['annotations','◫','数据实验','发布选择题或打分题，回收逐图标注'],['designer','◇','路线设计','街景路线比较、属性组合与题组'],['quality','☷','质量审查','逐条核查并保留排除依据'],['results','↗','结果分析','查看分群、选择分布和实验报告'],['audit','↻','操作留痕','记录发布、素材维护与审查操作']].map(([key,icon,title,desc])=>`<button data-action="tab" data-tab="${key}"><span>${icon}</span><b>${title}</b><small>${desc}</small></button>`).join('')}</div></section>`);
    }
    if(tab==='annotations')renderAnnotationManager(ticket);
    if(tab==='design')extendEditor();
    if(tab==='library')renderLibrary(ticket).catch(e=>{if(ticket===renderTicket)section().innerHTML=errorBox(e);});
    if(tab==='designer')renderDesigner(ticket).catch(e=>{if(ticket===renderTicket)section().innerHTML=errorBox(e);});
    if(tab==='quality')renderQuality(ticket).catch(e=>{if(ticket===renderTicket)section().innerHTML=errorBox(e);});
    if(tab==='audit')renderAudit(ticket).catch(e=>{if(ticket===renderTicket)section().innerHTML=errorBox(e);});
    if(tab==='publish'){
      const n=config.block_count||1;
      section().insertAdjacentHTML('afterbegin',`<div class="notice group-banner">题组投放：${n} 组。新作答按组轮流分配，预览与正式参与分别计数；同一作答刷新后保持原题组。分组减少单人任务量，不保证参与人群随机或统计代表性。</div>`);
    }
  };

  function extendEditor(){
    const n=config.block_count||1;
    $('.settings-box').insertAdjacentHTML('beforeend',`<div class="block-settings"><h3>题组与投放</h3><label class="field"><span>题组数量（1–10）</span><input type="number" id="block-count" min="1" max="10" value="${n}"></label><button class="btn secondary small" data-action="ext-distribute">按题目顺序轮流分组</button><p class="small-text">每组至少一题。修改后保存并发布，旧版本继续保持原设计。</p></div>`);
    for(const [index,element]of Array.from(document.querySelectorAll('.question-editor')).entries()){
      const q=config.questions[index];
      $('.qe-prompt',element).insertAdjacentHTML('beforeend',`<label class="field"><span>所属题组</span><input type="number" min="1" max="${n}" data-path="questions.${index}.block" value="${q.block||1}"></label><label class="field"><span>骑行情境标签</span><input data-path="questions.${index}.theme" value="${esc(q.theme||'日常骑行')}"></label>`);
      for(const key of ['a','b']){
        $(`#upload-${index}-${key}`).insertAdjacentHTML('beforeend',`<button class="asset-use-editor" data-action="ext-pick-library" data-target="${index}.${key}">从素材库选择</button>`);
      }
    }
  }

  async function getLibrary(){library=(await api('/api/admin/research/assets')).assets;return library;}
  function assetOptions(selected='',includeBlank=false){return `${includeBlank?'<option value="">请选择街景</option>':''}${library.filter(a=>!a.archived).map(a=>`<option value="${esc(a.image)}" ${a.image===selected?'selected':''}>${a.demo?'[演示] ':''}${esc(a.name)}${a.location?' · '+esc(a.location):''}</option>`).join('')}`;}
  function filteredAssets(){return library.filter(a=>{
    if(libraryFilter==='active'&&a.archived)return false;
    if(libraryFilter==='formal'&&(a.archived||a.demo))return false;
    if(libraryFilter==='demo'&&(!a.demo||a.archived))return false;
    if(libraryFilter==='archived'&&!a.archived)return false;
    return !libraryQuery||[a.name,a.source,a.location,a.note,...a.tags].join(' ').toLowerCase().includes(libraryQuery.toLowerCase());
  });}
  function libraryCards(){
    const rows=filteredAssets();
    return rows.length?rows.map(a=>`<article class="asset-card"><div class="asset-preview"><img src="${esc(a.image)}" alt="${esc(a.name)}" loading="lazy"><button class="zoom-btn" data-action="zoom" data-image="${esc(a.image)}">查看原图</button></div><div class="asset-body"><div class="section-heading"><h3>${esc(a.name)}</h3><span class="pill ${a.demo?'demo':a.archived?'gray':'success'}">${a.demo?'演示':a.archived?'已归档':'研究素材'}</span></div><p>${esc(a.location||'地点待补全')} · ${esc(a.captured||'日期待补全')}</p><div class="asset-tags">${a.tags.map(t=>`<span>${esc(t)}</span>`).join('')||'<span>未添加标签</span>'}</div><p class="asset-source">${esc(a.source||'来源及使用依据待记录')}</p><div class="asset-card-foot"><span class="small-text">草稿引用 ${a.uses_in_drafts} 次</span><span class="spacer"></span><button class="text-btn" data-action="ext-edit-asset" data-image="${esc(a.image)}">资料</button><button class="text-btn" data-action="ext-use-asset" data-image="${esc(a.image)}" ${a.archived?'disabled':''}>使用 →</button></div></div></article>`).join(''):'<div class="panel empty">没有符合筛选条件的素材。可以导入图片或调整筛选。</div>';
  }
  async function renderLibrary(ticket){
    section().innerHTML='<div class="empty">正在读取街景素材…</div>';
    await getLibrary();if(ticket!==renderTicket)return;
    section().innerHTML=`<div class="section-heading"><div><h2>街景素材库</h2><p class="small-text">图片独立保存，来源与标签统一管理。</p></div><div class="button-row"><button class="btn secondary small" data-action="ext-export-assets">素材清单 CSV ↓</button><label class="btn small file-btn">＋ 批量导入街景<input id="library-upload" type="file" multiple accept="image/jpeg,image/png,image/webp"></label></div></div><div class="library-toolbar"><input class="plain-input" id="asset-search" aria-label="搜索素材" placeholder="搜索名称、地点、标签或来源" value="${esc(libraryQuery)}"><select class="plain-input" id="asset-filter" aria-label="素材类型">${[['active','未归档素材'],['formal','研究素材'],['demo','演示素材'],['archived','已归档素材']].map(([v,label])=>`<option value="${v}" ${libraryFilter===v?'selected':''}>${label}</option>`).join('')}</select><span class="small-text">${library.length} 张已登记 · ${library.filter(a=>!a.demo&&!a.archived).length} 张研究素材</span></div><div class="notice">编辑资料不会改写已发布的题目快照。归档仅从日常选择中隐藏，已发布题目仍可正常显示。演示照片与研究素材分别标记。</div><div class="asset-grid" id="asset-grid">${libraryCards()}</div>`;
  }

  function editAsset(image){
    activeAsset=library.find(a=>a.image===image);if(!activeAsset)return;
    const a=activeAsset,dialog=ensureDialog('asset-editor-dialog');
    dialog.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">SCENE ASSET</div><h2>街景素材资料</h2><div class="asset-edit-layout"><img src="${esc(a.image)}" alt="素材原图"><div class="form-grid">${labelInput('素材名称','name',a.name,'wide')}${labelInput('地点 / 路段','location',a.location,'wide')}${labelInput('拍摄日期','captured',a.captured)}${labelInput('方向 / 视角','heading',a.heading)}${labelInput('图片来源及使用依据','source',a.source,'wide')}${labelInput('标签（用逗号分隔）','tags',a.tags.join('，'),'wide')}<label class="field wide"><span>研究备注</span><textarea data-asset-field="note" rows="3">${esc(a.note)}</textarea></label></div></div><div class="dialog-action-row"><button class="btn secondary" data-action="ext-archive-asset" data-image="${esc(a.image)}" data-archive="${!a.archived}">${a.archived?'恢复到素材库':'归档素材'}</button><button class="btn" data-action="ext-save-asset">保存资料</button></div>`;
    dialog.showModal();
  }

  async function openAssetPicker(target=null,image=null){
    await getLibrary();const dialog=ensureDialog('asset-picker-dialog');
    dialog.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">REUSE A SCENE</div><h2>将素材用于题目</h2><div class="form-grid"><label class="field wide"><span>选择街景</span><select id="picker-image">${assetOptions(image||'')}</select></label><label class="field wide"><span>放入当前草稿的位置</span><select id="picker-target">${config.questions.flatMap((q,i)=>['a','b'].map(k=>`<option value="${i}.${k}" ${target===`${i}.${k}`?'selected':''}>第 ${i+1} 题 · 原始路线 ${k.toUpperCase()}</option>`)).join('')}</select></label></div><div class="notice">会将图片及其来源、地点、日期和方向复制到草稿。时间、信号灯和道路条件保留原设置；已发布版本保持不变。</div><div class="dialog-action-row"><button class="btn" data-action="ext-confirm-asset">使用这张街景 →</button></div>`;
    dialog.showModal();
  }

  function defaultSpec(){const live=library.filter(a=>!a.archived);return {pairs:[{a:live[0]?.image||'',b:live[1]?.image||''}],base_times:[15,20],extras:[0,3,5],stops:[0,1],count:12,blocks:2,seed:'ridechoice-design-1',theme:'日常骑行'};}
  function specFromForm(){
    const spec={pairs:Array.from(section().querySelectorAll('.design-pair')).map(el=>({a:$('[data-pair="a"]',el).value,b:$('[data-pair="b"]',el).value}))};
    for(const key of ['base_times','extras','stops'])spec[key]=$(`#level-${key}`).value.split(/[,，、\s]+/).filter(Boolean).map(Number);
    for(const key of ['count','blocks'])spec[key]=Number($(`#level-${key}`).value);
    spec.seed=$('#level-seed').value;spec.theme=$('#level-theme').value;
    specs.set(selectedId,spec);return spec;
  }
  function pairRows(spec){return spec.pairs.map((pair,i)=>`<div class="design-pair"><span class="pair-index">${i+1}</span><label class="field"><span>原始路线 A 街景</span><select data-pair="a">${assetOptions(pair.a,true)}</select></label><span class="pair-versus">↔</span><label class="field"><span>原始路线 B 街景</span><select data-pair="b">${assetOptions(pair.b,true)}</select></label><button class="text-btn" data-action="ext-remove-pair" data-index="${i}" ${spec.pairs.length===1?'disabled':''}>移除</button></div>`).join('');}

  async function renderDesigner(ticket){
    section().innerHTML='<div class="empty">正在准备实验设计工具…</div>';
    await getLibrary();if(ticket!==renderTicket)return;
    const spec=specs.get(selectedId)||config.design_spec||defaultSpec();specs.set(selectedId,clone(spec));
    if(designFor!==selectedId){designPreview=null;designFor=selectedId;}
    section().innerHTML=`<div class="section-heading"><div><h2>题组设计助手</h2><p class="small-text">定义属性水平，预览候选组合，再决定是否写入草稿。</p></div><button class="btn secondary small" data-action="ext-check-design">检查当前草稿</button></div><div class="notice warm">本工具用属性水平全组合形成候选库，再按固定种子不放回抽样。它不自动生成正交或D高效设计，也不证明实验效度。B路线默认增加额外时间；需要平衡图片与时间的关系时，可增加反向配对或手工编辑。</div><section class="panel"><div class="section-heading"><h3>1．选择街景配对</h3><button class="btn secondary small" data-action="ext-add-pair">＋ 增加配对</button></div><div id="design-pairs">${pairRows(spec)}</div></section><div class="designer-grid"><section class="panel"><h3>2．定义属性水平</h3><div class="form-grid"><label class="field"><span>A基础时间 / 分钟</span><input id="level-base_times" value="${esc(spec.base_times.join(', '))}"><small>多个数值用逗号分隔</small></label><label class="field"><span>B额外时间 / 分钟</span><input id="level-extras" value="${esc(spec.extras.join(', '))}"><small>B时间 = A基础时间 + 额外时间</small></label><label class="field"><span>A、B各自的信号灯水平</span><input id="level-stops" value="${esc(spec.stops.join(', '))}"></label><label class="field"><span>骑行情境标签</span><select id="level-theme">${['日常骑行','通勤通学','休闲游览','运动锻炼','亲子陪伴'].map(x=>`<option ${x===spec.theme?'selected':''}>${x}</option>`).join('')}</select></label></div></section><section class="panel"><h3>3．抽样与分组</h3><div class="form-grid"><label class="field"><span>生成题数（最多100）</span><input id="level-count" type="number" min="1" max="100" value="${spec.count}"></label><label class="field"><span>投放题组（最多10）</span><input id="level-blocks" type="number" min="1" max="10" value="${spec.blocks}"></label><label class="field wide"><span>固定随机种子</span><input id="level-seed" maxlength="100" value="${esc(spec.seed)}"></label></div><div class="button-row"><button class="btn" data-action="ext-preview-design">生成预览 →</button><button class="btn secondary" data-action="ext-apply-design" ${designPreview?'':'disabled'}>应用到草稿</button></div></section></div><div id="design-output">${designPreview?previewDesignHtml(designPreview):'<div class="panel empty">先生成预览，查看题数、分组、属性分布和设计提示。</div>'}</div>`;
  }
  function diagnosticHtml(d){
    return `<div class="diagnostics"><h3>设计检查提示</h3>${d.warnings.length?`<ul>${d.warnings.slice(0,30).map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'<p class="small-text">未发现当前规则覆盖的相同图片、重复组合或时间/信号灯提示。仍需研究者核对。</p>'}<p class="small-text">${esc(d.note)}</p><div class="level-distributions">${[['a_time','A时间'],['b_time','B时间'],['difference','时间差']].map(([key,label])=>`<div><b>${label}水平分布</b><div>${d.levels[key].map(x=>`<span class="pill gray">${x.value}分钟 × ${x.count}</span>`).join(' ')}</div></div>`).join('')}</div></div>`;
  }
  function previewDesignHtml(data){return `<section class="panel"><div class="section-heading"><h3>设计预览</h3><button class="text-btn" data-action="ext-export-design">保存预览 JSON ↓</button></div><div class="design-summary"><div><b>${data.summary.candidates}</b><span>候选组合</span></div><div><b>${data.summary.selected}</b><span>抽取题目</span></div><div><b>${Object.keys(data.summary.block_sizes).length}</b><span>投放题组</span></div></div><p class="small-text">${esc(data.summary.method)}。题组大小：${Object.entries(data.summary.block_sizes).map(([k,v])=>`第${k}组 ${v}题`).join('，')}。</p><div class="table-wrap"><table><thead><tr><th>题目</th><th>题组</th><th>A时间</th><th>B时间</th><th>A信号灯</th><th>B信号灯</th></tr></thead><tbody>${data.config.questions.map((q,i)=>`<tr><td>${i+1}</td><td>${q.block}</td><td>${q.a.time}</td><td>${q.b.time}</td><td>${q.a.stops}</td><td>${q.b.stops}</td></tr>`).join('')}</tbody></table></div>${diagnosticHtml(data.diagnostics)}</section>`;}

  function versionSelect(e,value,id){return `<label class="field"><span>实验版本</span><select id="${id}">${e.versions.map(v=>`<option value="${esc(v.code)}" ${v.code===value?'selected':''}>版本 ${v.number} · ${v.demo?'演示':'正式'}</option>`).join('')}</select></label>`;}
  async function renderQuality(ticket,threshold=1500){
    const e=currentExperiment();
    if(!e.versions.length){section().innerHTML='<section class="panel empty"><h3>还没有发布版本</h3><p>发布并收集回答后，可以在这里逐条审查。</p><button class="btn secondary small" data-action="tab" data-tab="publish">前往发布 →</button></section>';return;}
    if(!e.versions.some(v=>v.code===resultCode))resultCode=e.versions[0].code;
    section().innerHTML='<div class="empty">正在读取审查数据…</div>';
    const data=await api(`/api/admin/research/versions/${resultCode}/quality?fast_ms=${threshold}`);if(ticket!==renderTicket)return;
    qualityData=data;
    section().innerHTML=`<div class="result-controls">${versionSelect(e,resultCode,'quality-version')}<div class="button-row"><button class="btn secondary small" data-action="ext-refresh-quality">刷新记录 ↻</button><button class="btn small" data-action="ext-export-sessions">完整参与记录 CSV ↓</button></div></div><div class="notice">提示用于人工核查，不自动排除任何记录。待审记录暂计入结果；“保留”不代表已验证有效，“排除”须记录原因且可以恢复。预览记录始终不进入结果汇总。</div><div class="metric-grid"><div class="metric"><label>全部记录（含预览）</label><strong>${data.sessions.length}</strong><small>可核查零回答记录</small></div><div class="metric"><label>待审查</label><strong>${data.counts.pending||0}</strong><small>暂时计入完成数据汇总</small></div><div class="metric"><label>人工保留</label><strong>${data.counts.include||0}</strong><small>保留审查说明</small></div><div class="metric"><label>人工排除</label><strong>${data.counts.exclude||0}</strong><small>保留原始回答</small></div></div><section class="panel"><div class="quality-toolbar"><label class="field"><span>快速作答参考时长 / 毫秒</span><input id="quality-threshold" type="number" min="0" max="60000" value="${data.fast_ms}"></label><button class="btn secondary small" data-action="ext-update-threshold">更新提示</button><label class="checkbox"><input type="checkbox" id="quality-only-flags">只看存在提示的记录</label></div><div class="table-wrap"><table><thead><tr><th>记录 / 题组</th><th>进度</th><th>服务器耗时</th><th>页面切换</th><th>核查提示</th><th>审查状态</th><th>操作</th></tr></thead><tbody id="quality-rows">${qualityRows(data.sessions)}</tbody></table></div><p class="results-note">服务器耗时包括停留和刷新间隔，浏览器可见时长与切换次数由客户端报告。全部同侧、编号重复等情况并不直接证明无效，需结合研究方案核实。</p></section>`;
  }
  function qualityRows(rows){return rows.map(s=>`<tr><td><b>${esc(s.id.slice(0,8))}</b><br><small>${esc(s.profile.purpose)} · 题组${s.block_index}${s.preview?' · 预览':''}</small></td><td>${s.answered}/${s.total}<br><small>${s.finished?'已完成':'未完成'}</small></td><td>最短 ${seconds(s.min_ms)}<br><small>中位 ${seconds(s.median_ms)}</small></td><td>${s.hidden_count} 次<br><small>可见均值 ${seconds(s.mean_visible_ms)}</small></td><td class="quality-flags">${s.flags.map(f=>`<span>${esc(f)}</span>`).join('')||'<span class="muted">暂无规则提示</span>'}</td><td><span class="pill ${s.review_status==='exclude'?'demo':s.review_status==='include'?'success':'gray'}">${names[s.review_status]}</span><br><small>${esc(s.review_note.slice(0,30))}</small></td><td><button class="btn secondary small" data-action="ext-review" data-id="${esc(s.id)}">审查</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无作答记录。</td></tr>';}
  function reviewDialog(id){const s=qualityData.sessions.find(s=>s.id===id);if(!s)return;const dialog=ensureDialog('review-dialog');dialog.dataset.id=id;dialog.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">RESPONSE REVIEW</div><h2>审查记录 ${esc(id.slice(0,8))}</h2><p class="small-text">题组${s.block_index} · ${s.answered}/${s.total}题 · ${esc(s.profile.frequency)} · ${esc(s.profile.purpose)}</p><div class="notice warm">${esc(s.flags.join('；')||'当前规则没有提示，仍可按研究方案记录审查意见。')}</div><label class="field"><span>审查状态</span><select id="review-status">${Object.entries(names).map(([value,label])=>`<option value="${value}" ${s.review_status===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>依据与备注（排除时必填）</span><textarea id="review-note" maxlength="1000" rows="5">${esc(s.review_note)}</textarea></label><div class="dialog-action-row"><button class="btn" data-action="ext-save-review">保存审查意见</button></div>`;dialog.showModal();}

  const baseResults=renderResults;
  renderResults=async function(){
    await baseResults();if(tab!=='results'||!currentExperiment().versions.length)return;
    const requested=resultCode;const data=await api(`/api/admin/research/versions/${requested}/analysis`);if(tab!=='results'||requested!==resultCode)return;
    analysisData=data;
    const controls=$('.result-controls .button-row');
    controls?.insertAdjacentHTML('beforeend','<button class="btn small" data-action="ext-report">实验报告 HTML ↓</button>');
    section().insertAdjacentHTML('beforeend',analysisHtml(data));
  };
  function groupTable(rows){return `<div class="table-wrap"><table><thead><tr><th>分组</th><th>完成记录</th><th>回答数</th><th>选较长</th><th>选较短</th><th>等时选择</th><th>都不选</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.sessions}</td><td>${r.answers}</td><td>${r.longer}</td><td>${r.shorter}</td><td>${r.equal}</td><td>${r.neither}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">当前汇总口径下没有完成回答。</td></tr>'}</tbody></table></div>`;}
  function analysisHtml(data){return `<section class="panel analysis-panel"><div class="section-heading"><h3>质量审查后的汇总口径</h3><button class="text-btn" data-action="tab" data-tab="quality">前往审查 →</button></div><div class="analysis-counts"><span>计入完成记录 <b>${data.eligible_sessions}</b></span><span>人工排除记录 <b>${data.excluded_sessions}</b></span><span>计入回答数 <b>${data.answers}</b></span></div><p class="small-text">${esc(data.rule)}</p></section><section class="panel"><div class="section-heading"><h3>分群选择分析</h3><select class="plain-input compact-select" id="analysis-dimension"><option value="frequency">按骑行频率</option><option value="purpose">按骑行目的</option><option value="experience">按骑行经验</option></select></div><div id="group-analysis">${groupTable(data.groups.frequency)}</div><p class="results-note">同一作答可贡献多道选择，回答数不是独立样本数。此处比较实际计数，未进行显著性检验或模型估计。</p></section><section class="panel"><h3>额外时间条件与实际选择</h3><div class="table-wrap"><table><thead><tr><th>两路线时间差</th><th>回答数</th><th>选较长</th><th>选较短</th><th>等时选择</th><th>都不选</th></tr></thead><tbody>${data.time_tradeoffs.map(r=>`<tr><td>${r.extra_minutes} 分钟</td><td>${r.answers}</td><td>${r.longer}</td><td>${r.shorter}</td><td>${r.equal}</td><td>${r.neither}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">暂无计入回答。</td></tr>'}</tbody></table></div><p class="results-note">各时间差对应的图片与其他条件可能不同，这些计数不能直接当作意愿阈值或时间的因果效应。</p></section><section class="panel"><div class="section-heading"><h3>题组投放情况</h3><button class="text-btn" data-action="ext-report">保存可打印报告 ↓</button></div><div class="table-wrap"><table><thead><tr><th>题组</th><th>题目数</th><th>开始记录</th><th>完成记录</th><th>计入完成记录</th></tr></thead><tbody>${data.blocks.map(r=>`<tr><td>第${r.block}组</td><td>${r.questions}</td><td>${r.started}</td><td>${r.completed}</td><td>${r.eligible}</td></tr>`).join('')}</tbody></table></div><p class="results-note">报告为独立HTML文件，包含题目、审查口径、分群结果、素材来源和配置哈希。下载后用浏览器打开，按 Ctrl+P 可打印或保存PDF。</p></section>`;}

  async function renderAnnotationManager(ticket){
    section().innerHTML='<div class="empty">正在读取数据实验与素材…</div>';
    try{
      const [projectData,assetData]=await Promise.all([api('/api/admin/annotations'),api('/api/admin/research/assets')]);
      if(ticket!==renderTicket)return;annotationProjects=projectData.projects;annotationAssets=assetData.assets.filter(a=>!a.archived&&!a.demo);
      const projects=annotationProjects.map(p=>`<article class="annotation-project-row"><div><div class="badge-row"><span class="pill ${p.mode==='rating'?'gray':'success'}">${p.mode==='rating'?'打分模式':'选择模式'}</span><span class="pill ${p.status?'success':'gray'}">${p.status?'开放中':'已暂停'}</span>${p.is_demo?'<span class="pill gray">演示题库</span>':''}</div><h3>${esc(p.title)}</h3><p>${esc(p.description||p.prompt)}</p><small>题库 ${p.items} 份素材 · 每人随机抽 ${p.sample_size||p.items} 题 · ${p.volunteers} 个昵称 · ${p.sessions} 份作答 · ${p.answers} 条回答${p.is_demo?' · 演示记录':''}</small></div><div class="button-row"><button class="btn secondary small" data-action="ext-annotation-view" data-id="${p.id}" data-page="1">查看数据</button><button class="btn secondary small" data-action="ext-annotation-export" data-id="${p.id}">导出 CSV</button><button class="text-btn" data-action="ext-annotation-status" data-id="${p.id}" data-published="${!p.status}">${p.status?'暂停':'重新开放'}</button></div></article>`).join('');
      section().innerHTML=`<div class="section-heading"><div><h2>数据实验</h2><p class="small-text">将素材库中的街景或自采集图片组成题库。每位参与者可随机抽取一套题，题目顺序与抽取结果会保存，管理人员可查看并导出。</p></div><span class="pill success">${annotationProjects.length} 个项目</span></div><div class="annotation-admin-grid"><section class="panel annotation-form-panel"><div class="eyebrow">CREATE A DATA STUDY</div><h3>发布一个数据实验</h3><p class="small-text">先在“街景素材”批量导入文件，再选素材组成题库；系统内置4个示范题库可直接体验抽题流程。</p><label class="field"><span>实验名称</span><input id="annotation-title" maxlength="100" placeholder="例如：街景骑行环境识别"></label><label class="field"><span>实验说明</span><textarea id="annotation-description" rows="2" maxlength="1000" placeholder="告诉志愿者观察什么"></textarea></label><label class="field"><span>每份素材的问题</span><textarea id="annotation-prompt" rows="2" maxlength="500" placeholder="例如：画面中是否有独立自行车道？"></textarea></label><label class="field"><span>参与说明与同意文字</span><textarea id="annotation-consent" rows="3" maxlength="2000">我已阅读实验说明，理解参与完全自愿，并同意匿名记录我的回答。</textarea></label><label class="field"><span>志愿者回答方式</span><select id="annotation-mode"><option value="choice">选择模式</option><option value="rating">打分模式</option></select></label><label class="field"><span>每位参与者随机抽取</span><input type="number" id="annotation-sample-size" value="3" min="1" max="5000"><small>须小于或等于下方选择的题库素材数。每位参与者新开一轮会重新抽题。</small></label><div id="annotation-choice-fields"><label class="field"><span>答案选项（每行一个，2–20项）</span><textarea id="annotation-options" rows="4">有&#10;否&#10;不确定</textarea></label></div><div id="annotation-rating-fields" class="hidden"><div class="form-grid"><label class="field"><span>最低分</span><input type="number" id="annotation-score-min" value="1" min="0" max="99"></label><label class="field"><span>最高分</span><input type="number" id="annotation-score-max" value="5" min="1" max="100"></label><label class="field"><span>最低分含义</span><input id="annotation-min-label" maxlength="80" placeholder="非常差"></label><label class="field"><span>最高分含义</span><input id="annotation-max-label" maxlength="80" placeholder="非常好"></label></div></div><div class="asset-select-head"><label class="field"><span>筛选研究素材</span><input id="annotation-asset-search" placeholder="按名称、地点或标签搜索"></label><button class="btn secondary small" data-action="ext-annotation-select-filter">全选筛选结果</button></div><div class="asset-select-summary"><span id="annotation-selected-count">已选 0 份</span><span id="annotation-visible-count"></span></div><div id="annotation-asset-list" class="annotation-asset-list"></div><div class="notice warm">图片会固定在实验题库中；志愿者每次开始时随机抽题，作答中断后沿用原题单。请核对正式研究素材的来源和使用依据。</div><button class="btn annotation-publish" data-action="ext-annotation-create">保存并开放实验 →</button></section><section class="panel annotation-project-list"><div class="section-heading"><div><div class="eyebrow">PUBLISHED DATA TASKS</div><h3>已创建的数据实验</h3></div><button class="text-btn" data-action="ext-annotation-refresh">刷新 ↻</button></div>${projects||'<div class="portal-empty">还没有数据实验。选好素材和回答方式后即可发布。</div>'}</section></div>`;
      const choiceFields=$('#annotation-choice-fields');
      choiceFields.insertAdjacentHTML('afterbegin',`<label class="field"><span>选择题形式</span><select id="annotation-selection-type"><option value="single">单图识别 / 文字选项</option><option value="best">多图比较：选最好的场景</option><option value="worst">多图比较：选最差的场景</option><option value="realistic">多图比较：选最符合真实骑行的场景</option></select></label><label class="field hidden" id="annotation-images-per-question-wrap"><span>每题比较图片数</span><select id="annotation-images-per-question"><option value="2">2 张图片</option><option value="3" selected>3 张图片</option><option value="4">4 张图片</option><option value="5">5 张图片</option><option value="6">6 张图片</option></select><small>选中的图片会随机分组成多图比较题，不足一组的余数会留在素材库但不进入本题库。</small></label>`);
      section().querySelectorAll('.annotation-project-row').forEach((row,index)=>{
        const project=annotationProjects[index];if(!project)return;
        const label={single:'单图题',best:'多图选最佳',worst:'多图选最差',realistic:'多图选真实骑行'}[project.selection_type||'single'];
        if(project.mode==='choice')row.querySelector('.badge-row')?.insertAdjacentHTML('beforeend',`<span class="pill gray">${label}</span>`);
        const count=row.querySelector('small');if(count)count.textContent=`题库 ${project.items} 道题 · 每人随机抽 ${project.sample_size||project.items} 题 · ${project.volunteers} 个昵称 · ${project.sessions} 份作答 · ${project.answers} 条回答${project.is_demo?' · 演示记录':''}`;
      });
      const intro=section().querySelector('.annotation-form-panel>p.small-text');if(intro)intro.textContent='先在“街景素材”批量导入图片，再选素材组成题库；内置8个演示题库，包含单图识别、多图比较和多种骑行感受评分。';
      renderAnnotationAssets();
    }catch(error){section().innerHTML=errorBox(error);}
  }
  function renderAnnotationAssets(){
    const query=annotationQuery.toLowerCase(),assets=annotationAssets.filter(a=>!query||[a.name,a.location,a.source,...a.tags].join(' ').toLowerCase().includes(query));
    const list=$('#annotation-asset-list');if(!list)return;
    list.innerHTML=assets.slice(0,100).map(a=>`<label class="annotation-asset ${annotationSelected.has(a.image)?'selected':''}"><input type="checkbox" data-annotation-asset="${esc(a.image)}" ${annotationSelected.has(a.image)?'checked':''}><img src="${esc(a.image)}" alt="" loading="lazy"><span><b>${esc(a.name)}</b><small>${esc(a.location||a.source||'来源待补全')}</small></span><em>${a.demo?'演示素材':'研究素材'}</em></label>`).join('')||'<div class="empty">没有匹配素材。先批量导入图片，或调整筛选条件。</div>';
    $('#annotation-selected-count').textContent=`已选 ${annotationSelected.size} 份`;
    $('#annotation-visible-count').textContent=`匹配 ${assets.length} 份${assets.length>100?' · 列表显示前100份':''}`;
    updateAnnotationEstimate();
  }
  function updateAnnotationEstimate(){
    if(!$('#annotation-sample-size'))return;
    const kind=$('#annotation-selection-type')?.value||'single',n=Number($('#annotation-images-per-question')?.value||1);
    const questions=kind==='single'?annotationSelected.size:Math.floor(annotationSelected.size/n);
    $('#annotation-sample-size').max=Math.max(1,questions);
    $('#annotation-sample-size').nextElementSibling.textContent=`题库预计 ${questions} 道题；每位参与者抽题数不能超过题数。`;
  }
  async function showAnnotationAnswers(id,page=1){
    const data=await api(`/api/admin/annotations/${id}/answers?page=${page}`),dialog=ensureDialog('annotation-answers-dialog');
    dialog.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">VOLUNTEER RESPONSES</div><h2>${esc(data.project.title)} · 回答记录</h2><p class="small-text">${data.project.is_demo?'示范题库 · 不属于正式研究数据 · ':''}${data.project.mode==='rating'?'打分实验':'选择实验'} · 共 ${data.total} 条已提交回答；每页最多显示 200 条。题目序号为该参与者抽取题单中的顺序。</p><div class="table-wrap annotation-answer-table"><table><thead><tr><th>志愿者昵称</th><th>题序</th><th>素材</th><th>回答</th><th>补充说明</th><th>提交时间</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td>${esc(r.nickname)}</td><td>${r.draw_order||'—'}</td><td><img class="answer-thumb" src="${esc(r.image)}" alt=""><span>${esc(r.item_name)}</span></td><td><b>${esc(r.choice)}</b>${r.score!==null?` 分`:''}</td><td>${esc(r.note||'—')}</td><td>${date(r.answered_at)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">还没有已提交回答。</td></tr>'}</tbody></table></div><div class="dialog-action-row"><span class="small-text">第 ${data.page} / ${Math.max(1,Math.ceil(data.total/data.page_size))} 页</span><span class="spacer"></span><button class="btn secondary small" data-action="ext-annotation-page" data-id="${id}" data-page="${page-1}" ${page<=1?'disabled':''}>上一页</button><button class="btn secondary small" data-action="ext-annotation-page" data-id="${id}" data-page="${page+1}" ${page>=Math.ceil(data.total/data.page_size)?'disabled':''}>下一页</button><button class="btn small" data-action="ext-annotation-export" data-id="${id}">导出全部 CSV ↓</button></div>`;
    dialog.showModal();
  }

  async function renderAudit(ticket){
    section().innerHTML='<div class="empty">正在读取操作日志…</div>';const data=await api('/api/admin/research/logs');if(ticket!==renderTicket)return;
    section().innerHTML=`<div class="section-heading"><div><h2>研究操作日志</h2><p class="small-text">从V1.1开始记录管理操作，保留数据处理与版本变更依据。</p></div><button class="btn secondary small" data-action="ext-export-logs">全部日志 CSV ↓</button></div><div class="notice">记录草稿保存、版本发布、接收状态、素材管理、设计应用、人工审查和报告导出。日志不保存参与者作答令牌，不替代原始实验数据。</div><section class="panel"><div class="table-wrap"><table><thead><tr><th>序号</th><th>时间</th><th>操作</th><th>对象</th><th>记录详情</th></tr></thead><tbody>${data.logs.map(row=>`<tr><td>${row.id}</td><td>${date(row.created)}</td><td>${esc(row.action)}</td><td class="audit-subject">${esc(row.subject)}</td><td class="audit-details">${esc(JSON.stringify(row.details))}</td></tr>`).join('')}</tbody></table></div><p class="results-note">页面显示最近300条；导出包含全部已保存日志。数据库可由本机研究者管理，日志不提供防篡改认证。</p></section>`;
  }

  const baseWelcome=welcome;
  welcome=function(){baseWelcome();if(experiment.block_count>1){$('.welcome-facts strong').textContent=experiment.count_min===experiment.count_max?String(experiment.count_min):`${experiment.count_min}–${experiment.count_max}`;$('.welcome-facts span').textContent='本次分配的对比题';$('.participant-form h3').insertAdjacentHTML('afterend',`<p class="group-intro">本实验分为${experiment.block_count}个题组，开始时自动分配一组。</p>`);}};
  const baseParticipant=renderParticipant;
  renderParticipant=function(){baseParticipant();if(participant.experiment.block_count>1){const target=$('.experiment-meta .badge-row')||$('.result-top .badge-row');target?.insertAdjacentHTML('beforeend',`<span class="pill gray">题组 ${participant.block_index}</span>`);}};

  document.addEventListener('input',event=>{if(event.target.id==='asset-search'){libraryQuery=event.target.value;$('#asset-grid').innerHTML=libraryCards();}if(event.target.id==='annotation-asset-search'){annotationQuery=event.target.value;renderAnnotationAssets();}});
  document.addEventListener('change',async event=>{
    const el=event.target;
    try{
      if(el.id==='asset-filter'){libraryFilter=el.value;$('#asset-grid').innerHTML=libraryCards();}
      if(el.id==='quality-only-flags')$('#quality-rows').innerHTML=qualityRows(qualityData.sessions.filter(s=>!el.checked||s.flags.length));
      if(el.id==='quality-version'){resultCode=el.value;await renderQuality(renderTicket);}
      if(el.id==='analysis-dimension')$('#group-analysis').innerHTML=groupTable(analysisData.groups[el.value]);
      if(el.id==='annotation-mode'){$('#annotation-choice-fields').classList.toggle('hidden',el.value!=='choice');$('#annotation-rating-fields').classList.toggle('hidden',el.value!=='rating');}
      if(el.id==='annotation-selection-type'){
        const compare=el.value!=='single';$('#annotation-images-per-question-wrap').classList.toggle('hidden',!compare);
        $('#annotation-options').closest('.field').classList.toggle('hidden',compare);
        const n=Number($('#annotation-images-per-question').value),questions=compare?Math.floor(annotationSelected.size/n):annotationSelected.size;
        $('#annotation-sample-size').max=Math.max(1,questions);$('#annotation-sample-size').nextElementSibling.textContent=`题库预计 ${questions} 道题；每位参与者抽题数不能超过题数。`
      }
      if(el.id==='annotation-images-per-question'||el.id==='annotation-asset-search'){
        const kind=$('#annotation-selection-type').value,compare=kind!=='single',n=Number($('#annotation-images-per-question').value);
        const questions=compare?Math.floor(annotationSelected.size/n):annotationSelected.size;
        $('#annotation-sample-size').max=Math.max(1,questions);$('#annotation-sample-size').nextElementSibling.textContent=`题库预计 ${questions} 道题；每位参与者抽题数不能超过题数。`
      }
      if(el.matches('[data-annotation-asset]')){el.checked?annotationSelected.add(el.dataset.annotationAsset):annotationSelected.delete(el.dataset.annotationAsset);el.closest('.annotation-asset').classList.toggle('selected',el.checked);$('#annotation-selected-count').textContent=`已选 ${annotationSelected.size} 份`;updateAnnotationEstimate();}
      if(el.id==='library-upload'){
        const files=Array.from(el.files);if(!files.length)return;let imported=0;
        for(const file of files){if(file.size>12*1024*1024)throw new Error(`${file.name} 超过12MB`);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});await api('/api/admin/upload',{name:file.name,data});imported++;toast(`已导入 ${imported}/${files.length} 张街景`);}
        await renderLibrary(renderTicket);toast(`已导入${imported}张图片，请补充来源及拍摄信息`);
      }
    }catch(error){toast(error.message,true);}
  });

  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action^="ext-"]');if(!button||button.disabled)return;
    const action=button.dataset.action;
    try{
      if(action==='ext-close-dialog'){button.closest('dialog').close();return;}
      if(action==='ext-annotation-refresh'){await renderAnnotationManager(renderTicket);return;}
      if(action==='ext-annotation-view'||action==='ext-annotation-page'){await showAnnotationAnswers(button.dataset.id,Number(button.dataset.page));return;}
      if(action==='ext-annotation-select-filter'){
        const q=annotationQuery.toLowerCase();annotationAssets.filter(a=>!q||[a.name,a.location,a.source,...a.tags].join(' ').toLowerCase().includes(q)).forEach(a=>annotationSelected.add(a.image));renderAnnotationAssets();toast('已将筛选结果加入任务素材');return;
      }
      if(action==='ext-annotation-create'){
        const mode=$('#annotation-mode').value;if(!annotationSelected.size)throw new Error('请至少选择一份素材');
        const selectionType=mode==='choice'?$('#annotation-selection-type').value:'single';
        const imageCount=selectionType==='single'?1:Number($('#annotation-images-per-question').value);
        const questionCount=selectionType==='single'?annotationSelected.size:Math.floor(annotationSelected.size/imageCount);
        if(questionCount<1)throw new Error(`至少选择 ${imageCount} 张图片，才能组成一道比较题`);
        if(Number($('#annotation-sample-size').value)>questionCount)throw new Error(`当前题库只有 ${questionCount} 道题，请减少每位参与者抽题数`);
        const body={title:$('#annotation-title').value,description:$('#annotation-description').value,prompt:$('#annotation-prompt').value,consent:$('#annotation-consent').value,mode,selection_type:selectionType,images_per_question:imageCount,images:Array.from(annotationSelected),sample_size:Number($('#annotation-sample-size').value),publish:true};
        if(mode==='choice'&&selectionType==='single')body.options=$('#annotation-options').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        else{body.score_min=Number($('#annotation-score-min').value);body.score_max=Number($('#annotation-score-max').value);body.score_min_label=$('#annotation-min-label').value;body.score_max_label=$('#annotation-max-label').value;}
        button.disabled=true;const result=await api('/api/admin/annotations',body);annotationSelected.clear();await renderAnnotationManager(renderTicket);toast(`已开放实验：题库 ${result.items} 题，每位参与者随机抽 ${result.sample_size} 题`);return;
      }
      if(action==='ext-annotation-status'){await api(`/api/admin/annotations/${button.dataset.id}/status`,{published:button.dataset.published==='true'});await renderAnnotationManager(renderTicket);toast(button.dataset.published==='true'?'实验已开放':'实验已暂停');return;}
      if(action==='ext-annotation-export'){download(`/api/admin/annotations/${button.dataset.id}/export`);return;}
      if(action==='ext-edit-asset'){editAsset(button.dataset.image);return;}
      if(action==='ext-pick-library'){await openAssetPicker(button.dataset.target);return;}
      if(action==='ext-use-asset'){await openAssetPicker(null,button.dataset.image);return;}
      if(action==='ext-confirm-asset'){
        const asset=library.find(a=>a.image===$('#picker-image').value);if(!asset)throw new Error('请选择一张可用街景');
        const [index,key]=$('#picker-target').value.split('.');for(const field of ['image','source','location','captured','heading'])config.questions[Number(index)][key][field]=asset[field];
        $('#asset-picker-dialog').close();markDirty();tab='design';renderAdmin();toast('素材已加入草稿，请保存后发布');return;
      }
      if(action==='ext-save-asset'){
        const body={image:activeAsset.image};for(const field of $('#asset-editor-dialog').querySelectorAll('[data-asset-field]'))body[field.dataset.assetField]=field.value;
        body.tags=body.tags.split(/[,，、\n]+/).map(t=>t.trim()).filter(Boolean);await api('/api/admin/research/assets/save',body);$('#asset-editor-dialog').close();await renderLibrary(renderTicket);toast('素材资料已保存');return;
      }
      if(action==='ext-archive-asset'){await api('/api/admin/research/assets/archive',{image:button.dataset.image,archived:button.dataset.archive==='true'});$('#asset-editor-dialog').close();await renderLibrary(renderTicket);toast('素材归档状态已更新，历史题目保持不变');return;}
      if(action==='ext-export-assets'){download('/api/admin/research/assets/export');return;}
      if(action==='ext-distribute'){
        const n=Number($('#block-count').value);if(!Number.isInteger(n)||n<1||n>10||n>config.questions.length)throw new Error('题组应为1–10的整数，且不能多于题目数量');config.block_count=n;config.questions.forEach((q,i)=>q.block=i%n+1);markDirty();renderAdmin();toast('题目已轮流分组，请保存草稿');return;
      }
      if(action==='ext-add-pair'){const spec=specFromForm();if(spec.pairs.length>=20)throw new Error('最多20组街景配对');spec.pairs.push({a:spec.pairs[0].b,b:spec.pairs[0].a});$('#design-pairs').innerHTML=pairRows(spec);return;}
      if(action==='ext-remove-pair'){const spec=specFromForm();spec.pairs.splice(Number(button.dataset.index),1);$('#design-pairs').innerHTML=pairRows(spec);return;}
      if(action==='ext-preview-design'||action==='ext-apply-design'){
        if(dirty)throw new Error('请先到题目编辑保存当前草稿，再生成设计');
        const spec=specFromForm();
        if(action==='ext-apply-design'){
          pendingDesign={id:selectedId,...spec};const dialog=ensureDialog('apply-design-dialog');
          dialog.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">APPLY EXPERIMENT DESIGN</div><h2>确认应用这份题组设计</h2><p class="panel-lead">将按当前参数生成${spec.count}道题，分为${spec.blocks}组，替换所选实验的草稿题库。已发布版本和回答保持不变。</p><div class="notice">如需单独留存原草稿，可先到题目编辑导出模板。系统同时保存设计参数、生成摘要和应用操作记录。</div><div class="dialog-action-row"><button class="btn secondary" data-action="ext-close-dialog">返回修改</button><button class="btn" data-action="ext-confirm-design">确认应用到草稿</button></div>`;
          dialog.showModal();return;
        }
        button.disabled=true;
        const data=await api('/api/admin/research/design',{id:selectedId,...spec,apply:false});designPreview=data;
        await renderDesigner(renderTicket);return;
      }
      if(action==='ext-confirm-design'){
        if(!pendingDesign||pendingDesign.id!==selectedId)throw new Error('实验已切换，请重新生成预览');
        button.disabled=true;const data=await api('/api/admin/research/design',{...pendingDesign,apply:true});
        designPreview=data;$('#apply-design-dialog').close();pendingDesign=null;await loadAdmin();await renderDesigner(renderTicket);toast('新题组已写入草稿；发布后才用于参与者');return;
      }
      if(action==='ext-export-design'){if(designPreview)downloadJson(designPreview,'骑遇_设计预览.json');return;}
      if(action==='ext-check-design'){
        const data=await api('/api/admin/research/diagnostics',{config});const d=ensureDialog('diagnostics-dialog');d.innerHTML=`<button class="dialog-close" data-action="ext-close-dialog">✕</button><div class="eyebrow">DESIGN CHECK</div><h2>当前草稿设计检查</h2>${diagnosticHtml(data)}`;d.showModal();return;
      }
      if(action==='ext-refresh-quality'){await renderQuality(renderTicket,Number($('#quality-threshold').value));toast('审查记录已更新');return;}
      if(action==='ext-update-threshold'){await renderQuality(renderTicket,Number($('#quality-threshold').value));return;}
      if(action==='ext-review'){reviewDialog(button.dataset.id);return;}
      if(action==='ext-save-review'){
        const dialog=$('#review-dialog');await api('/api/admin/research/review',{id:dialog.dataset.id,status:$('#review-status').value,note:$('#review-note').value});dialog.close();await renderQuality(renderTicket,qualityData.fast_ms);toast('审查意见已保存，结果汇总将采用最新状态');return;
      }
      if(action==='ext-export-sessions'){download(`/api/admin/research/versions/${resultCode}/sessions-export`);return;}
      if(action==='ext-report'){download(`/api/admin/research/versions/${resultCode}/report`);return;}
      if(action==='ext-export-logs'){download('/api/admin/research/logs/export');return;}
    }catch(error){toast(error.message,true);button.disabled=false;}
  });
})();
