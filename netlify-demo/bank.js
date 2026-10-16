'use strict';
(() => {
  const scenes = Array.from({length: 6}, (_, i) => ({
    id: `scene-${i + 1}`,
    name: `街景演示图 ${String(i + 1).padStart(2, '0')}`,
    image: `assets/scene-${i + 1}.jpg`
  }));
  const shuffle = items => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const singleQuestions = [
    '画面中更接近哪一种道路空间关系？',
    '从街景里可以辨认出怎样的骑行通行环境？',
    '如果你要描述这段道路，会优先提取哪项信息？',
    '你觉得骑行者在这幅街景中主要与谁共享道路？',
    '仅根据画面，哪项描述最贴近你观察到的场景？',
    '这段街景给你的第一印象更接近哪一项？'
  ];
  const options = ['骑行空间较独立', '与机动车混行较明显', '与行人空间交织', '仅凭画面难以判断'];
  const pairs = [[0, 1], [2, 3], [4, 5], [0, 4], [1, 3], [2, 5]];
  const triples = [[0, 2, 4], [1, 3, 5], [0, 3, 5], [1, 2, 4], [0, 1, 5], [2, 3, 4]];
  const comparisonPrompt = {
    best: '哪一幅街景最让你愿意选择这段骑行路线？',
    worst: '哪一幅街景是你最不愿意骑行的？',
    realistic: '哪一幅最符合你心目中的真实骑行场景？'
  };
  const ratingPrompt = {
    safety: '根据画面，这段道路给你的骑行安全感如何？',
    comfort: '你觉得这段道路对骑行者有多舒适？',
    stress: '设想自己在这里骑行，你预计会感到多大压力？'
  };
  const makeSingle = title => ({
    id: title, title, mode: 'choice', kind: 'single', sampleSize: 4,
    description: '观察一幅街景，并选择你认为最贴近画面的描述。',
    questions: scenes.map((scene, i) => ({id: `${title}-${i + 1}`, prompt: singleQuestions[i], scene, options: shuffle(options)}))
  });
  const makeCompare = (id, title, kind) => ({
    id, title, mode: 'choice', kind, sampleSize: 3,
    description: '比较多幅街景，按自己的直观感受选出一幅。没有标准答案。',
    questions: (kind === 'triple' ? triples : pairs).map((group, i) => ({
      id: `${id}-${i + 1}`, prompt: comparisonPrompt[id], scenes: shuffle(group.map(n => scenes[n]))
    }))
  });
  const makeRating = (id, title) => ({
    id, title, mode: 'rating', kind: 'rating', sampleSize: 4,
    description: '根据每幅街景，选择一个最符合你感受的分数。',
    questions: scenes.map((scene, i) => ({id: `${id}-${i + 1}`, prompt: ratingPrompt[id], scene}))
  });
  window.RIDECHOICE_BANK = [
    makeSingle('街景信息提取'),
    makeCompare('best', '双图比较 · 选更愿意骑的场景', 'pair'),
    makeCompare('worst', '多图比较 · 选最不愿意骑的场景', 'triple'),
    makeCompare('realistic', '场景辨识 · 选最符合真实骑行的画面', 'pair'),
    makeRating('safety', '骑行安全感评分'),
    makeRating('comfort', '骑行舒适度评分'),
    makeRating('stress', '主观骑行压力评分')
  ];
  window.RIDECHOICE_SHUFFLE = shuffle;
})();
