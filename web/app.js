if ((location.pathname === '/admin' && sessionStorage.getItem('ridechoice.role') !== 'manager') ||
    (location.pathname.startsWith('/p/') && sessionStorage.getItem('ridechoice.role') !== 'volunteer')) {
  location.replace('/');
} else if (location.pathname === '/admin' || location.pathname.startsWith('/p/')) {
'use strict';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID().replaceAll('-', '');
const date = value => new Date(value).toLocaleString('zh-CN', {hour12:false});
const isAdmin = location.pathname === '/admin';
const code = location.pathname.startsWith('/p/') ? location.pathname.split('/')[2] : 'demo';
const preview = new URLSearchParams(location.search).get('preview') === '1';
let experiments = [], selectedId = null, config = null, dirty = false, tab = 'overview';
let resultCode = null, participant = null, experiment = null, selectedSide = null, busy = false;
let startedAt = 0, visibleAt = 0, visibleMs = 0, hiddenCount = 0, toastTimer;
const storageKey = `ridechoice.session.${encodeURIComponent(sessionStorage.getItem('ridechoice.nickname')||'participant')}.${code}.${preview ? 'preview' : 'participant'}`;

if(!isAdmin){
  const nav=$('nav');nav.innerHTML='<a href="/volunteer">实验大厅</a><button id="help-button" class="nav-help">使用指南</button><button class="portal-logout" id="participant-logout">退出登录</button>';
  $('#participant-logout').addEventListener('click',async()=>{try{await api('/api/logout',{});}finally{sessionStorage.removeItem('ridechoice.role');sessionStorage.removeItem('ridechoice.nickname');location.assign('/');}});
}

async function api(path, body) {
  const options = body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)};
  const response = await fetch(path, options);
  let data;
  try { data = await response.json(); }
  catch { throw new Error('线上服务端没有返回有效数据。请确认打开的是已部署的完整平台，而不是只发布了静态页面。'); }
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试');
  return data;
}

function toast(message, error=false) {
  const element = $('#toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => element.className = '', error ? 6500 : 3500);
}

function stashGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function stashSet(key, value) { try { localStorage.setItem(key, value); } catch { /* DB remains authoritative. */ } }
function stashRemove(key) { try { localStorage.removeItem(key); } catch {} }
function markDirty() { dirty = true; const status = $('#save-status'); if (status) status.textContent = '有未保存的修改'; }
function currentExperiment() { return experiments.find(e => e.id === selectedId); }
function download(url) { const a=document.createElement('a'); a.href=url; a.download=''; document.body.append(a); a.click(); a.remove(); }
function downloadJson(obj, name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('链接已复制'); }
  catch { const field=$('#published-link'); if(field){field.focus();field.select();} toast('请选中链接后复制'); }
}
function imageModal(src) { const d=$('#image-dialog'); $('img',d).src=src; d.showModal(); }
function setPath(obj, path, value) { const parts=path.split('.'); const last=parts.pop(); const target=parts.reduce((o,k)=>o[k],obj); target[last]=value; }
function pill(demo, active=true) { return `<span class="pill ${demo?'demo':'success'}">${demo?'演示版本':'正式版本'}</span>${active?'':' <span class="pill gray">已暂停</span>'}`; }
function fail(error) {
  app.innerHTML=`<section class="error-page"><div class="eyebrow">RIDECHOICE</div><h2>暂时无法打开</h2><p>${esc(error.message)}</p><div class="button-row"><button class="btn" data-action="reload">重新加载</button><a class="btn secondary" href="/p/demo">返回演示</a></div></section>`;
}

// Researcher workspace
async function loadAdmin(keepConfig=false) {
  const data=await api('/api/admin');
  experiments=data.experiments;
  if (!experiments.some(e=>e.id===selectedId)) selectedId=experiments[0]?.id;
  if (!keepConfig) config=clone(currentExperiment()?.config);
}

function renderAdmin() {
  const current=currentExperiment();
  $('#nav-admin').classList.add('active');
  app.innerHTML=`<div class="workspace"><aside class="sidebar"><div class="sidebar-title">MY EXPERIMENTS</div><button class="btn" data-action="new-experiment">＋ 新建实验</button>${experiments.map(e=>`<button class="project-item ${e.id===selectedId?'active':''}" data-action="select-experiment" data-id="${esc(e.id)}"><b>${esc(e.config.title)}</b><small>${e.config.questions.length} 组街景 · ${e.versions.filter(v=>!v.demo).length} 个正式版本</small></button>`).join('')}<div class="sidebar-note">你的研究，你的数据。<br>草稿、图片与回答保存在平台数据存储中；请定期下载备份。<br><br><button class="text-btn" data-action="backup">下载完整备份 ↗</button></div></aside><section class="workspace-main"><div class="workspace-header"><div><div class="eyebrow">MANAGEMENT WORKSPACE</div><h1>${esc(config.title)}</h1><p>管理人员工作台 · 发布实验、管理素材和导出志愿者数据</p></div><div class="button-row"><span class="badge-row"><span class="pill gray">仅管理</span></span><button class="btn secondary small" data-action="open-latest" hidden>预览实验 ↗</button></div></div><div class="workspace-tabs" role="tablist">${[['overview','01','概览'],['design','02','路线实验'],['publish','03','发布投放'],['annotations','04','数据实验'],['results','05','实验结果']].map(([key,num,label])=>`<button role="tab" aria-selected="${tab===key}" class="tab ${tab===key?'active':''}" data-action="tab" data-tab="${key}"><span>${num}</span>${label}</button>`).join('')}</div><div id="admin-content"></div></section></div>`;
  const content=$('#admin-content');
  if(tab==='overview') content.innerHTML=overview(current);
  if(tab==='design') content.innerHTML=editor();
  if(tab==='publish') content.innerHTML=publishPage(current);
  if(tab==='results') { content.innerHTML='<div class="empty">正在读取回答…</div>'; renderResults().catch(error=>{ content.innerHTML=`<div class="notice error">${esc(error.message)}</div>`; }); }
}

function overview(e) {
  const formal=e.versions.filter(v=>!v.demo);
  const completed=formal.reduce((sum,v)=>sum+v.complete,0);
  const checks=e.checks.length;
  return `<div class="overview-hero"><div class="overview-copy"><div class="eyebrow">A FEW MORE MINUTES, A DIFFERENT RIDE.</div><h2>多几分钟，<br>换一种骑行体验。</h2><p>让真实街景成为选择情境，记录人们愿意为怎样的环境多骑一段路。</p><div class="button-row"><button class="btn small" data-action="tab" data-tab="design">开始设计题目 <span>→</span></button><button class="text-btn" data-action="tab" data-tab="annotations">创建数据实验 ↗</button></div></div><div class="overview-picture" role="img" aria-label="林荫街道示例"></div></div><div class="metric-grid"><div class="metric"><label>街景对比题</label><strong>${config.questions.length.toString().padStart(2,'0')}</strong><small>每题两条路线</small></div><div class="metric"><label>正式完成记录</label><strong>${completed.toString().padStart(2,'0')}</strong><small>演示与预览独立标记</small></div><div class="metric"><label>正式发布版本</label><strong>${formal.length.toString().padStart(2,'0')}</strong><small>已发布题目固定保存</small></div><div class="metric"><label>发布检查</label><strong>${checks?'待补全':'已就绪'}</strong><small>${checks?`${checks} 项信息需要核对`:'仍需研究者确认设计'}</small></div></div><div class="section-heading"><h2>一次实验，三个步骤</h2><span class="small-text">题目 → 参与 → 证据</span></div><div class="panel workflow"><div class="workflow-item"><span>01</span><div><h3>搭建选择情境</h3><p>导入街景，设置骑行时间<br>补全来源、日期与视角</p></div></div><div class="workflow-item"><span>02</span><div><h3>邀请参与者作答</h3><p>发布固定版本与参与链接<br>随机安排题序和左右位置</p></div></div><div class="workflow-item"><span>03</span><div><h3>回到数据理解选择</h3><p>查看完成情况与选择分布<br>导出原始回答及题目快照</p></div></div></div><div class="split-panels"><div class="panel"><h3>实验设计设置</h3><div class="check-row"><b>${config.random_order?'✓':'○'}</b> 题目顺序${config.random_order?'随机化':'固定'}</div><div class="check-row"><b>${config.random_sides?'✓':'○'}</b> 左右位置${config.random_sides?'随机化':'固定'}</div><div class="check-row"><b>${config.allow_neither?'✓':'○'}</b> ${config.allow_neither?'允许“两条都不选”':'每题需选择一条路线'}</div><div class="check-row"><b>${config.show_feedback?'✓':'○'}</b> ${config.show_feedback?'完成后展示个人选择回顾':'完成后仅显示提交确认'}</div></div><div class="panel"><h3>从演示走向正式研究</h3><p class="panel-lead">示例街景便于熟悉流程，时间和信号灯是演示假设。正式调查前，请更换研究图片、核对使用依据，并按研究问题安排选择条件与样本。</p><button class="text-btn" data-action="tab" data-tab="publish">查看发布检查 →</button></div></div>`;
}

function field(label,path,value,type='text',extra='') {
  return `<label class="field ${extra}"><span>${label}</span><input type="${type}" data-path="${path}" value="${esc(value)}" ${type==='number'?'min="0" max="240" step="1"':''}></label>`;
}
function altEditor(q,index,key) {
  const a=q[key], path=`questions.${index}.${key}`;
  return `<div class="alt-editor"><div class="upload-area" id="upload-${index}-${key}">${a.image?`<img src="${esc(a.image)}" alt="路线 ${key.toUpperCase()} 街景">`:'<div class="upload-placeholder"><span>＋</span>导入一张街景照片</div>'}<label class="upload-label">${a.image?'更换街景':'选择图片'}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${index}.${key}"></label></div><div class="alt-fields"><div class="alt-name"><span>${key.toUpperCase()}</span> 原始路线编号 · 展示时可随机换位</div>${field('骑行时间 / 分钟',path+'.time',a.time,'number')}${field('信号灯 / 个',path+'.stops',a.stops,'number')}${field('道路条件说明',path+'.facility',a.facility,'text','wide')}<details class="metadata"><summary>图片来源与视角记录 ${a.source&&a.location&&a.captured&&a.heading?'· 已填写':'· 待补全'}</summary><div class="form-grid">${field('图片来源及使用依据',path+'.source',a.source,'text','wide')}${field('地点 / 路段',path+'.location',a.location,'text','wide')}${field('拍摄日期（未知请注明）',path+'.captured',a.captured)}${field('拍摄方向 / 视角',path+'.heading',a.heading)}</div></details></div></div>`;
}
function editor() {
  return `<div class="editor-top"><div class="panel"><h3>参与者会看到的说明</h3><div class="form-grid">${field('实验名称','title',config.title,'text','wide')}<label class="field wide"><span>参与说明 · 用途、退出方式与数据用途</span><textarea data-path="description" rows="4">${esc(config.description)}</textarea></label><label class="field wide"><span>共同假设条件</span><textarea data-path="context" rows="3">${esc(config.context)}</textarea></label></div></div><div class="panel settings-box"><h3>实验设置</h3>${[['random_order','随机题目顺序'],['random_sides','随机路线左右位置'],['allow_neither','允许“两条都不选”'],['show_feedback','完成后提供个人选择回顾']].map(([key,label])=>`<label class="checkbox"><input type="checkbox" data-path="${key}" ${config[key]?'checked':''}><span>${label}</span></label>`).join('')}<label class="field"><span>知情同意文字</span><textarea data-path="consent" rows="3">${esc(config.consent)}</textarea></label>${field('研究者联系 / 补充说明','contact',config.contact)}</div></div><div class="section-heading"><h2>街景选择题 <span class="pill gray">${config.questions.length} 组</span></h2><button class="btn secondary small" data-action="add-question">＋ 添加一题</button></div><div class="notice">两张图片将按相同版面呈现，点击可查看原图。时间、信号灯与文字条件由你设定；请明确哪些是实验假设，并核对图片内容是否与设定一致。</div>${config.questions.map((q,i)=>`<article class="question-editor"><div class="qe-heading"><h3>第 ${String(i+1).padStart(2,'0')} 题</h3><span class="small-text">${esc(q.id.slice(0,16))}</span><span class="spacer"></span><button class="text-btn" data-action="move-question" data-index="${i}" data-delta="-1" aria-label="上移第${i+1}题" ${i===0?'disabled':''}>↑</button><button class="text-btn" data-action="move-question" data-index="${i}" data-delta="1" aria-label="下移第${i+1}题" ${i===config.questions.length-1?'disabled':''}>↓</button><button class="text-btn" data-action="duplicate-question" data-index="${i}">复制</button><button class="text-btn" data-action="delete-question" data-index="${i}">移除</button></div><div class="qe-prompt">${field('题目提问',`questions.${i}.prompt`,q.prompt)}${field('本题情境（留空使用共同条件）',`questions.${i}.context`,q.context)}</div><div class="qe-alts">${altEditor(q,i,'a')}${altEditor(q,i,'b')}</div></article>`).join('')}<div class="json-actions"><button class="btn secondary small" data-action="export-template">导出题目模板 ↓</button><label class="btn secondary small file-btn">导入题目模板<input type="file" id="import-template" accept="application/json,.json"></label></div><div class="editor-actions"><p id="save-status">${dirty?'有未保存的修改':'草稿已保存；发布版本不随草稿变化'}</p><div class="button-row"><button class="btn secondary" data-action="save">保存草稿</button><button class="btn" data-action="save-and-publish">保存并检查发布 →</button></div></div>`;
}

function blankAlt() { return {image:'',time:20,stops:0,facility:'',source:'',location:'',captured:'',heading:''}; }
function blankQuestion() { return {id:id(),prompt:'你更愿意选择哪条路线？',context:'',a:blankAlt(),b:blankAlt()}; }
function blankConfig() { return {title:'新的街景选择实验',description:'本实验研究街景环境与骑行路线选择。匿名记录选择和作答时间，不收集姓名与联系方式。参与完全自愿，可随时关闭页面退出；未完成记录会单独标记。',context:'请想象你正独自骑行，天气适宜。两条路线起终点相同、均可通行，除题目展示条件外，其余情况相近。',consent:'我已阅读实验说明，理解参与完全自愿，同意匿名记录我的选择。我可以随时退出。',contact:'',random_order:true,random_sides:true,allow_neither:true,show_feedback:true,questions:[blankQuestion()]}; }

async function saveDraft(silent=false) {
  const result=await api('/api/admin/save',{id:selectedId,config});
  selectedId=result.id; dirty=false;
  await loadAdmin();
  if(!silent) toast('草稿已保存');
}

function versionRows(versions) {
  if(!versions.length) return '<div class="empty">尚未发布。先发布演示，检查参与者流程。</div>';
  return versions.map(v=>`<div class="version-row"><div class="version-info"><div class="badge-row"><b>版本 ${v.number}</b>${pill(v.demo,v.active)}</div><p>${date(v.created)} · ${v.complete} 份完成 / ${v.total} 份开始</p><a class="version-link" href="/p/${esc(v.code)}" target="_blank" rel="noopener">/p/${esc(v.code)} ↗</a></div><div class="version-actions"><button class="btn secondary small" data-action="copy" data-code="${esc(v.code)}">复制链接</button><button class="text-btn" data-action="toggle-active" data-code="${esc(v.code)}" data-active="${!v.active}">${v.active?'暂停':'开放'}</button></div></div>`).join('');
}
function publishPage(e) {
  const errors=e.checks;
  const latest=e.versions[0];
  return `${dirty?'<div class="notice warm">当前草稿有未保存的修改。发布时会先保存，再对最新草稿执行检查。</div>':''}<div class="publish-grid"><div><section class="panel"><div class="section-heading"><h3>发布前检查</h3><span class="pill ${errors.length?'demo':'success'}">${errors.length?`${errors.length} 项待补全`:'资料检查通过'}</span></div><p class="panel-lead">正式发布需要上传研究图片、填写参与说明，并记录图片来源及拍摄信息。检查只核对资料完整性，实验有效性仍需研究者判断。</p>${errors.length?`<ul class="checks-list">${errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><button class="text-btn" data-action="tab" data-tab="design">返回题目设计补全 →</button>`:'<div class="check-row"><b>✓</b> 已填入正式图片、来源与拍摄信息</div>'}<div class="publish-confirm"><label class="checkbox"><input type="checkbox" id="publish-reviewed"><span>我已核对图片使用依据、条件与画面的一致性、知情同意内容及实验设计，确认可以用于正式调查。</span></label><div class="button-row"><button class="btn" data-action="publish-formal">发布正式版本 →</button><button class="btn secondary" data-action="publish-demo">发布演示版本</button></div></div></section><div class="notice">每次发布都会生成独立版本和链接。修改草稿不影响旧链接；暂停版本后，已有回答保留，该版本暂不接收新回答。</div></div><section class="panel"><h3>已发布的版本</h3>${latest?`<div class="copy-link"><input id="published-link" readonly aria-label="最新参与链接" value="${esc(location.origin+'/p/'+latest.code)}"><button class="btn small" data-action="copy" data-code="${esc(latest.code)}">复制</button></div>`:''}${versionRows(e.versions)}<p class="results-note">复制的参与链接可通过当前访问地址分享。正式调查前，请用另一台设备确认页面可访问且作答成功保存。</p></section></div>`;
}

async function renderResults() {
  const e=currentExperiment();
  if(!e.versions.length) { $('#admin-content').innerHTML='<div class="panel empty"><div class="empty-symbol">↗</div><h3>还没有发布版本</h3><p>发布实验后，就可以在这里查看回答。</p><button class="btn secondary small" data-action="tab" data-tab="publish">检查与发布 →</button></div>'; return; }
  if(!e.versions.some(v=>v.code===resultCode)) resultCode=e.versions[0].code;
  const requested=resultCode;
  const [s,details]=await Promise.all([api(`/api/admin/versions/${requested}/stats`),api(`/api/admin/versions/${requested}/sessions`)]);
  if(tab!=='results'||resultCode!==requested) return;
  const content=$('#admin-content'); if(!content) return;
  content.innerHTML=`<div class="result-controls"><label class="field"><span>查看版本</span><select id="result-version">${e.versions.map(v=>`<option value="${esc(v.code)}" ${v.code===resultCode?'selected':''}>版本 ${v.number} · ${v.demo?'演示':'正式'} · ${v.active?'开放中':'已暂停'}</option>`).join('')}</select></label><div class="button-row"><button class="btn secondary small" data-action="refresh-results">刷新结果 ↻</button><button class="btn secondary small" data-action="snapshot">题目快照 JSON ↓</button><button class="btn small" data-action="export-csv">原始回答 CSV ↓</button></div></div>${s.experiment.demo?'<div class="notice warm">当前为演示版本，记录不会计入概览中的正式完成数。下面的选择分布仅汇总本版本已完成、非研究者预览且未被人工排除的记录。</div>':'<div class="notice">下列选择分布仅汇总本版本已完成、非研究者预览且未被人工排除的记录。导出文件同时保留未完成与预览记录，使用时请按标记筛选。</div>'}<div class="metric-grid"><div class="metric"><label>开始作答</label><strong>${s.started}</strong><small>作答记录数，非唯一人数</small></div><div class="metric"><label>完成作答</label><strong>${s.completed}</strong><small>完成全部题目</small></div><div class="metric"><label>尚未完成</label><strong>${s.incomplete}</strong><small>保留已有回答</small></div><div class="metric"><label>完成率</label><strong>${s.started?Math.round(s.completed/s.started*100):0}%</strong><small>完成记录 / 开始记录</small></div></div><section class="panel"><div class="section-heading"><h3>逐题选择分布</h3><span class="small-text">原始 A / B 编号，已还原左右换位</span></div><div class="legend"><span>原始 A</span><span>原始 B</span><span>都不选</span></div><div class="table-wrap"><table><thead><tr><th>题目</th><th>A / B 时间</th><th>原始 A</th><th>原始 B</th><th>都不选</th><th>计入记录数</th><th>占比 A / B / 都不选</th></tr></thead><tbody>${s.questions.map((q,i)=>`<tr><td>第 ${i+1} 题 <small class="muted">${esc(q.id.slice(0,8))}</small></td><td>${q.time_a} / ${q.time_b} 分钟</td><td>${q.a}</td><td>${q.b}</td><td>${q.neither}</td><td>${q.n}</td><td><div class="stat-bars"><meter aria-label="A 选择比例" min="0" max="${q.n||1}" value="${q.a}"></meter><meter class="b" aria-label="B 选择比例" min="0" max="${q.n||1}" value="${q.b}"></meter><meter class="n" aria-label="都不选比例" min="0" max="${q.n||1}" value="${q.neither}"></meter></div></td></tr>`).join('')}</tbody></table></div><p class="results-note">这些是描述性统计，不能直接解释为因果效应或“愿意多骑的最大分钟数”。如需估计时间权衡，应另行设计属性组合、检验样本，并使用适当的选择模型。</p></section><section class="panel"><div class="section-heading"><h3>作答记录</h3><span class="small-text">含研究者预览，便于检查流程</span></div><div class="table-wrap"><table><thead><tr><th>记录编号</th><th>志愿者昵称</th><th>骑行频率</th><th>主要目的</th><th>进度</th><th>状态</th><th>开始时间</th></tr></thead><tbody>${details.sessions.map(x=>`<tr><td>${esc(x.id.slice(0,8))}</td><td>${esc(x.profile.nickname||'—')}</td><td>${esc(x.profile.frequency)}</td><td>${esc(x.profile.purpose)}</td><td>${x.answered} / ${x.total}</td><td><span class="pill ${x.preview?'gray':x.finished?'success':'demo'}">${x.preview?'研究者预览':x.finished?'已完成':'未完成'}</span></td><td>${date(x.created)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">还没有回答。发布链接后即可开始。</td></tr>'}</tbody></table></div><p class="results-note">重复参与会生成新的记录；平台不据此判断唯一受试者，也不自动排除异常值。服务器耗时包含停留和刷新间隔，页面可见时长与切换次数由浏览器报告，仅作辅助检查。</p></section>`;
}

// Participant flow
function welcome() {
  $('#nav-participant').classList.add('active');
  const resume=stashGet(storageKey);
  app.innerHTML=`<section class="welcome"><div class="welcome-hero"><div class="welcome-copy"><div class="kicker">${preview?'研究者预览 · 不进入正式统计':experiment.demo?'街景选择 · 演示体验':'街景选择 · 骑行研究'}</div><h1>${experiment.title==='你愿意多骑几分钟？'?'你愿意<br><em>多骑几分钟？</em>':esc(experiment.title)}</h1><p class="intro">${esc(experiment.description)}</p><div class="welcome-facts"><div><strong>${String(experiment.count).padStart(2,'0')}</strong><span>组街景对比</span></div><div><strong>自主</strong><span>选择与退出</span></div><div><strong>匿名</strong><span>记录你的回答</span></div></div></div><div class="welcome-photo"><div class="route-doodle"><span>一段路<br><b>两种选择</b></span><i>↝</i></div><div class="photo-label"><span>EVERY RIDE STARTS WITH A CHOICE</span><p>路上的风景，值得你多远行？</p></div></div></div>${experiment.demo?'<div class="notice warm resume-box"><span>演示提示：本版本用于体验与测试；图片和题目条件请按演示情境理解，不代表可导航的实际路线。</span><span class="pill demo">演示数据</span></div>':''}${!experiment.active?'<div class="notice warm resume-box">这个实验已暂停接收回答。已有记录会保留。</div>':''}${resume?'<div class="notice resume-box"><span>这台设备保留了上一次作答，可以继续或查看结果。</span><button class="btn secondary small" data-action="resume">打开上次记录 →</button></div>':''}<div class="participation"><section class="instruction-block"><div class="eyebrow">HOW IT WORKS</div><h3>没有标准答案，选择你想骑的路。</h3><div class="instruction"><span>1</span><div><b>看一看街景</b><p>结合照片和题目给出的骑行条件判断。</p></div></div><div class="instruction"><span>2</span><div><b>比较两条路线</b><p>留意时间、信号灯与道路条件的差别。</p></div></div><div class="instruction"><span>3</span><div><b>做出你的选择</b><p>可选填理由，提交后进入下一题。</p></div></div><div class="notice">${esc(experiment.context)}</div>${experiment.contact?`<p class="small-text">${esc(experiment.contact)}</p>`:''}</section><form class="participant-form" id="start-form"><h3>${resume?'开始一份新的回答':'开始之前，了解你的骑行习惯'}</h3><div class="form-grid"><label class="field"><span>平时的骑行频率</span><select name="frequency" required><option value="">请选择</option>${['几乎不骑','每月几次','每周1–2次','每周3次及以上'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field"><span>主要骑行目的</span><select name="purpose" required><option value="">请选择</option>${['通勤通学','日常办事','休闲游览','运动锻炼','其他'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field"><span>你的骑行经验</span><select name="experience" required><option value="">请选择</option>${['新手','有一定经验','经验丰富'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field"><span>研究分配编号（选填）</span><input name="participant_code" maxlength="80" placeholder="请勿填写姓名或联系方式"></label></div><label class="checkbox"><input type="checkbox" name="consent" required><span>${esc(experiment.consent)}</span></label><div class="form-bottom"><small>不收集姓名、电话或精确位置。<br>关闭页面即可退出，已提交回答会保留。</small><button class="btn" type="submit" ${!experiment.active?'disabled':''}>开始选择 <span>→</span></button></div></form></div></section>`;
  $('#start-form').addEventListener('submit',startParticipant);
}

async function startParticipant(event) {
  event.preventDefault();
  if(busy)return;
  const form=event.currentTarget;
  const data=new FormData(form);
  busy=true; const btn=$('button[type=submit]',form);btn.disabled=true;btn.textContent='正在开始…';
  try {
    participant=await api('/api/sessions',{code,preview,consent:data.get('consent')==='on',profile:Object.fromEntries(data)});
    stashSet(storageKey,participant.id); renderParticipant();
  } catch(error) { toast(error.message,true);btn.disabled=false;btn.textContent='开始选择 →'; }
  finally {busy=false;}
}

function routeCard(alt,side,label) {
  return `<article class="route-card ${selectedSide===side?'selected':''}" id="card-${side}"><div class="route-photo"><img src="${esc(alt.image)}" alt="路线 ${label} 街景" data-route-image="${side}"><span class="route-badge">路线 ${label}</span><button class="zoom-btn" data-action="zoom" data-image="${esc(alt.image)}" aria-label="放大路线${label}街景">⛶ 查看大图</button></div><div class="route-info"><div class="route-time"><strong>${alt.time}</strong><span>分钟</span><span class="spacer"></span><span>预计骑行</span></div><div class="route-attributes"><span class="attribute">${alt.stops} 个信号灯</span>${alt.facility?`<span class="attribute">${esc(alt.facility)}</span>`:''}</div><button class="choose-btn" data-action="choose" data-side="${side}" aria-pressed="${selectedSide===side}">我选路线 ${label}</button></div></article>`;
}

function updateImageReadiness() {
  const images=Array.from(app.querySelectorAll('[data-route-image]'));
  const ready=images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0);
  const submit=$('#submit-answer');
  if(submit) submit.disabled=busy||!selectedSide||!ready;
  const status=$('#answer-status');
  if(status&&!busy) status.textContent=ready?'':'等待街景加载…';
}

function renderParticipant() {
  if(participant.complete) {completePage();return;}
  const q=participant.question;
  selectedSide=null;
  app.innerHTML=`<section class="question-page"><div class="experiment-meta"><div class="badge-row"><a href="/p/${esc(code)}">← 实验说明</a>${pill(participant.experiment.demo)}${participant.preview?'<span class="pill gray">研究者预览</span>':''}</div><div class="progress-meta"><span>第 ${participant.done+1} / ${participant.total} 题</span><progress value="${participant.done}" max="${participant.total}" aria-label="实验进度"></progress></div></div><div class="question-heading"><div><div class="eyebrow">YOUR ROUTE, YOUR CHOICE</div><h1>${esc(q.prompt)}</h1><p>${esc(q.context)}</p></div><span class="question-index">${String(participant.done+1).padStart(2,'0')}</span></div><div class="choice-grid">${routeCard(q.left,'left','A')}${routeCard(q.right,'right','B')}</div><section class="response-extra hidden" id="response-extra"><h3>愿意告诉我们原因吗？ <span class="muted">选填，不影响提交</span></h3><div class="form-grid"><label class="field"><span>这次选择最主要的原因</span><input id="choice-reason" maxlength="500" placeholder="例如：更喜欢这段路的环境"></label><label class="field"><span>你对这次选择有多确定？</span><select id="choice-confidence"><option value="">暂不填写</option><option>不太确定</option><option>比较确定</option><option>非常确定</option></select></label></div></section><div class="choice-bottom"><div>${participant.experiment.allow_neither?'<button class="neither-btn" data-action="choose" data-side="neither" aria-pressed="false">两条都不选</button>':'<span class="small-text">请按你的实际偏好选择一条路线</span>'}<p class="keyboard-tip">${participant.experiment.demo?'演示假设条件 · ':''}先选择，再提交 · 提交后无法修改</p></div><div class="button-row"><span class="saving-indicator" id="answer-status"></span><button class="btn" id="submit-answer" data-action="submit-answer" disabled>${participant.done+1===participant.total?'提交并完成':'确认，下一题'} <span>→</span></button></div></div><div id="image-error" class="notice error hidden">有街景图片未能加载。请检查服务和图片后刷新本题，避免在缺少画面时作答。</div></section>`;
  startedAt=performance.now(); visibleAt=document.hidden?0:startedAt;visibleMs=0;hiddenCount=0;
  for(const img of app.querySelectorAll('[data-route-image]')) {
    img.addEventListener('load',updateImageReadiness);
    img.addEventListener('error',()=>{ $('#image-error').classList.remove('hidden'); $('#submit-answer').disabled=true;img.dataset.failed='1'; });
  }
  updateImageReadiness();
  window.scrollTo({top:0,behavior:'instant'});
  $('.question-heading h1').setAttribute('tabindex','-1');$('.question-heading h1').focus({preventScroll:true});
}

function choose(side) {
  if(busy)return;
  selectedSide=side;
  for(const s of ['left','right']) { const el=$(`#card-${s}`);if(el)el.classList.toggle('selected',s===side); }
  for(const btn of app.querySelectorAll('[data-action="choose"]')) {btn.setAttribute('aria-pressed',btn.dataset.side===side);btn.classList.toggle('selected',btn.dataset.side===side);}
  $('#response-extra').classList.remove('hidden');
  updateImageReadiness();
}

async function submitAnswer() {
  if(busy||!selectedSide)return;
  busy=true; const btn=$('#submit-answer');btn.disabled=true;$('#answer-status').textContent='正在保存…';
  const active=visibleMs+(visibleAt?performance.now()-visibleAt:0);
  try {
    participant=await api(`/api/sessions/${participant.id}/answer`,{question_id:participant.question.id,side:selectedSide,reason:$('#choice-reason').value,confidence:$('#choice-confidence').value,active_ms:Math.round(active),hidden_count:hiddenCount});
    renderParticipant();
  } catch(error) { toast(error.message,true);btn.disabled=false;$('#answer-status').textContent='未提交，请重试'; }
  finally {busy=false;}
}

function completePage() {
  const f=participant.feedback;
  app.innerHTML=`<section class="result-page"><div class="result-top"><div class="completion-icon">✓</div><div class="eyebrow">THANK YOU FOR YOUR CHOICES</div><h1>你的每一次选择，都已记录。</h1><p>已完成 ${participant.total} 道题，感谢参与${participant.preview?'本次研究者预览':participant.experiment.demo?'本次演示体验':'本次实验'}。${participant.preview?'预览记录不会进入结果汇总。':''}</p><div class="badge-row">${pill(participant.experiment.demo)}<span class="pill gray">版本 ${participant.experiment.version}</span><span class="pill gray">记录 ${esc(participant.id.slice(0,8))}</span></div></div>${f?`<div class="feedback-grid"><div class="feedback-box"><span class="small-label">选择用时更长的路线</span><strong>${f.longer}<small> 次</small></strong><p>在时间不同的题目中</p></div><div class="feedback-box"><span class="small-label">选择用时更短的路线</span><strong>${f.shorter}<small> 次</small></strong><p>在时间不同的题目中</p></div><div class="feedback-box"><span class="small-label">等时选择 / 两条都不选</span><strong>${f.equal} / ${f.neither}</strong><p>两类情况分别计数</p></div></div><div class="reflection"><h3>回看这次骑行选择</h3><p>${f.longer?`在本次题目中，你有 ${f.longer} 次选择了用时更长的路线，对应额外时间为 ${f.extra_minutes.join('、')} 分钟。画面和题目条件也许值得你多花一点时间。`:f.shorter?'在本次题目中，你更多地保留了时间上的优势。你的选择也可能受到画面与其他条件影响。':'本次选择包含等时路线或“两条都不选”，你可以回想哪些画面与条件影响了判断。'}</p><p>这份回顾仅描述本次回答，不能推断你的固定骑行类型，也不能据此计算你愿意多骑的最大时间。</p></div>`:''}<div class="button-row"><a class="btn secondary" href="/p/${esc(code)}">返回实验说明</a><button class="text-btn" data-action="download-personal">保存本次回顾 ↓</button></div></section>`;
  window.scrollTo({top:0,behavior:'instant'});
}

// Events shared by both spaces.
app.addEventListener('input',event=>{
  const element=event.target;
  if(element.dataset.path&&config) {
    let value=element.type==='checkbox'?element.checked:element.type==='number'?Number(element.value):element.value;
    if(element.type==='number'&&element.value==='') value=null;
    setPath(config,element.dataset.path,value);markDirty();
  }
});

app.addEventListener('change',async event=>{
  const element=event.target;
  try {
    if(element.dataset.upload) {
      const file=element.files[0];if(!file)return;
      if(file.size>12*1024*1024)throw new Error('单张图片不能超过 12 MB');
      const [index,key]=element.dataset.upload.split('.');
      const label=element.closest('.upload-label');label.firstChild.textContent='正在导入…';
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取图片'));reader.readAsDataURL(file);});
      const result=await api('/api/admin/upload',{name:file.name,data});
      config.questions[Number(index)][key].image=result.image;markDirty();
      const area=$(`#upload-${index}-${key}`);let img=$('img',area);if(!img){$('.upload-placeholder',area)?.remove();img=document.createElement('img');img.alt='已导入街景';area.prepend(img);}img.src=result.image;
      label.firstChild.textContent='更换街景';toast('图片已导入，请补充来源与拍摄信息');
    }
    if(element.id==='result-version'){resultCode=element.value;await renderResults();}
    if(element.id==='import-template') {
      const file=element.files[0];if(!file)return;
      if(file.size>2*1024*1024)throw new Error('模板不能超过 2 MB');
      if(dirty&&!confirm('导入将打开一份新实验，当前未保存修改将丢失。继续吗？'))return;
      const obj=JSON.parse(await file.text());
      const result=await api('/api/admin/save',{config:obj.config||obj});
      selectedId=result.id;dirty=false;await loadAdmin();tab='design';renderAdmin();toast('模板已导入为新实验');
    }
  }catch(error){toast(error.message,true);if(element.dataset.upload){const label=element.closest('.upload-label');label.firstChild.textContent='重新选择图片';}}
});

app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if(!button||button.disabled)return;
  const action=button.dataset.action;
  try {
    if(action==='reload'){location.reload();return;}
    if(action==='zoom'){imageModal(button.dataset.image);return;}
    if(action==='choose'){choose(button.dataset.side);return;}
    if(action==='submit-answer'){await submitAnswer();return;}
    if(action==='resume') {
      const sid=stashGet(storageKey);
      try {participant=await api('/api/sessions/'+sid);renderParticipant();}
      catch(error){if(error.message.includes('不存在'))stashRemove(storageKey);throw error;}
      return;
    }
    if(action==='download-personal'){downloadJson({platform:'骑遇 RideChoice',code:participant.experiment.code,version:participant.experiment.version,record:participant.id.slice(0,8),demo:participant.experiment.demo,preview:participant.preview,total:participant.total,feedback:participant.feedback||null,note:'仅描述本次选择，不能推断最大额外骑行时间或固定偏好类型。'},'骑遇_本次选择回顾.json');return;}
    if(action==='tab'){tab=button.dataset.tab;renderAdmin();return;}
    if(action==='select-experiment') {
      if(dirty&&!confirm('当前修改尚未保存。仍要切换实验吗？'))return;
      selectedId=button.dataset.id;config=clone(currentExperiment().config);dirty=false;resultCode=null;renderAdmin();return;
    }
    if(action==='new-experiment') {
      if(dirty&&!confirm('当前修改尚未保存。仍要新建实验吗？'))return;
      const result=await api('/api/admin/save',{config:blankConfig()});selectedId=result.id;dirty=false;await loadAdmin();tab='design';renderAdmin();toast('已新建独立实验');return;
    }
    if(action==='add-question'){if(config.questions.length>=100)throw new Error('每个实验最多100题');config.questions.push(blankQuestion());markDirty();renderAdmin();return;}
    if(action==='duplicate-question'){const q=clone(config.questions[Number(button.dataset.index)]);q.id=id();config.questions.splice(Number(button.dataset.index)+1,0,q);markDirty();renderAdmin();return;}
    if(action==='delete-question'){if(config.questions.length===1)throw new Error('实验至少保留一道题');if(confirm('移除这道草稿题目？已发布版本不会改变。')){config.questions.splice(Number(button.dataset.index),1);markDirty();renderAdmin();}return;}
    if(action==='move-question'){const index=Number(button.dataset.index),next=index+Number(button.dataset.delta);[config.questions[index],config.questions[next]]=[config.questions[next],config.questions[index]];markDirty();renderAdmin();return;}
    if(action==='save'||action==='save-and-publish'){button.disabled=true;await saveDraft();if(action==='save-and-publish')tab='publish';renderAdmin();return;}
    if(action==='export-template'){downloadJson({schema:'ridechoice-v1',config},'骑遇_题目模板.json');return;}
    if(action==='publish-demo'||action==='publish-formal') {
      const formal=action==='publish-formal',reviewed=$('#publish-reviewed')?.checked;
      if(formal&&!reviewed)throw new Error('请先核对并勾选正式发布确认');
      button.disabled=true;await saveDraft(true);
      const result=await api('/api/admin/publish',{id:selectedId,demo:!formal,reviewed});
      await loadAdmin();renderAdmin();toast(`版本 ${result.number} 已发布，参与链接已生成`);return;
    }
    if(action==='open-latest') {
      const e=currentExperiment();const v=e.versions[0];
      if(!v){tab='publish';renderAdmin();toast('请先发布演示版本，再预览参与流程');return;}
      if(dirty)toast('预览显示最近发布的固定版本，当前草稿需重新发布才能生效');
      const a=document.createElement('a');a.href=`/p/${v.code}?preview=1`;a.target='_blank';a.rel='noopener';a.click();return;
    }
    if(action==='copy'){await copy(location.origin+'/p/'+button.dataset.code);return;}
    if(action==='toggle-active'){await api('/api/admin/active',{code:button.dataset.code,active:button.dataset.active==='true'});await loadAdmin(true);renderAdmin();toast('版本接收状态已更新');return;}
    if(action==='refresh-results'){await loadAdmin(true);await renderResults();toast('结果已更新');return;}
    if(action==='export-csv'){download(`/api/admin/versions/${resultCode}/export`);return;}
    if(action==='snapshot'){download(`/api/admin/versions/${resultCode}/snapshot`);return;}
    if(action==='backup'){download('/api/admin/backup');return;}
  }catch(error){toast(error.message,true);button.disabled=false;}
});

document.addEventListener('visibilitychange',()=>{
  if(!participant||participant.complete)return;
  if(document.hidden){if(visibleAt)visibleMs+=performance.now()-visibleAt;visibleAt=0;hiddenCount++;}
  else visibleAt=performance.now();
});
window.addEventListener('beforeunload',event=>{if(isAdmin&&dirty){event.preventDefault();event.returnValue='';}});
$('#help-button').addEventListener('click',()=>$('#help-dialog').showModal());
for(const dialog of document.querySelectorAll('dialog')) {
  $('.dialog-close',dialog).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
}

(async()=>{
  try {
    if(isAdmin){await api('/api/admin/bootstrap');await loadAdmin();renderAdmin();}
    else {experiment=await api('/api/experiments/'+encodeURIComponent(code));welcome();}
  }catch(error){fail(error);}
})();
}
