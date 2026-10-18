// localStorage 래퍼. 사생활 보호 모드 등으로 저장소를 쓸 수 없어도 앱은 동작해야 한다.

const KEYS = {
  seasonings: 'mySeasonings',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패는 무시한다. 이번 방문 동안은 메모리 상태로 동작한다.
  }
}

// 저장된 적이 없으면 null (첫 방문 판별용)
export function loadSeasonings() {
  const value = read(KEYS.seasonings, null);
  return Array.isArray(value) ? value : null;
}

export function saveSeasonings(ids) {
  write(KEYS.seasonings, [...ids]);
}
