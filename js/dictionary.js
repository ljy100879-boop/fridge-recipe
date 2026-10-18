// 재료 사전: 동의어 해석(입력 텍스트 → 재료)과 자동완성 검색을 담당한다.

export function normalize(text) {
  return String(text).replace(/\s+/g, '').toLowerCase();
}

// 부분 일치("돼지고기 앞다리" → 돼지고기)에 쓸 최소 길이.
// 한 글자 동의어(파, 무, 김, 떡, 밥, 깨)는 "양파", "무화과"처럼 오탐이 많아 정확히 일치할 때만 쓴다.
const MIN_CONTAINED_ALIAS_LENGTH = 2;

export function createDictionary(ingredients) {
  const byId = new Map();
  const aliasIndex = new Map(); // 정규화된 이름/동의어 → 재료 id
  const searchEntries = [];

  for (const ing of ingredients) {
    byId.set(ing.id, ing);
    for (const word of [ing.name, ...ing.aliases]) {
      const key = normalize(word);
      if (!aliasIndex.has(key)) aliasIndex.set(key, ing.id);
      searchEntries.push({ key, word, id: ing.id });
    }
  }

  // 긴 동의어부터 검사해야 "다진 돼지고기"가 "돼지"보다 먼저 잡힌다.
  const containableAliases = [...aliasIndex.keys()]
    .filter((key) => key.length >= MIN_CONTAINED_ALIAS_LENGTH)
    .sort((a, b) => b.length - a.length);

  function resolve(text) {
    const key = normalize(text);
    if (!key) return null;
    const exact = aliasIndex.get(key);
    if (exact) return byId.get(exact);
    const contained = containableAliases.find((alias) => key.includes(alias));
    return contained ? byId.get(aliasIndex.get(contained)) : null;
  }

  // 정확히 일치 > 앞부분 일치 > 중간 일치 순으로, 재료당 한 번만 돌려준다.
  function search(query, { limit = 8, exclude = new Set() } = {}) {
    const key = normalize(query);
    if (!key) return [];
    const best = new Map();
    for (const entry of searchEntries) {
      if (exclude.has(entry.id)) continue;
      const pos = entry.key.indexOf(key);
      if (pos === -1) continue;
      const rank = entry.key === key ? 0 : pos === 0 ? 1 : 2;
      const prev = best.get(entry.id);
      if (!prev || rank < prev.rank) {
        best.set(entry.id, { ingredient: byId.get(entry.id), matched: entry.word, rank });
      }
    }
    return [...best.values()]
      .sort((a, b) => a.rank - b.rank || a.ingredient.name.length - b.ingredient.name.length)
      .slice(0, limit);
  }

  return {
    get: (id) => byId.get(id),
    resolve,
    search,
    seasonings: ingredients.filter((ing) => ing.type === 'seasoning'),
  };
}
