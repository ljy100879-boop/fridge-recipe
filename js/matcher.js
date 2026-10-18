// 레시피 매칭·정렬 로직 (PRD "추천·정렬 로직" 섹션).
// 1차 키 = 부족 재료 수, 2차 키 = 간편 점수. 1차 키가 다르면 2차 키는 보지 않는다.

// 초기 가중치. 출시 후 클릭률을 보고 조정한다.
export const WEIGHTS = { time: 0.5, difficulty: 0.3, steps: 0.2 };

export const DIFFICULTY_SCORE = { easy: 100, normal: 50, hard: 0 };
const DIFFICULTY_ORDER = { easy: 0, normal: 1, hard: 2 };

// PRD 표는 21~30분 구간 점수를 정하지 않아, 20분 이하(50)와 30분 초과(0)의 중간값을 쓴다.
export function timeScore(minutes) {
  if (minutes <= 10) return 100;
  if (minutes <= 20) return 50;
  if (minutes <= 30) return 25;
  return 0;
}

export function stepsScore(stepCount) {
  if (stepCount <= 4) return 100;
  if (stepCount <= 7) return 50;
  return 0;
}

export function easeScore(recipe) {
  const score =
    WEIGHTS.time * timeScore(recipe.time_min) +
    WEIGHTS.difficulty * DIFFICULTY_SCORE[recipe.difficulty] +
    WEIGHTS.steps * stepsScore(recipe.steps.length);
  return Math.round(score * 10) / 10;
}

// 레시피 재료를 충족/부족으로 분류한다.
// 보유 조미료·입력 재료에 있거나 선택 재료(optional)면 충족, 그 외는 부족.
export function matchRecipe(recipe, inputIds, seasoningIds) {
  const missing = [];
  const usedInputs = [];
  for (const item of recipe.ingredients) {
    if (inputIds.has(item.id)) usedInputs.push(item.id);
    else if (!seasoningIds.has(item.id) && !item.optional) missing.push(item.id);
  }
  return { recipe, missing, usedInputs, score: easeScore(recipe) };
}

const byTitle = (a, b) => a.recipe.title.localeCompare(b.recipe.title, 'ko');

// 같은 부족 재료 수 그룹 안에서의 순서.
export const SORTS = {
  // 간편 점수 → 동점이면 입력 재료를 더 많이 쓰는 레시피
  recommended: (a, b) =>
    b.score - a.score || b.usedInputs.length - a.usedInputs.length || a.recipe.time_min - b.recipe.time_min || byTitle(a, b),
  fast: (a, b) =>
    a.recipe.time_min - b.recipe.time_min || b.score - a.score || b.usedInputs.length - a.usedInputs.length || byTitle(a, b),
  easy: (a, b) =>
    DIFFICULTY_ORDER[a.recipe.difficulty] - DIFFICULTY_ORDER[b.recipe.difficulty] ||
    a.recipe.steps.length - b.recipe.steps.length ||
    a.recipe.time_min - b.recipe.time_min ||
    b.usedInputs.length - a.usedInputs.length ||
    byTitle(a, b),
};

export function passesFilters(recipe, { maxTime = null, difficulty = null, mealType = null } = {}) {
  if (maxTime != null && recipe.time_min > maxTime) return false;
  if (difficulty != null && recipe.difficulty !== difficulty) return false;
  if (mealType != null && recipe.meal_type !== mealType) return false;
  return true;
}

// 결과를 세 그룹(지금 바로 가능 / 1개만 더 / 2개 이상 부족)으로 나눠 돌려준다.
// 입력 재료를 하나도 쓰지 않는 레시피는 제외한다.
// pinnedIds("꼭 써야 하는 재료", F5)가 있으면 그 재료를 모두 쓰는 레시피만 남긴다.
export function rankRecipes(recipes, { inputIds, seasoningIds, pinnedIds = new Set(), filters = {}, sort = 'recommended' }) {
  const compare = SORTS[sort] ?? SORTS.recommended;
  const matches = [];
  for (const recipe of recipes) {
    if (!passesFilters(recipe, filters)) continue;
    const match = matchRecipe(recipe, inputIds, seasoningIds);
    if (match.usedInputs.length === 0) continue;
    if ([...pinnedIds].some((id) => !match.usedInputs.includes(id))) continue;
    matches.push(match);
  }
  matches.sort((a, b) => a.missing.length - b.missing.length || compare(a, b));

  return {
    ready: matches.filter((m) => m.missing.length === 0),
    oneMissing: matches.filter((m) => m.missing.length === 1),
    more: matches.filter((m) => m.missing.length >= 2),
  };
}
