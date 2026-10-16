'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const catalog = $('#catalog'), dialog = $('#task-dialog'), stage = $('#task-stage');
  let mode = 'choice', current = null, answers = [], questionIndex = 0, startedAt = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const shuffle = window.RIDECHOICE_SHUFFLE;
  const bank = window.RIDECHOICE_BANK;
  const formatNames = {single:'单选 · 单图观察',multi:'多选 · 要素提取',text:'简答 · 信息记录',detour:'单选 · 时间取舍',compare:'街景 · 多图选择',scale:'单维 · 量表评分',matrix:'多维 · 4 项评分'};

  function drawCatalog() {
    const tasks = bank.filter(task => task.mode === mode);
    catalog.innerHTML = tasks.map((task, index) => {
      const first = task.questions[0];
      const poster = first.scene || first.scenes?.[0] || bank[0].questions[index % 6].scene;
      const countLabel = task.kind === 'multi' ? '可多选' : task.kind === 'text' ? '填写简答' : task.kind === 'matrix' ? '每题 4 项' : task.kind === 'compare' ? `${first.scenes.length} 张候选图` : task.kind === 'scale' ? `${first.min}—${first.max} 分` : '每题 1 项';
      return `<article class="task-card ${mode === 'rating' ? 'rating-card' : ''}">
        <div class="card-image ${index % 2 ? 'image-alt' : ''}"><img src="${esc(poster.image)}" alt="街景演示图" loading="lazy"><span class="card-index">${String(index + 1).padStart(2, '0')}</span><span class="image-caption">街景演示素材</span></div>
        <div class="card-body"><div class="card-kicker">${esc(task.formatLabel || formatNames[task.kind])}</div><h3>${esc(task.title)}</h3><p>${esc(task.description)}</p><div class="card-meta"><span>题库 ${task.questions.length} 题</span><i></i><span>随机抽 ${task.sampleSize} 题</span><span class="card-arrow">↗</span></div><div class="card-detail">${countLabel}</div><button class="card-action" data-task="${esc(task.id)}">打开体验 <span>→</span></button></div>
      </article>`;
    }).join('');
    catalog.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => openTask(button.dataset.task)));
  }

  function openTask(id) {
    const task = bank.find(item => item.id === id);
    if (!task) return;
    const drawn = shuffle(task.questions).slice(0, task.sampleSize).map(question => ({
      ...question,
      options: question.options ? shuffle(question.options) : undefined,
      scenes: question.scenes ? shuffle(question.scenes) : undefined
    }));
    current = {...task, questions: drawn};
    answers = []; questionIndex = -1; startedAt = Date.now();
    renderIntro();
    if (!dialog.open) dialog.showModal();
  }

  function renderIntro() {
    stage.innerHTML = `<div class="task-intro"><div class="eyebrow">PREVIEW EXPERIENCE · ${current.mode === 'choice' ? 'CHOICE' : 'RATING'}</div><h2>${esc(current.title)}</h2><p>${esc(current.description)}</p><div class="intro-stats"><span><b>${current.questions.length}</b> 道随机题</span><span><b>${esc(current.formatLabel)}</b> 作答形式</span><span><b>仅演示</b> 不收集回答</span></div><div class="intro-disclaimer"><b>体验说明</b><p>题目、题序和候选图会随机安排。回答只用于体验交互，完成后不会保存到服务器或上传到 Netlify。</p></div><button class="button primary" id="begin-task">开始体验 <span>→</span></button></div>`;
    $('#begin-task').addEventListener('click', () => { questionIndex = 0; renderQuestion(); });
  }

  function renderQuestion() {
    const question = current.questions[questionIndex];
    const progress = Math.round(questionIndex / current.questions.length * 100);
    const imageMarkup = scene => `<div class="question-image"><img src="${esc(scene.image)}" alt="${esc(scene.name)}"><span>${esc(scene.name)}</span></div>`;
    let response = '';
    if (current.kind === 'single' || current.kind === 'detour') {
      response = `<div class="answer-options">${question.options.map((option, i) => `<button class="answer-option" data-answer="${esc(option)}"><span>${String.fromCharCode(65 + i)}</span>${esc(option)}<b>↗</b></button>`).join('')}</div>`;
    } else if (current.kind === 'multi') {
      response = `<div class="response-hint">选择所有适用项，可多选</div><div class="multi-options">${question.options.map((option, i) => `<button class="multi-option" data-toggle="${esc(option)}" aria-pressed="false"><span>${String(i + 1).padStart(2, '0')}</span>${esc(option)}<b>＋</b></button>`).join('')}</div><p class="answer-error" id="multi-error" hidden>至少选择一项再继续。</p><button class="button primary answer-submit" id="submit-multi" disabled>确认本题 <span>→</span></button>`;
    } else if (current.kind === 'text') {
      response = `<label class="response-hint" for="open-answer">用一两句话写下你的观察</label><textarea id="open-answer" class="open-answer" maxlength="180" placeholder="例如：我注意到……"></textarea><div class="text-meta"><span>最多 180 字 · 演示答案不会保存</span><span id="text-count">0 / 180</span></div><p class="answer-error" id="text-error" hidden>请先填写一条观察，再继续。</p><button class="button primary answer-submit" id="submit-text">确认本题 <span>→</span></button>`;
    } else if (current.kind === 'compare') {
      response = `<div class="compare-options">${question.scenes.map((scene, i) => `<button class="scene-option" data-answer="${esc(scene.id)}"><span class="candidate-no">${String.fromCharCode(65 + i)}</span>${imageMarkup(scene)}<span class="scene-select">选择这幅 <b>↗</b></span></button>`).join('')}</div>`;
    } else if (current.kind === 'scale') {
      const values = Array.from({length: question.max - question.min + 1}, (_, i) => question.min + i);
      response = `<div class="rating-labels"><span>${esc(question.low)}</span><span>${esc(question.high)}</span></div><div class="rating-options ${question.max > 5 ? 'seven-point' : ''}">${values.map(n => `<button data-answer="${n}" class="rating-option">${n}</button>`).join('')}</div><div class="scale-caption">${question.max} 点评分 · 按个人感受选择</div>`;
    } else if (current.kind === 'matrix') {
      response = `<div class="matrix-intro">1 分较低，5 分较高；骑行压力一项按“较小—较大”理解。</div><div class="matrix-rows">${question.dimensions.map(dimension => `<div class="matrix-row" data-dimension-row="${dimension.id}"><div class="matrix-label"><b>${esc(dimension.label)}</b><small>${esc(dimension.low)} <i>—</i> ${esc(dimension.high)}</small></div><div class="matrix-choice">${[1,2,3,4,5].map(score => `<button data-dimension="${dimension.id}" data-score="${score}" aria-pressed="false">${score}</button>`).join('')}</div></div>`).join('')}</div><p class="matrix-status" id="matrix-status">已完成 0 / ${question.dimensions.length} 项</p><button class="button primary answer-submit" id="submit-matrix" disabled>确认本题 <span>→</span></button>`;
    }
    const showOneImage = ['single','multi','text','detour','scale','matrix'].includes(current.kind);
    stage.innerHTML = `<div class="question-head"><div><div class="eyebrow">${current.mode === 'choice' ? '街景选择' : '街景评分'} · ${String(questionIndex + 1).padStart(2, '0')}</div><h2>${esc(current.title)}</h2></div><button class="exit-task" id="exit-task">退出体验</button></div><div class="progress-meta"><span>随机题组 · 第 ${questionIndex + 1} / ${current.questions.length} 题</span><span>${progress}%</span></div><div class="progress-track"><i style="width:${progress}%"></i></div><div class="question-prompt"><span class="prompt-number">${String(questionIndex + 1).padStart(2, '0')}</span><div><div class="eyebrow">${current.kind === 'text' ? '短句即可 · 不需要标准术语' : current.kind === 'multi' ? '按画面提取信息 · 可多选' : current.kind === 'matrix' ? '逐项选择分值 · 不需要一次完成' : '请按你的直观判断作答'}</div><h3>${esc(question.prompt)}</h3></div></div><div class="question-content ${current.kind === 'compare' ? 'comparison-content' : ''}">${showOneImage ? imageMarkup(question.scene) : ''}<div class="response-panel">${response}</div></div><div class="demo-inline"><span>演示中</span> 本页不会保存或上传答案</div>`;
    $('#exit-task').addEventListener('click', closeTask);
    if (current.kind === 'single' || current.kind === 'detour' || current.kind === 'compare' || current.kind === 'scale') {
      stage.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => submitAnswer(button.dataset.answer)));
    }
    if (current.kind === 'multi') bindMultiSelect();
    if (current.kind === 'text') bindTextAnswer();
    if (current.kind === 'matrix') bindMatrixAnswer(question);
  }

  function bindMultiSelect() {
    const selected = new Set();
    const continueButton = $('#submit-multi');
    stage.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => {
      const value = button.dataset.toggle;
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      const active = selected.has(value);
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
      button.querySelector('b').textContent = active ? '✓' : '＋';
      continueButton.disabled = selected.size === 0;
      $('#multi-error').hidden = selected.size > 0;
    }));
    continueButton.addEventListener('click', () => submitAnswer(JSON.stringify([...selected])));
  }

  function bindTextAnswer() {
    const input = $('#open-answer'), count = $('#text-count'), error = $('#text-error');
    input.addEventListener('input', () => { count.textContent = `${input.value.length} / 180`; if (input.value.trim()) error.hidden = true; });
    $('#submit-text').addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) { error.hidden = false; input.focus(); return; }
      submitAnswer(value);
    });
  }

  function bindMatrixAnswer(question) {
    const selected = {};
    stage.querySelectorAll('[data-score]').forEach(button => button.addEventListener('click', () => {
      const dimension = button.dataset.dimension;
      selected[dimension] = Number(button.dataset.score);
      stage.querySelectorAll(`[data-dimension="${dimension}"]`).forEach(choice => {
        const active = choice === button;
        choice.classList.toggle('selected', active);
        choice.setAttribute('aria-pressed', String(active));
      });
      const completed = question.dimensions.filter(item => selected[item.id] !== undefined).length;
      $('#matrix-status').textContent = `已完成 ${completed} / ${question.dimensions.length} 项`;
      $('#submit-matrix').disabled = completed !== question.dimensions.length;
    }));
    $('#submit-matrix').addEventListener('click', () => submitAnswer(JSON.stringify(selected)));
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
