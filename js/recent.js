// 최근 입력한 재료 조합(F5) 기록 규칙.
// 재료를 하나씩 추가하는 과정이 모두 따로 쌓이지 않도록,
// 직전 조합에 재료를 더한 것이면 직전 기록을 교체하고, 직전 조합에서 재료를 지우는 중이면 기록하지 않는다.

export const MAX_RECENT = 5;

function sameSet(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function mergeRecent(recent, combo, max = MAX_RECENT) {
  if (!combo.length) return recent;
  const [latest, ...rest] = recent;
  let base = recent;
  if (latest) {
    if (latest.every((id) => combo.includes(id))) base = rest; // 같거나 더 큰 조합 → 교체
    else if (combo.every((id) => latest.includes(id))) return recent; // 지우는 중 → 기록 안 함
  }
  return [combo, ...base.filter((c) => !sameSet(c, combo))].slice(0, max);
}
