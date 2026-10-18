import { createDictionary, normalize } from '../js/dictionary.js';
import { easeScore, matchRecipe, rankRecipes, stepsScore, timeScore } from '../js/matcher.js';
import { mergeRecent } from '../js/recent.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} 기대값 ${e}, 실제값 ${a}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 테스트용 최소 데이터
const R = (id, { time = 10, difficulty = 'easy', steps = 3, meal = 'rice', ings = [] } = {}) => ({
  id,
  title: id,
  time_min: time,
  difficulty,
  meal_type: meal,
  ingredients: ings.map((x) => (typeof x === 'string' ? { id: x, amount: '' } : { amount: '', ...x })),
  steps: Array.from({ length: steps }, () => ({ text: '' })),
});
const ids = (list) => list.map((m) => m.recipe.id);

// ---------- 간편 점수 ----------

test('조리시간 점수 구간', () => {
  assertEqual([10, 11, 20, 21, 30, 31].map(timeScore), [100, 50, 50, 25, 25, 0]);
});

test('단계 수 점수 구간', () => {
  assertEqual([4, 5, 7, 8].map(stepsScore), [100, 50, 50, 0]);
});

test('간편 점수 = 0.5×시간 + 0.3×난이도 + 0.2×단계', () => {
  assertEqual(easeScore(R('a', { time: 10, difficulty: 'easy', steps: 4 })), 100);
  assertEqual(easeScore(R('b', { time: 15, difficulty: 'normal', steps: 6 })), 50);
  assertEqual(easeScore(R('c', { time: 40, difficulty: 'hard', steps: 8 })), 0);
  assertEqual(easeScore(R('d', { time: 15, difficulty: 'easy', steps: 4 })), 75);
});

// ---------- 매칭 ----------

test('보유 조미료와 선택 재료는 부족 재료로 세지 않는다', () => {
  const recipe = R('r', { ings: ['egg', 'salt', { id: 'sesame', optional: true }, 'onion'] });
  const m = matchRecipe(recipe, new Set(['egg']), new Set(['salt']));
  assertEqual(m.missing, ['onion']);
  assertEqual(m.usedInputs, ['egg']);
});

test('입력 재료로 있는 선택 재료는 사용 재료로 센다', () => {
  const recipe = R('r', { ings: ['egg', { id: 'green_onion', optional: true }] });
  const m = matchRecipe(recipe, new Set(['egg', 'green_onion']), new Set());
  assertEqual(m.usedInputs, ['egg', 'green_onion']);
});

// ---------- 정렬 원칙 ----------

test('원칙 1: 재료가 다 있는 느린 레시피가 1개 부족한 빠른 레시피보다 위', () => {
  const slow = R('slow', { time: 60, difficulty: 'hard', steps: 10, ings: ['egg'] });
  const fast = R('fast', { time: 5, ings: ['egg', 'onion'] });
  const { ready, oneMissing } = rankRecipes([fast, slow], { inputIds: new Set(['egg']), seasoningIds: new Set() });
  assertEqual(ids(ready), ['slow']);
  assertEqual(ids(oneMissing), ['fast']);
});

test('원칙 2: 같은 그룹 안에서는 간편 점수 높은 순', () => {
  const a = R('a', { time: 25, ings: ['egg'] });
  const b = R('b', { time: 10, ings: ['egg'] });
  const c = R('c', { time: 15, ings: ['egg'] });
  const { ready } = rankRecipes([a, b, c], { inputIds: new Set(['egg']), seasoningIds: new Set() });
  assertEqual(ids(ready), ['b', 'c', 'a']);
});

test('동점이면 입력 재료를 더 많이 쓰는 레시피가 먼저', () => {
  const one = R('one', { ings: ['egg'] });
  const two = R('two', { ings: ['egg', 'rice'] });
  const { ready } = rankRecipes([one, two], { inputIds: new Set(['egg', 'rice']), seasoningIds: new Set() });
  assertEqual(ids(ready), ['two', 'one']);
});

test('2개 이상 부족 그룹도 부족 재료 수가 적은 순', () => {
  const miss3 = R('miss3', { time: 5, ings: ['egg', 'a', 'b', 'c'] });
  const miss2 = R('miss2', { time: 60, ings: ['egg', 'a', 'b'] });
  const { more } = rankRecipes([miss3, miss2], { inputIds: new Set(['egg']), seasoningIds: new Set() });
  assertEqual(ids(more), ['miss2', 'miss3']);
});

test('입력 재료를 하나도 쓰지 않는 레시피는 제외', () => {
  const unrelated = R('unrelated', { ings: ['salt'] });
  const result = rankRecipes([unrelated], { inputIds: new Set(['egg']), seasoningIds: new Set(['salt']) });
  assertEqual(result.ready.length + result.oneMissing.length + result.more.length, 0);
});

test('꼭 써야 하는 재료 핀: 그 재료를 안 쓰는 레시피 제외', () => {
  const withKimchi = R('k', { ings: ['egg', 'kimchi'] });
  const withoutKimchi = R('e', { ings: ['egg'] });
  const { ready } = rankRecipes([withKimchi, withoutKimchi], {
    inputIds: new Set(['egg', 'kimchi']), seasoningIds: new Set(), pinnedIds: new Set(['kimchi']),
  });
  assertEqual(ids(ready), ['k']);
});

test('필터: 시간·난이도·식사 유형', () => {
  const list = [
    R('quick-rice', { time: 10, meal: 'rice', ings: ['egg'] }),
    R('slow-rice', { time: 25, meal: 'rice', ings: ['egg'] }),
    R('quick-noodle', { time: 10, meal: 'noodle', ings: ['egg'] }),
    R('hard-rice', { time: 10, difficulty: 'hard', meal: 'rice', ings: ['egg'] }),
  ];
  const opts = { inputIds: new Set(['egg']), seasoningIds: new Set() };
  assertEqual(ids(rankRecipes(list, { ...opts, filters: { maxTime: 20 } }).ready).sort(), ['hard-rice', 'quick-noodle', 'quick-rice']);
  assertEqual(ids(rankRecipes(list, { ...opts, filters: { mealType: 'noodle' } }).ready), ['quick-noodle']);
  assertEqual(ids(rankRecipes(list, { ...opts, filters: { difficulty: 'hard' } }).ready), ['hard-rice']);
});

test('빠른 순 / 쉬운 순 정렬', () => {
  const a = R('a', { time: 5, difficulty: 'normal', steps: 3, ings: ['egg'] });
  const b = R('b', { time: 12, difficulty: 'easy', steps: 5, ings: ['egg'] });
  const opts = { inputIds: new Set(['egg']), seasoningIds: new Set() };
  assertEqual(ids(rankRecipes([b, a], { ...opts, sort: 'fast' }).ready), ['a', 'b']);
  assertEqual(ids(rankRecipes([a, b], { ...opts, sort: 'easy' }).ready), ['b', 'a']);
});

// ---------- 동의어 사전 ----------

const dict = createDictionary([
  { id: 'egg', name: '계란', aliases: ['달걀'], type: 'ingredient', substitutes: [] },
  { id: 'green_onion', name: '대파', aliases: ['파'], type: 'ingredient', substitutes: [] },
  { id: 'onion', name: '양파', aliases: [], type: 'ingredient', substitutes: [] },
  { id: 'pork', name: '돼지고기', aliases: ['삼겹살'], type: 'ingredient', substitutes: [] },
  { id: 'soy_sauce', name: '간장', aliases: ['진간장'], type: 'seasoning', category: '기본', substitutes: [] },
]);

test('동의어 정규화: 달걀 = 계란, 파 = 대파, 공백·대소문자 무시', () => {
  assertEqual(dict.resolve('달걀')?.id, 'egg');
  assertEqual(dict.resolve(' 계 란 ')?.id, 'egg');
  assertEqual(dict.resolve('파')?.id, 'green_onion');
  assertEqual(normalize('A b'), 'ab');
});

test('부분 일치: 돼지고기 앞다리 → 돼지고기', () => {
  assertEqual(dict.resolve('돼지고기 앞다리')?.id, 'pork');
});

test('한 글자 동의어는 부분 일치에 쓰지 않는다 (양파 ≠ 파)', () => {
  assertEqual(dict.resolve('양파')?.id, 'onion');
  assertEqual(dict.resolve('파김치'), null);
});

test('자동완성: 앞부분 일치 우선, 제외 목록 반영', () => {
  assertEqual(dict.search('파').map((x) => x.ingredient.id), ['green_onion', 'onion']);
  assertEqual(dict.search('파', { exclude: new Set(['green_onion']) }).map((x) => x.ingredient.id), ['onion']);
  assertEqual(dict.search('진간')[0].ingredient.type, 'seasoning');
});

// ---------- 최근 재료 조합 ----------

test('최근 조합: 재료를 하나씩 추가하면 직전 기록을 교체한다', () => {
  let recent = [];
  recent = mergeRecent(recent, ['egg']);
  recent = mergeRecent(recent, ['egg', 'onion']);
  recent = mergeRecent(recent, ['egg', 'onion', 'rice']);
  assertEqual(recent, [['egg', 'onion', 'rice']]);
});

test('최근 조합: 재료를 지우는 중에는 기록하지 않는다', () => {
  const recent = mergeRecent([['egg', 'onion', 'rice']], ['egg', 'onion']);
  assertEqual(recent, [['egg', 'onion', 'rice']]);
});

test('최근 조합: 새 조합은 앞에 쌓이고, 같은 조합은 맨 앞으로, 최대 5개', () => {
  let recent = [['tofu'], ['kimchi'], ['egg']];
  recent = mergeRecent(recent, ['potato']);
  assertEqual(recent, [['potato'], ['tofu'], ['kimchi'], ['egg']]);
  recent = mergeRecent(recent, ['kimchi']);
  assertEqual(recent[0], ['kimchi']);
  assertEqual(recent.length, 4);
  for (const id of ['a', 'b', 'c', 'd']) recent = mergeRecent(recent, [id]);
  assertEqual(recent.length, 5);
  assertEqual(recent[0], ['d']);
});

test('최근 조합: 순서만 다른 같은 조합은 중복으로 보고, 빈 조합은 무시', () => {
  assertEqual(mergeRecent([['rice', 'egg'], ['tofu']], ['egg', 'rice']), [['egg', 'rice'], ['tofu']]);
  assertEqual(mergeRecent([['tofu']], []), [['tofu']]);
});

// ---------- 실제 데이터 시나리오 ----------

test('PRD 대표 시나리오: 기본 조미료 + 계란·양파·밥 → 계란볶음밥이 맨 위', async () => {
  const [ingredients, recipes] = await Promise.all([
    fetch('../data/ingredients.json').then((r) => r.json()),
    fetch('../data/recipes.json').then((r) => r.json()),
  ]);
  const realDict = createDictionary(ingredients);
  const inputIds = new Set(['계란', '양파', '밥'].map((w) => realDict.resolve(w).id));
  const seasoningIds = new Set(['salt', 'sugar', 'pepper', 'soy_sauce', 'cooking_oil']);
  const { ready, oneMissing } = rankRecipes(recipes, { inputIds, seasoningIds });
  assertEqual(ready[0]?.recipe.id, 'egg-fried-rice', '맨 위 레시피');
  assert(oneMissing.length > 0, '1개 부족 그룹이 비어 있음');
  assert(oneMissing.every((m) => m.missing.length === 1), '1개 부족 그룹에 다른 레시피가 섞임');
});

// ---------- 실행 ----------

const out = document.getElementById('out');
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    out.insertAdjacentHTML('beforeend', `<li class="pass">✔ ${name}</li>`);
  } catch (err) {
    failed += 1;
    out.insertAdjacentHTML('beforeend', `<li class="fail">✘ ${name}<br><small>${err.message}</small></li>`);
  }
}
const summary = document.getElementById('summary');
summary.textContent = failed ? `실패 ${failed} / 전체 ${tests.length}` : `전체 통과 (${tests.length}개)`;
summary.className = failed ? 'fail' : 'pass';
document.body.dataset.result = failed ? 'fail' : 'pass';
