import { createDictionary } from './dictionary.js';
import { matchRecipe, rankRecipes, SORTS } from './matcher.js';
import { mergeRecent } from './recent.js';
import {
  loadFavorites, loadRecentInputs, loadSeasonings, saveFavorites, saveRecentInputs, saveSeasonings,
} from './storage.js';

const BASIC_SEASONINGS = ['salt', 'sugar', 'pepper', 'soy_sauce', 'cooking_oil'];
const SEASONING_CATEGORIES = ['기본', '한식', '양식·기타'];
const QUICK_INGREDIENTS = ['egg', 'onion', 'potato', 'tofu', 'kimchi', 'rice', 'green_onion', 'ham'];
const CUSTOM_PREFIX = 'custom:';

const DIFFICULTY_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const SORT_OPTIONS = [['recommended', '추천순'], ['fast', '빠른 순'], ['easy', '쉬운 순']];
const TIME_OPTIONS = [[null, '전체'], [10, '10분 이하'], [20, '20분 이하'], [30, '30분 이하']];
const DIFFICULTY_OPTIONS = [[null, '전체'], ['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']];
const MEAL_OPTIONS = [[null, '전체'], ['rice', '밥'], ['noodle', '면'], ['side', '반찬'], ['snack', '간식']];
const SHOPPING_SEARCH_URL = 'https://search.shopping.naver.com/search/all?query=';
// 다른 사이트의 레시피·사진은 복제하지 않고 검색 결과로만 연결한다 (PRD 저작권 원칙).
const MORE_RECIPE_LINKS = [
  ['▶ 유튜브 영상', (title) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} 레시피`)}`],
  ['📖 만개의레시피', (title) => `https://www.10000recipe.com/recipe/list.html?q=${encodeURIComponent(title)}`],
];

const MOBILE = matchMedia('(max-width: 767px)');

const $ = (id) => document.getElementById(id);
const els = {
  seasoningPanel: document.querySelector('.seasoning-panel'),
  seasoningToggle: $('seasoning-toggle'),
  seasoningCount: $('seasoning-count'),
  seasoningGroups: $('seasoning-groups'),
  selectBasic: $('select-basic'),
  customSeasoningForm: $('custom-seasoning-form'),
  customSeasoningInput: $('custom-seasoning-input'),
  ingredientPanel: $('ingredient-panel'),
  clearInputs: $('clear-inputs'),
  pinHint: $('pin-hint'),
  inputChips: $('input-chips'),
  input: $('ingredient-input'),
  suggestions: $('suggestions'),
  quickChips: $('quick-chips'),
  sortControl: $('sort-control'),
  timeFilter: $('time-filter'),
  difficultyFilter: $('difficulty-filter'),
  mealFilter: $('meal-filter'),
  viewTabs: $('view-tabs'),
  favCount: $('fav-count'),
  toolbar: $('toolbar'),
  resultGroups: $('result-groups'),
  detail: $('detail'),
  detailBackdrop: $('detail-backdrop'),
  toast: $('toast'),
};

let dict;
let recipes = [];
let recipeById = new Map();

const state = {
  seasonings: new Set(),
  inputs: [], // 입력 순서 유지. 사전에 없는 재료는 'custom:이름'
  pinned: new Set(), // "꼭 써야 하는 재료" (이번 방문 동안만 유지)
  favorites: new Set(),
  recent: [], // 최근 재료 조합 (id 배열의 배열, 최신이 앞)
  view: 'search', // 'search' | 'favorites'
  filters: { maxTime: null, difficulty: null, mealType: null },
  sort: 'recommended',
  showMore: false,
  openRecipeId: null,
};

let suggestionItems = [];
let activeSuggestion = -1;

// ---------- 유틸 ----------

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function isCustom(id) {
  return id.startsWith(CUSTOM_PREFIX);
}

function nameOf(id) {
  if (isCustom(id)) return id.slice(CUSTOM_PREFIX.length);
  return dict.get(id)?.name ?? id;
}

// 받침 유무에 따라 조사를 고른다. 예: josa('간장', '은', '는') → '간장은'
function particle(word, withBatchim, withoutBatchim) {
  const code = word.charCodeAt(word.length - 1);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return hasBatchim ? withBatchim : withoutBatchim;
}

function josa(word, withBatchim, withoutBatchim) {
  return word + particle(word, withBatchim, withoutBatchim);
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m && s) return `${m}분 ${s}초`;
  return m ? `${m}분` : `${s}초`;
}

function formatClock(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

// ---------- 상태 변경 ----------

function setSeasoning(id, on) {
  if (on) state.seasonings.add(id);
  else state.seasonings.delete(id);
  saveSeasonings(state.seasonings);
}

function addIngredient(ing) {
  if (ing.type === 'seasoning') {
    if (!state.seasonings.has(ing.id)) setSeasoning(ing.id, true);
    showToast(`${josa(ing.name, '은', '는')} 조미료라서 조미료 목록에 체크했어요.`);
    renderSeasonings();
  } else if (!state.inputs.includes(ing.id)) {
    state.inputs.push(ing.id);
  }
}

function addFromText(text) {
  for (const part of text.split(/[,，]/)) {
    const word = part.trim();
    if (!word) continue;
    const ing = dict.resolve(word);
    if (ing) {
      addIngredient(ing);
    } else {
      const id = CUSTOM_PREFIX + word;
      if (!state.inputs.includes(id)) state.inputs.push(id);
      showToast(`${josa(word, '은', '는')} 재료 사전에 없어서 검색에 반영되지 않아요.`);
    }
  }
  update();
}

function removeIngredient(id) {
  state.inputs = state.inputs.filter((x) => x !== id);
  state.pinned.delete(id);
  update();
}

function togglePin(id) {
  if (state.pinned.has(id)) state.pinned.delete(id);
  else state.pinned.add(id);
  state.showMore = false;
  renderInputs();
  renderResults();
}

function setInputs(ids) {
  state.inputs = [...ids];
  state.pinned.clear();
  update();
}

function toggleFavorite(id) {
  const on = !state.favorites.has(id);
  if (on) state.favorites.add(id);
  else state.favorites.delete(id);
  saveFavorites(state.favorites);
  showToast(on ? '즐겨찾기에 저장했어요.' : '즐겨찾기에서 뺐어요.');
  // 상세 창의 타이머가 초기화되지 않도록 다시 그리지 않고 버튼만 바꾼다.
  els.detail.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach(renderFavButtonState);
  renderViewTabs();
  renderResults();
}

// 재료 입력이 바뀌면 검색 화면으로 돌아가고, 최근 조합에 기록한다.
function update() {
  state.showMore = false;
  state.view = 'search';
  state.recent = mergeRecent(state.recent, state.inputs.filter((id) => !isCustom(id)));
  saveRecentInputs(state.recent);
  renderInputs();
  renderViewTabs();
  renderResults();
}

// ---------- 조미료 ----------

function seasoningChip(id, label) {
  const on = state.seasonings.has(id);
  return `<button type="button" class="chip toggle" aria-pressed="${on}" data-seasoning="${esc(id)}">
    <span class="check" aria-hidden="true">${on ? '✓' : '+'}</span>${esc(label)}</button>`;
}

function renderSeasonings() {
  const groups = SEASONING_CATEGORIES.map((category) => {
    const chips = dict.seasonings
      .filter((s) => s.category === category)
      .map((s) => seasoningChip(s.id, s.name))
      .join('');
    return `<div class="seasoning-group"><h3>${esc(category)}</h3><div class="chip-row">${chips}</div></div>`;
  });
  const customIds = [...state.seasonings].filter(isCustom);
  if (customIds.length) {
    const chips = customIds.map((id) => seasoningChip(id, nameOf(id))).join('');
    groups.push(`<div class="seasoning-group"><h3>직접 추가</h3><div class="chip-row">${chips}</div></div>`);
  }
  els.seasoningGroups.innerHTML = groups.join('');

  const count = [...state.seasonings].length;
  els.seasoningCount.textContent = count ? `${count}개 선택` : '선택 안 함';
  const allBasic = BASIC_SEASONINGS.every((id) => state.seasonings.has(id));
  els.selectBasic.textContent = allBasic ? '기본 조미료 선택 해제' : '기본 조미료 전체 선택';
}

function setSeasoningPanelOpen(open) {
  const effective = open || !MOBILE.matches; // 태블릿·컴퓨터에서는 항상 펼침
  els.seasoningPanel.classList.toggle('collapsed', !effective);
  els.seasoningToggle.setAttribute('aria-expanded', String(effective));
  els.seasoningToggle.tabIndex = MOBILE.matches ? 0 : -1;
}

// ---------- 재료 입력 ----------

function renderInputs() {
  els.inputChips.innerHTML = state.inputs
    .map((id) => {
      const name = nameOf(id);
      if (isCustom(id)) {
        return `<li class="chip input-chip unknown" title="재료 사전에 없어 검색에 반영되지 않아요">
          <span>${esc(name)} <small>(사전에 없음)</small></span>
          <button type="button" class="chip-remove" data-remove="${esc(id)}" aria-label="${esc(name)} 삭제">×</button></li>`;
      }
      const pinned = state.pinned.has(id);
      return `<li class="chip input-chip${pinned ? ' pinned' : ''}">
        <button type="button" class="chip-pin" data-pin="${esc(id)}" aria-pressed="${pinned}" aria-label="${esc(name)} 꼭 쓰기">📌</button>
        <span>${esc(name)}${pinned ? ' <small>꼭</small>' : ''}</span>
        <button type="button" class="chip-remove" data-remove="${esc(id)}" aria-label="${esc(name)} 삭제">×</button></li>`;
    })
    .join('');
  els.inputChips.hidden = state.inputs.length === 0;
  els.clearInputs.hidden = state.inputs.length < 2;
  els.pinHint.hidden = !state.inputs.some((id) => !isCustom(id)) || state.pinned.size > 0;

  els.quickChips.innerHTML = QUICK_INGREDIENTS.filter((id) => !state.inputs.includes(id))
    .map((id) => `<button type="button" class="chip quick" data-quick="${id}">+ ${esc(nameOf(id))}</button>`)
    .join('');
}

function renderSuggestions() {
  const query = els.input.value.trim();
  suggestionItems = query ? dict.search(query, { exclude: new Set(state.inputs) }) : [];
  activeSuggestion = suggestionItems.length ? 0 : -1;

  if (!suggestionItems.length) {
    els.suggestions.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
    els.input.removeAttribute('aria-activedescendant');
    return;
  }
  els.suggestions.innerHTML = suggestionItems
    .map(({ ingredient, matched }, i) => {
      const alias = matched !== ingredient.name ? `<span class="alias">${esc(matched)}</span>` : '';
      const tag = ingredient.type === 'seasoning'
        ? `<span class="tag">조미료${state.seasonings.has(ingredient.id) ? ' · 체크됨' : ''}</span>`
        : '';
      return `<li role="option" id="sug-${i}" data-index="${i}">${esc(ingredient.name)}${alias}${tag}</li>`;
    })
    .join('');
  els.suggestions.hidden = false;
  els.input.setAttribute('aria-expanded', 'true');
  highlightSuggestion();
}

function highlightSuggestion() {
  [...els.suggestions.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === activeSuggestion)));
  if (activeSuggestion >= 0) {
    els.input.setAttribute('aria-activedescendant', `sug-${activeSuggestion}`);
    els.suggestions.children[activeSuggestion]?.scrollIntoView({ block: 'nearest' });
  }
}

function hideSuggestions() {
  suggestionItems = [];
  activeSuggestion = -1;
  els.suggestions.hidden = true;
  els.input.setAttribute('aria-expanded', 'false');
  els.input.removeAttribute('aria-activedescendant');
}

function commitSuggestion(index) {
  const item = suggestionItems[index];
  if (!item) return;
  addIngredient(item.ingredient);
  els.input.value = '';
  hideSuggestions();
  update();
}

function onInput() {
  const value = els.input.value;
  if (/[,，]/.test(value)) {
    // 쉼표 앞부분은 확정하고, 마지막 조각만 입력창에 남긴다.
    const parts = value.split(/[,，]/);
    els.input.value = parts.pop();
    addFromText(parts.join(','));
  }
  renderSuggestions();
}

function onInputKeydown(e) {
  if (e.isComposing) return; // 한글 조합 중 엔터는 무시해야 마지막 글자가 중복되지 않는다
  const open = !els.suggestions.hidden;
  if (e.key === 'ArrowDown' && open) {
    e.preventDefault();
    activeSuggestion = (activeSuggestion + 1) % suggestionItems.length;
    highlightSuggestion();
  } else if (e.key === 'ArrowUp' && open) {
    e.preventDefault();
    activeSuggestion = (activeSuggestion - 1 + suggestionItems.length) % suggestionItems.length;
    highlightSuggestion();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (open && activeSuggestion >= 0) {
      commitSuggestion(activeSuggestion);
    } else if (els.input.value.trim()) {
      addFromText(els.input.value);
      els.input.value = '';
      hideSuggestions();
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  } else if (e.key === 'Backspace' && !els.input.value && state.inputs.length) {
    removeIngredient(state.inputs[state.inputs.length - 1]);
  }
}

// ---------- 결과 ----------

function segmented(container, options, current, key) {
  container.innerHTML = options
    .map(([value, label]) => `<button type="button" class="seg" data-key="${key}" data-value="${value ?? ''}" aria-pressed="${value === current}">${esc(label)}</button>`)
    .join('');
}

function renderControls() {
  segmented(els.sortControl, SORT_OPTIONS, state.sort, 'sort');
  segmented(els.timeFilter, TIME_OPTIONS, state.filters.maxTime, 'maxTime');
  segmented(els.difficultyFilter, DIFFICULTY_OPTIONS, state.filters.difficulty, 'difficulty');
  segmented(els.mealFilter, MEAL_OPTIONS, state.filters.mealType, 'mealType');
}

function recipeMeta(recipe) {
  return `<span class="meta-item"><span aria-hidden="true">⏱</span> ${recipe.time_min}분</span>
    <span class="diff diff-${recipe.difficulty}">${DIFFICULTY_LABEL[recipe.difficulty]}</span>
    <span class="meta-item">${recipe.steps.length}단계</span>`;
}

function thumb(recipe, className) {
  return recipe.image
    ? `<div class="${className}"><img src="${esc(recipe.image)}" alt="" loading="lazy"></div>`
    : `<div class="${className}" aria-hidden="true">${esc(recipe.emoji ?? '🍽️')}</div>`;
}

// 카드용(하트 아이콘)과 상세용(글자 포함) 두 모양이 있다. data-style로 구분해 상태만 바꿔 그린다.
function favButton(recipe, style) {
  return `<button type="button" class="fav-btn fav-${style}" data-fav="${esc(recipe.id)}" data-style="${style}"
    aria-label="${esc(recipe.title)} 즐겨찾기"></button>`;
}

function renderFavButtonState(button) {
  const on = state.favorites.has(button.dataset.fav);
  button.setAttribute('aria-pressed', String(on));
  button.textContent = button.dataset.style === 'label' ? (on ? '♥ 저장됨' : '♡ 즐겨찾기') : on ? '♥' : '♡';
}

function card(match) {
  const { recipe, missing, usedInputs } = match;
  const missingLine = missing.length
    ? `<p class="line missing-line"><span class="line-label">부족</span> ${esc(missing.map(nameOf).join(', '))}</p>`
    : `<p class="line ready-line"><span class="line-label">재료</span> 모두 있음</p>`;
  const usedLine = usedInputs.length
    ? `<p class="line"><span class="line-label">사용</span> ${esc(usedInputs.map(nameOf).join(', '))}</p>`
    : '';
  return `<li class="card-item"><button type="button" class="card" data-recipe="${esc(recipe.id)}">
    ${thumb(recipe, 'thumb')}
    <div class="card-body">
      <h3 class="card-title">${esc(recipe.title)}</h3>
      <p class="meta">${recipeMeta(recipe)}</p>
      ${usedLine}
      ${missingLine}
    </div></button>${favButton(recipe, 'icon')}</li>`;
}

function renderViewTabs() {
  els.viewTabs.querySelectorAll('[data-view]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  });
  els.favCount.textContent = state.favorites.size ? `${state.favorites.size}` : '';
}

function welcome() {
  const recent = state.recent.length
    ? `<div class="recent">
        <h3>최근 입력한 재료</h3>
        <div class="recent-list">${state.recent
          .map((combo, i) => `<button type="button" class="chip recent-chip" data-recent="${i}">${esc(combo.map(nameOf).join(' · '))}</button>`)
          .join('')}</div>
      </div>`
    : '';
  return `<div class="empty welcome">
    <p class="empty-emoji" aria-hidden="true">🥚🧅🍚</p>
    <h2>냉장고에 뭐가 있나요?</h2>
    <p>재료를 입력하면 <strong>그 재료만으로 만들 수 있는 레시피</strong>부터 보여드려요.</p>
    <button type="button" class="btn btn-primary" data-example="egg,onion,rice">예시로 해보기: 계란 · 양파 · 밥</button>
    ${recent}
  </div>`;
}

// 즐겨찾기는 지금 입력한 재료 기준으로 부족 재료가 적은 순 → 추천순으로 보여준다.
function renderFavorites() {
  const inputIds = new Set(state.inputs.filter((id) => !isCustom(id)));
  const matches = [...state.favorites]
    .map((id) => recipeById.get(id))
    .filter(Boolean)
    .map((recipe) => matchRecipe(recipe, inputIds, state.seasonings))
    .sort((a, b) => a.missing.length - b.missing.length || SORTS.recommended(a, b));

  els.resultGroups.innerHTML = matches.length
    ? group('group-fav', '즐겨찾기', inputIds.size ? '지금 입력한 재료로 만들기 쉬운 순서예요.' : '', matches)
    : `<div class="empty">
        <p class="empty-emoji" aria-hidden="true">♡</p>
        <h2>아직 즐겨찾기한 레시피가 없어요</h2>
        <p>레시피 카드나 상세 화면의 ♡를 눌러 저장해 보세요.</p>
      </div>`;
}

function group(className, title, desc, matches) {
  return `<section class="group ${className}">
    <h2 class="group-title">${title} <span class="count">${matches.length}개</span></h2>
    ${desc ? `<p class="group-desc">${desc}</p>` : ''}
    <ul class="cards">${matches.map(card).join('')}</ul></section>`;
}

function hasActiveFilters() {
  return Object.values(state.filters).some((v) => v != null);
}

function renderResults() {
  renderResultGroups();
  els.resultGroups.querySelectorAll('[data-fav]').forEach(renderFavButtonState);
}

function renderResultGroups() {
  const knownInputs = state.inputs.filter((id) => !isCustom(id));
  els.toolbar.hidden = state.view !== 'search' || knownInputs.length === 0;

  if (state.view === 'favorites') {
    renderFavorites();
    return;
  }

  if (!knownInputs.length) {
    els.resultGroups.innerHTML = welcome();
    return;
  }

  const { ready, oneMissing, more } = rankRecipes(recipes, {
    inputIds: new Set(knownInputs),
    seasoningIds: state.seasonings,
    pinnedIds: state.pinned,
    filters: state.filters,
    sort: state.sort,
  });

  const pinNames = [...state.pinned].map(nameOf);
  const pinNotice = pinNames.length
    ? `<p class="pin-notice">📌 <strong>${esc(pinNames.join(', '))}</strong>${particle(pinNames[pinNames.length - 1], '을', '를')} 꼭 쓰는 레시피만 보여드려요.</p>`
    : '';

  if (!ready.length && !oneMissing.length && !more.length) {
    let advice = '<p>다른 재료를 더 입력해 보세요.</p>';
    if (hasActiveFilters()) {
      advice = '<p>필터를 넓혀 보세요.</p><button type="button" class="btn btn-soft" data-reset-filters>필터 초기화</button>';
    } else if (state.pinned.size) {
      advice = '<p>📌 고정을 풀면 더 많은 레시피가 보여요.</p><button type="button" class="btn btn-soft" data-clear-pins>고정 모두 풀기</button>';
    }
    els.resultGroups.innerHTML = `${pinNotice}<div class="empty"><h2>조건에 맞는 레시피가 없어요</h2>${advice}</div>`;
    return;
  }

  const parts = [pinNotice];
  if (ready.length) {
    parts.push(group('group-ready', '지금 바로 가능', '', ready));
  } else {
    parts.push(`<p class="notice">지금 가진 재료만으로 만들 수 있는 레시피는 없어요. ${oneMissing.length ? '아래는 <strong>1개만 더 있으면</strong> 만들 수 있는 레시피예요.' : ''}</p>`);
  }
  if (oneMissing.length) {
    parts.push(group('group-one', '1개만 더 있으면', '부족한 재료 1개를 카드에 표시했어요.', oneMissing));
  }
  if (more.length) {
    // 앞의 두 그룹이 비었으면 빈 화면 대신 바로 펼쳐 보여준다.
    const expanded = state.showMore || (!ready.length && !oneMissing.length);
    parts.push(expanded
      ? group('group-more', '2개 이상 부족', '', more)
      : `<section class="group group-more collapsed">
          <button type="button" class="btn btn-ghost more-toggle" data-show-more aria-expanded="false">
            2개 이상 부족한 레시피 ${more.length}개 더 보기</button></section>`);
  }
  els.resultGroups.innerHTML = parts.join('');
}

// ---------- 레시피 상세 ----------

let lastFocused = null;
let wakeLock = null;
const timers = new Map();
let audioCtx = null;

function ingredientRow(item, inputIds) {
  const ing = dict.get(item.id);
  const owned = inputIds.has(item.id) || state.seasonings.has(item.id);
  const amount = `<span class="amount">${esc(item.amount)}</span>`;
  if (owned) {
    return `<li class="have"><span class="mark">✓ 있음</span><span class="ing-name">${esc(ing.name)}</span>${amount}</li>`;
  }
  if (item.optional) {
    return `<li class="optional"><span class="mark">선택</span><span class="ing-name">${esc(ing.name)}</span>${amount}</li>`;
  }
  const subs = ing.substitutes
    .map((id) => ({ id, owned: inputIds.has(id) || state.seasonings.has(id) }))
    .sort((a, b) => Number(b.owned) - Number(a.owned))
    .map(({ id, owned: o }) => `${esc(nameOf(id))}${o ? ' <strong>(있음)</strong>' : ''}`);
  const shop = `<a class="shop-link" href="${SHOPPING_SEARCH_URL}${encodeURIComponent(ing.name)}" target="_blank" rel="noopener noreferrer">🛒 ${esc(ing.name)} 장보기<span class="sr-only"> (새 창)</span></a>`;
  return `<li class="missing"><span class="mark">부족</span><span class="ing-name">${esc(ing.name)}</span>${amount}
    ${subs.length ? `<p class="subs">대체 가능: ${subs.join(', ')}</p>` : ''}
    <p class="subs">${shop}</p></li>`;
}

function renderDetail(recipe) {
  const inputIds = new Set(state.inputs.filter((id) => !isCustom(id)));
  const missingCount = recipe.ingredients.filter(
    (item) => !item.optional && !inputIds.has(item.id) && !state.seasonings.has(item.id),
  ).length;
  const status = missingCount === 0
    ? '<p class="status status-ready">지금 가진 재료로 바로 만들 수 있어요</p>'
    : `<p class="status status-missing">재료 ${missingCount}개가 부족해요</p>`;

  els.detail.innerHTML = `<div class="detail-inner">
    <div class="detail-bar">${favButton(recipe, 'label')}<button type="button" class="close" data-close aria-label="상세 닫기">×</button></div>
    ${thumb(recipe, 'detail-hero')}
    <h2 id="detail-title" class="detail-title">${esc(recipe.title)}</h2>
    <p class="meta">${recipeMeta(recipe)}${recipe.servings ? `<span class="meta-item">${esc(recipe.servings)}</span>` : ''}</p>
    ${status}
    <h3 class="section-title">재료</h3>
    <ul class="ingredient-list">${recipe.ingredients.map((item) => ingredientRow(item, inputIds)).join('')}</ul>
    <p class="note">물은 재료에서 생략했어요.</p>
    <h3 class="section-title">조리 순서</h3>
    <ol class="steps">${recipe.steps
      .map((step, i) => `<li><p>${esc(step.text)}</p>${step.timer_sec
        ? `<button type="button" class="timer" data-step="${i}" data-sec="${step.timer_sec}" aria-pressed="false">⏱ ${formatDuration(step.timer_sec)} 타이머</button>`
        : ''}</li>`)
      .join('')}</ol>
    ${recipe.tip ? `<div class="tip"><strong>💡 팁</strong><p>${esc(recipe.tip)}</p></div>` : ''}
    <h3 class="section-title">더 자세히 보기</h3>
    <div class="more-links">${MORE_RECIPE_LINKS
      .map(([label, url]) => `<a class="btn btn-ghost more-link" href="${url(recipe.title)}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (새 창)</span></a>`)
      .join('')}</div>
    <p class="note">다른 사이트의 검색 결과로 연결돼요.</p>
  </div>`;
  els.detail.querySelectorAll('[data-fav]').forEach(renderFavButtonState);
}

function openDetail(id) {
  const recipe = recipeById.get(id);
  if (!recipe) return;
  lastFocused = document.activeElement;
  state.openRecipeId = id;
  renderDetail(recipe);
  els.detail.hidden = false;
  els.detailBackdrop.hidden = false;
  document.body.classList.add('detail-open');
  els.detail.scrollTop = 0;
  els.detail.querySelector('[data-close]').focus();
  requestWakeLock();
}

function closeDetail() {
  const id = state.openRecipeId;
  if (!id) return;
  state.openRecipeId = null;
  for (const interval of timers.values()) clearInterval(interval);
  timers.clear();
  els.detail.hidden = true;
  els.detailBackdrop.hidden = true;
  document.body.classList.remove('detail-open');
  releaseWakeLock();
  // 상세에서 즐겨찾기를 바꾸면 카드 목록이 다시 그려져 원래 버튼이 사라질 수 있다.
  const target = lastFocused?.isConnected
    ? lastFocused
    : els.resultGroups.querySelector(`[data-recipe="${CSS.escape(id)}"]`);
  target?.focus?.();
}

// 조리 중 화면 꺼짐 방지. 지원하지 않는 브라우저에서는 조용히 넘어간다.
async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function beep() {
  try {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
  } catch {
    // 소리를 못 내도 진동·토스트로 알린다.
  }
}

function toggleTimer(button) {
  const step = button.dataset.step;
  const total = Number(button.dataset.sec);
  const reset = () => {
    button.textContent = `⏱ ${formatDuration(total)} 타이머`;
    button.classList.remove('running');
    button.setAttribute('aria-pressed', 'false');
  };

  if (timers.has(step)) {
    clearInterval(timers.get(step));
    timers.delete(step);
    reset();
    return;
  }

  // 사용자 클릭 시점에 만들어야 브라우저 자동재생 정책에 막히지 않는다.
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
  button.classList.remove('done');
  button.classList.add('running');
  button.setAttribute('aria-pressed', 'true');
  const end = Date.now() + total * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (left === 0) {
      clearInterval(timers.get(step));
      timers.delete(step);
      button.classList.remove('running');
      button.classList.add('done');
      button.setAttribute('aria-pressed', 'false');
      button.textContent = '✅ 완료! 다시 시작';
      beep();
      navigator.vibrate?.([200, 100, 200]);
      showToast(`${Number(step) + 1}단계 타이머가 끝났어요.`);
      return;
    }
    button.textContent = `⏸ ${formatClock(left)} 남음 · 취소`;
  };
  timers.set(step, setInterval(tick, 250));
  tick();
}

// 상세 창이 열려 있을 때 Tab 포커스가 창 밖으로 나가지 않게 한다.
function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const focusable = [...els.detail.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------- 이벤트 ----------

function bindEvents() {
  els.seasoningToggle.addEventListener('click', () => {
    setSeasoningPanelOpen(els.seasoningPanel.classList.contains('collapsed'));
  });
  MOBILE.addEventListener('change', () => setSeasoningPanelOpen(!MOBILE.matches));

  els.seasoningGroups.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-seasoning]');
    if (!chip) return;
    const id = chip.dataset.seasoning;
    setSeasoning(id, !state.seasonings.has(id));
    renderSeasonings();
    renderResults();
  });

  els.selectBasic.addEventListener('click', () => {
    const allBasic = BASIC_SEASONINGS.every((id) => state.seasonings.has(id));
    BASIC_SEASONINGS.forEach((id) => setSeasoning(id, !allBasic));
    renderSeasonings();
    renderResults();
  });

  els.customSeasoningForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const word = els.customSeasoningInput.value.trim();
    if (!word) return;
    const known = dict.resolve(word);
    if (known?.type === 'seasoning') {
      setSeasoning(known.id, true);
      showToast(`${josa(known.name, '을', '를')} 체크했어요.`);
    } else {
      setSeasoning(CUSTOM_PREFIX + word, true);
    }
    els.customSeasoningInput.value = '';
    renderSeasonings();
    renderResults();
  });

  els.input.addEventListener('input', onInput);
  els.input.addEventListener('keydown', onInputKeydown);
  els.input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
  els.input.addEventListener('focus', renderSuggestions);

  // mousedown에서 막아야 입력창 포커스가 유지된 채로 항목이 선택된다.
  els.suggestions.addEventListener('mousedown', (e) => e.preventDefault());
  els.suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('[data-index]');
    if (li) commitSuggestion(Number(li.dataset.index));
  });

  els.inputChips.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      togglePin(pin.dataset.pin);
      els.inputChips.querySelector(`[data-pin="${CSS.escape(pin.dataset.pin)}"]`)?.focus();
      return;
    }
    const btn = e.target.closest('[data-remove]');
    if (btn) {
      removeIngredient(btn.dataset.remove);
      els.input.focus();
    }
  });

  els.clearInputs.addEventListener('click', () => {
    setInputs([]);
    els.input.focus();
  });

  els.viewTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (!tab || tab.dataset.view === state.view) return;
    state.view = tab.dataset.view;
    renderViewTabs();
    renderResults();
  });

  els.quickChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    addIngredient(dict.get(btn.dataset.quick));
    update();
  });

  els.toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    const { key, value } = btn.dataset;
    if (key === 'sort') state.sort = value;
    else if (key === 'maxTime') state.filters.maxTime = value ? Number(value) : null;
    else state.filters[key] = value || null;
    renderControls();
    renderResults();
  });

  els.resultGroups.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      toggleFavorite(fav.dataset.fav);
      // 다시 그려진 같은 버튼으로 포커스를 돌려 키보드 사용자가 위치를 잃지 않게 한다.
      els.resultGroups.querySelector(`[data-fav="${CSS.escape(fav.dataset.fav)}"]`)?.focus();
      return;
    }
    const recent = e.target.closest('[data-recent]');
    if (recent) {
      setInputs(state.recent[Number(recent.dataset.recent)] ?? []);
      return;
    }
    if (e.target.closest('[data-clear-pins]')) {
      state.pinned.clear();
      renderInputs();
      renderResults();
      return;
    }
    const cardBtn = e.target.closest('[data-recipe]');
    if (cardBtn) return openDetail(cardBtn.dataset.recipe);
    if (e.target.closest('[data-show-more]')) {
      state.showMore = true;
      renderResults();
      els.resultGroups.querySelector('.group-more .card')?.focus();
      return;
    }
    if (e.target.closest('[data-reset-filters]')) {
      state.filters = { maxTime: null, difficulty: null, mealType: null };
      renderControls();
      renderResults();
      return;
    }
    const example = e.target.closest('[data-example]');
    if (example) {
      example.dataset.example.split(',').forEach((id) => addIngredient(dict.get(id)));
      update();
    }
  });

  els.detail.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeDetail();
    const fav = e.target.closest('[data-fav]');
    if (fav) return toggleFavorite(fav.dataset.fav);
    const timer = e.target.closest('.timer');
    if (timer) toggleTimer(timer);
  });
  els.detail.addEventListener('keydown', trapFocus);
  els.detailBackdrop.addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.openRecipeId) closeDetail();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.openRecipeId) requestWakeLock();
  });

  // 휴대폰에서 하단 고정 입력창 높이만큼 본문 아래 여백을 확보한다.
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--dock-h', `${Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight)}px`);
  }).observe(els.ingredientPanel);
}

// ---------- 시작 ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function renderAll() {
  renderSeasonings();
  renderInputs();
  renderViewTabs();
  renderControls();
  renderResults();
}

async function init() {
  let ingredients;
  try {
    [ingredients, recipes] = await Promise.all([fetchJson('data/ingredients.json'), fetchJson('data/recipes.json')]);
  } catch (err) {
    console.error(err);
    els.resultGroups.innerHTML = `<div class="empty"><h2>레시피 데이터를 불러오지 못했어요</h2>
      <p>파일을 직접 열었다면 로컬 서버로 실행해 주세요: <code>python -m http.server</code></p></div>`;
    return;
  }
  dict = createDictionary(ingredients);
  recipeById = new Map(recipes.map((r) => [r.id, r]));

  const saved = loadSeasonings();
  state.seasonings = new Set(saved ?? []);
  // 데이터가 바뀌어 사라진 레시피·재료는 저장 기록에서 걸러낸다.
  state.favorites = new Set(loadFavorites().filter((id) => recipeById.has(id)));
  state.recent = loadRecentInputs()
    .map((combo) => combo.filter((id) => dict.get(id)))
    .filter((combo) => combo.length);
  // 첫 방문(저장된 조미료 없음)이면 휴대폰에서도 조미료 패널을 펼쳐 먼저 설정하게 한다.
  setSeasoningPanelOpen(saved == null);

  bindEvents();
  renderAll();

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  }
}

init();
