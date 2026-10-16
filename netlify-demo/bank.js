'use strict';
(() => {
  const scenes = Array.from({length: 100}, (_, i) => ({
    id: `damon-scene-${String(i + 1).padStart(3, '0')}`,
    name: `自采集骑行街景 ${String(i + 1).padStart(3, '0')}`,
    image: `assets/damon-${String(i + 1).padStart(3, '0')}.jpg`
  }));
  const shuffle = items => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const choiceOptions = [
    '有独立或相对独立的非机动车空间',
    '骑行者与机动车共用道路较明显',
    '骑行空间与行人活动空间交织',
    '仅凭当前画面难以判断'
  ];
  const featureOptions = [
    '非机动车道或自行车通行标识', '道路标线或空间分隔', '路侧停放车辆', '行人活动',
    '树木、绿化或遮阴', '交叉口、出入口或转弯处', '路面障碍或不平整线索', '机动车混行'
  ];
  const choicePrompts = [
    '观察这幅街景，哪一项最能概括骑行者的通行空间？',
    '从画面呈现的道路关系看，哪种描述最贴近你的判断？',
    '如果向他人介绍这段道路，你会怎样描述骑行空间？',
    '仅根据可见画面，骑行者可能面对哪种通行关系？',
    '这幅街景更像哪一类骑行环境？',
    '你认为画面中的骑行空间与周边交通是什么关系？'
  ];
  const featurePrompts = [
    '请勾选画面里能观察到的道路或骑行要素。',
    '为了记录这幅街景，你会提取哪些可见信息？可多选。',
    '哪些画面要素可能影响骑行者的通行体验？可多选。',
    '请标记你在这张图中注意到的交通环境线索。',
    '哪些因素值得在这段街景的骑行环境记录中注明？',
    '请从画面中提取与骑行相关的空间和交通要素。'
  ];
  const openPrompts = [
    '写出一个你认为最影响这幅街景骑行体验的可见线索。',
    '如果只能记录一条画面信息，你会记下什么？',
    '你会怎样用一句话描述这里的骑行环境？',
    '画面中有什么细节让你更愿意或更不愿意在此骑行？',
    '请写下你判断这段街景时首先注意到的内容。',
    '还有什么信息是你希望研究者进一步记录的？'
  ];
  const detourPrompts = [
    '如果附近有一条你觉得更舒适的路线，你最多愿意多骑多久？',
    '为了避开不喜欢的路段，你愿意增加多少骑行时间？',
    '如果另一条路线让你感觉更安心，你可以接受多骑几分钟？',
    '综合这类街景给你的感受，你愿意为更好的路线绕行多久？',
    '选择更适合自己的骑行环境时，你能接受多少额外时间？',
    '你愿意用多少额外骑行时间换取更舒适的道路？'
  ];
  const detourOptions = ['不愿增加时间', '最多 3 分钟', '最多 5 分钟', '最多 10 分钟', '15 分钟或更久'];
  const makeSceneGroups = size => {
    const randomized = shuffle(scenes);
    return Array.from({length: Math.floor(randomized.length / size)}, (_, i) => randomized.slice(i * size, (i + 1) * size));
  };
  const comparisonPrompts = {
    preferred: [
      '如果今天要骑行，你更愿意把哪一幅作为自己的路线？',
      '综合整体感受，你会优先选择哪一个场景？',
      '哪一幅更接近你愿意日常骑行的道路？',
      '如果两条路线耗时相近，你会选择哪一幅？',
      '哪一幅更能让你产生“我愿意在这里骑车”的感觉？',
      '在这组街景中，你会把哪一处列为首选？'
    ],
    leastPreferred: [
      '这几幅街景里，哪一幅是你最不愿意骑行的？',
      '如果必须避开一个场景，你会优先避开哪一幅？',
      '哪一幅最可能让你考虑改走其他路线？',
      '综合直观感受，你最不愿意在哪一幅中骑行？',
      '哪一处最不符合你对可接受骑行环境的期待？',
      '如果只能淘汰一个场景，你会选哪一幅？'
    ],
    realistic: [
      '哪一幅最符合你心目中日常真实骑行的场景？',
      '哪幅画面最像你平时会遇到的骑行环境？',
      '从真实出行的角度看，哪一幅最有熟悉感？',
      '哪一个场景最符合你对现实骑行道路的理解？',
      '如果把它作为现实街道案例，你会选哪幅？',
      '哪一幅最贴近你实际骑行时对周边环境的观察？'
    ]
  };
  const makePool = ({id, title, description, mode, kind, sampleSize, questions, formatLabel}) => ({
    id, title, description, mode, kind, sampleSize, questions, formatLabel
  });
  const makeSinglePool = () => makePool({
    id: 'choice-space', title: '骑行空间判断 · 单选', mode: 'choice', kind: 'single', formatLabel: '单选 · 单图观察', sampleSize: 4,
    description: '观察一幅街景，判断骑行空间与道路交通的关系。没有标准答案。',
    questions: scenes.map((scene, i) => ({id: `space-${i + 1}`, scene, prompt: choicePrompts[i % choicePrompts.length], options: [...choiceOptions]}))
  });
  const makeMultiPool = () => makePool({
    id: 'choice-features', title: '街景要素提取 · 多选', mode: 'choice', kind: 'multi', formatLabel: '多选 · 要素标注', sampleSize: 4,
    description: '从画面中提取道路、交通和骑行环境线索，可同时选择多项。',
    questions: scenes.map((scene, i) => ({id: `features-${i + 1}`, scene, prompt: featurePrompts[i % featurePrompts.length], options: [...featureOptions]}))
  });
  const makeTextPool = () => makePool({
    id: 'choice-observation', title: '骑行环境描述 · 简答', mode: 'choice', kind: 'text', formatLabel: '简答 · 信息提取', sampleSize: 3,
    description: '用简短文字记录你从街景中提取的信息或判断依据。',
    questions: scenes.map((scene, i) => ({id: `observation-${i + 1}`, scene, prompt: openPrompts[i % openPrompts.length]}))
  });
  const makeDetourPool = () => makePool({
    id: 'choice-detour', title: '路线取舍 · 愿意多骑几分钟？', mode: 'choice', kind: 'detour', formatLabel: '单选 · 时间取舍', sampleSize: 4,
    description: '结合街景感受，选择你对路线时间和环境品质的取舍。',
    questions: scenes.map((scene, i) => ({id: `detour-${i + 1}`, scene, prompt: detourPrompts[i % detourPrompts.length], options: [...detourOptions]}))
  });
  const makeComparePool = (id, title, formatLabel, groups) => makePool({
    id, title, mode: 'choice', kind: 'compare', formatLabel, sampleSize: 3,
    description: '比较两幅或多幅街景，按自己的直观判断选择一幅。没有标准答案。',
    questions: groups.map((group, i) => ({
      id: `${id}-${i + 1}`, prompt: comparisonPrompts[id][i % comparisonPrompts[id].length], scenes: group
    }))
  });
  const scaleSpecs = [
    {id:'safety',title:'骑行安全感',formatLabel:'5 点量表',low:'很不安全',high:'很安全',prompts:[
      '仅凭这幅街景，你会给这里的骑行安全感打几分？','想象自己沿这段道路骑行，你觉得安全感如何？',
      '综合画面中可见的空间关系，你会怎样评价骑行安全感？','这段街景给你的第一安全感印象是？',
      '从个人感受出发，你认为在此骑行有多安心？','如果 1 分代表很不安全、5 分代表很安全，你会打几分？']},
    {id:'comfort',title:'骑行舒适度',formatLabel:'5 点量表',low:'很不舒适',high:'很舒适',prompts:[
      '你觉得这段道路对骑行者有多舒适？','如果在这里骑行，你预计整体舒适度如何？',
      '从街景带来的直观感受看，你会给舒适度打几分？','这处环境是否让你愿意放松地骑行？请按舒适度评分。',
      '综合画面感受，你会怎样评价这段道路的骑行舒适度？','1 分代表很不舒适，5 分代表很舒适，你会选择几分？']},
    {id:'continuity',title:'骑行空间连续性',formatLabel:'5 点量表',low:'很不连续',high:'很连续',prompts:[
      '你认为画面所示骑行空间的连续性如何？','从这一处街景看，骑行者能否顺畅地沿道路前进？',
      '请评价你对这里骑行空间连续性的直观感受。','这幅画面让你觉得骑行路线衔接得有多自然？',
      '仅根据可见信息，你会给道路通行连续性打几分？','1 分代表很不连续，5 分代表很连续，你会打几分？']},
    {id:'stress',title:'主观骑行压力',formatLabel:'5 点量表',low:'压力很小',high:'压力很大',prompts:[
      '设想自己在这里骑行，你预计会感到多大压力？','这幅街景带给你的骑行紧张感有多强？',
      '如果现在需要通过这段道路，你觉得心理负担如何？','请按直观感受评价这里可能带来的骑行压力。',
      '画面中的道路环境会让你感到多紧张？','1 分代表压力很小，5 分代表压力很大，你会选几分？']},
    {id:'legibility',title:'道路信息清晰度',formatLabel:'5 点量表',low:'很难辨认',high:'非常清晰',prompts:[
      '你能否快速看懂这段道路的通行空间？','画面中的道路边界和空间关系清楚吗？',
      '请评价这幅街景对骑行者的空间指引是否清晰。','从画面上辨认可骑行区域，对你来说有多容易？',
      '这段街景的道路信息是否一目了然？','1 分代表很难辨认，5 分代表非常清晰，你会打几分？']},
    {id:'appeal',title:'街景环境吸引力',formatLabel:'5 点量表',low:'不吸引',high:'很吸引',prompts:[
      '整体而言，你觉得这幅街景对骑行者有吸引力吗？','这段道路环境会让你愿意慢下来看看吗？',
      '请按个人偏好评价这处街景的环境吸引力。','如果有其他路线可选，你会多想体验这段道路？',
      '这幅画面整体上让你感到愉悦还是乏味？','1 分代表不吸引，5 分代表很吸引，你会选几分？']},
    {id:'willingness',title:'路线选择意愿',formatLabel:'7 点量表',low:'完全不愿意',high:'非常愿意',maxScore:7,prompts:[
      '如果出行目的地相同，你愿意选择这段道路骑行吗？','不考虑额外时间，你有多愿意体验这条路线？',
      '这幅街景会在多大程度上影响你选择骑行？','请评价你主动选择这类骑行环境的意愿。',
      '如果朋友约你从这里骑行，你会有多愿意参加？','1 分代表完全不愿意，7 分代表非常愿意，你会选几分？']}
  ];
  const makeScalePool = spec => makePool({
    id: `rating-${spec.id}`, title: `${spec.title} · 评分`, mode: 'rating', kind: 'scale',
    formatLabel: spec.formatLabel, sampleSize: 4, description: `围绕“${spec.title}”进行主观评价，按个人感受选择分值。`,
    questions: scenes.map((scene, i) => ({id: `${spec.id}-${i + 1}`, scene, prompt: spec.prompts[i % spec.prompts.length], min:1, max:spec.maxScore||5, low:spec.low, high:spec.high}))
  });
  const matrixDimensions = [
    {id:'safety',label:'安全感',low:'很低',high:'很高'},
    {id:'comfort',label:'舒适度',low:'很低',high:'很高'},
    {id:'continuity',label:'空间连续性',low:'很低',high:'很高'},
    {id:'stress',label:'骑行压力',low:'很小',high:'很大'}
  ];
  const matrixPrompts = [
    '请分别评价这幅街景中的四个骑行感受维度。','看完画面后，请完成下面这组快速印象评分。',
    '请按自己的第一感受，为这段道路做一个多维度评价。','综合观察街景后，请分别给各项体验打分。',
    '如果把这段道路作为一个整体，你会怎样评价以下方面？','请从四个角度记录你对当前街景的直观印象。'
  ];
  const matrixPool = makePool({
    id:'rating-matrix',title:'骑行感受 · 多维评分',mode:'rating',kind:'matrix',formatLabel:'多维 · 4 项评分',sampleSize:3,
    description:'在同一道题里分别评价安全感、舒适度、空间连续性和骑行压力。',
    questions:scenes.map((scene,i)=>({id:`matrix-${i+1}`,scene,prompt:matrixPrompts[i % matrixPrompts.length],dimensions:matrixDimensions}))
  });
  const pools = [
    makeSinglePool(), makeMultiPool(), makeTextPool(), makeDetourPool(),
    makeComparePool('preferred','双图比较 · 选更愿意骑的场景','双图 · 选偏好',makeSceneGroups(2)),
    makeComparePool('leastPreferred','三图比较 · 选最不愿意骑的场景','三图 · 选最不愿意',makeSceneGroups(3)),
    makeComparePool('realistic','场景辨识 · 选最符合真实骑行的画面','双图 · 选真实感',makeSceneGroups(2)),
    ...scaleSpecs.map(makeScalePool), matrixPool
  ];
  window.RIDECHOICE_BANK = pools;
  window.RIDECHOICE_SHUFFLE = shuffle;
})();
