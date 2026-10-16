'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const catalog = $('#catalog'), dialog = $('#task-dialog'), stage = $('#task-stage');
  let mode = 'choice', current = null, answers = [], questionIndex = 0, startedAt = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const shuffle = window.RIDECHOICE_SHUFFLE;
  const bank = window.RIDECHOICE_BANK;
  const toast = message => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400); };

  function drawCatalog() {
    const tasks = bank.filter(task => task.mode === mode);
    catalog.innerHTML = tasks.map((task, index) => `<article class="task-card ${mode === 'rating' ? 'rating-card' : ''}">
      <div class="card-image ${index % 2 ? 'image-alt' : ''}"><img src="${esc(index === 0 ? 'assets/scene-1.jpg' : `assets/scene-${index + 1}.jpg`)}" alt="街景演示图" loading="lazy"><span class="card-index">${String(index + 1).padStart(2, '0')}</span><span class="image-caption">街景演示素材</span></div>
      <div class="card-body"><div class="card-kicker">${mode === 'choice' ? task.kind === 'single' ? '信息提取 · 单图判断' : task.kind === 'triple' ? '场景比较 · 三图选择' : '场景比较 · 双图选择' : '感受评价 · 1—5 分'}</div><h3>${esc(task.title)}</h3><p>${esc(task.description)}</p><div class="card-meta"><span>题库 ${task.questions.length} 题</span><i></i><span>随机抽 ${task.sampleSize} 题</span><span class="card-arrow">↗</span></div><button class="card-action" data-task="${esc(task.id)}">打开体验 <span>→</span></button></div>
    </article>`).join('');
    catalog.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => openTask(button.dataset.task)));
  }

  function openTask(id) {
    const task = bank.find(item => item.id === id);
    if (!task) return;
    current = {...task, questions: shuffle(task.questions).slice(0, task.sampleSize)};
    if (current.kind !== 'single' && current.kind !== 'rating') current.questions = current.questions.map(question => ({...question, scenes: shuffle(question.scenes)}));
    answers = []; questionIndex = -1; startedAt = Date.now();
    renderIntro();
    dialog.showModal();
  }

  function renderIntro() {
    stage.innerHTML = `<div class="task-intro"><div class="eyebrow">PREVIEW EXPERIENCE · ${current.mode === 'choice' ? 'CHOICE' : 'RATING'}</div><h2>${esc(current.title)}</h2><p>${esc(current.description)}</p><div class="intro-stats"><span><b>${current.questions.length}</b> 道随机题</span><span><b>每次</b> 重新抽取</span><span><b>仅演示</b> 不收集回答</span></div><div class="intro-disclaimer"><b>体验说明</b><p>题目、题序和候选图会随机安排。完成后只会显示本次页面里的体验小结，不会将回答保存到服务器或上传到 Netlify。</p></div><button class="button primary" id="begin-task">开始体验 <span>→</span></button></div>`;
    $('#begin-task').addEventListener('click', () => { questionIndex = 0; renderQuestion(); });
  }

  function renderQuestion() {
    const question = current.questions[questionIndex];
    const progress = Math.round(questionIndex / current.questions.length * 100);
    const imageMarkup = scene => `<div class="question-image"><img src="${esc(scene.image)}" alt="${esc(scene.name)}"><span>${esc(scene.name)}</span></div>`;
    let response = '';
    if (current.kind === 'single') {
      response = `<div class="answer-options">${question.options.map((option, i) => `<button class="answer-option" data-answer="${esc(option)}"><span>${String.fromCharCode(65 + i)}</span>${esc(option)}<b>↗</b></button>`).join('')}</div>`;
    } else if (current.kind === 'rating') {
      response = `<div class="rating-labels"><span>${current.id === 'stress' ? '压力较小' : current.id === 'safety' ? '安全感较低' : '不太舒适'}</span><span>${current.id === 'stress' ? '压力较大' : current.id === 'safety' ? '安全感较高' : '非常舒适'}</span></div><div class="rating-options">${[1,2,3,4,5].map(n => `<button data-answer="${n}" class="rating-option">${n}</button>`).join('')}</div>`;
    } else {
      response = `<div class="compare-options">${question.scenes.map(scene => `<button class="scene-option" data-answer="${esc(scene.id)}">${imageMarkup(scene)}<span class="scene-select">选择这幅 <b>↗</b></span></button>`).join('')}</div>`;
    }
    stage.innerHTML = `<div class="question-head"><div><div class="eyebrow">${current.mode === 'choice' ? '街景选择' : '街景评分'} · ${String(questionIndex + 1).padStart(2, '0')}</div><h2>${esc(current.title)}</h2></div><button class="exit-task" id="exit-task">退出体验</button></div><div class="progress-meta"><span>随机题组 · 第 ${questionIndex + 1} / ${current.questions.length} 题</span><span>${progress}%</span></div><div class="progress-track"><i style="width:${progress}%"></i></div><div class="question-prompt"><span class="prompt-number">${String(questionIndex + 1).padStart(2, '0')}</span><div><div class="eyebrow">请按你的直观判断作答</div><h3>${esc(question.prompt)}</h3></div></div><div class="question-content">${current.kind === 'single' || current.kind === 'rating' ? imageMarkup(question.scene) : ''}<div class="response-panel">${response}</div></div><div class="demo-inline"><span>演示中</span> 本页不会记录或上传答案</div>`;
    $('#exit-task').addEventListener('click', closeTask);
    stage.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => submitAnswer(button.dataset.answer)));
  }

  function submitAnswer(value) {
    const question = current.questions[questionIndex];
    answers.push({question: question.id, answer: value});
    if (questionIndex + 1 < current.questions.length) { questionIndex++; renderQuestion(); }
    else renderComplete();
  }

  function renderComplete() {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const minutes = Math.floor(seconds / 60), remain = seconds % 60;
    stage.innerHTML = `<div class="complete-view"><div class="complete-mark">✓</div><div class="eyebrow">PREVIEW FINISHED</div><h2>这组体验完成了</h2><p>你刚刚完成了 <b>${answers.length}</b> 道随机题，大约用了 <b>${minutes ? `${minutes} 分 ${remain} 秒` : `${remain} 秒`}</b>。</p><div class="complete-note"><b>本次回答没有提交</b><span>所有选择只在当前页面临时显示。关闭体验后即清除，不会保存或上传。</span></div><button class="button primary" id="close-complete">回到题库 <span>→</span></button><button class="text-button" id="try-again">再随机一套</button></div>`;
    $('#close-complete').addEventListener('click', closeTask);
    $('#try-again').addEventListener('click', () => openTask(current.id));
  }

  function closeTask() { dialog.close(); current = null; answers = []; }
  $('.close').addEventListener('click', closeTask);
  dialog.addEventListener('close', () => { current = null; answers = []; });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeTask(); });
  document.querySelectorAll('.mode-tab').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
    drawCatalog();
  }));
  drawCatalog();
})();
