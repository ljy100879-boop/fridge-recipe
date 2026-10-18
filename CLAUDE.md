# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어

사용자에게 하는 모든 설명은 한국어로 작성한다.

## 명령어

빌드 도구·패키지 매니저 없음 (이 PC에는 Node.js가 없고 Python만 있다). 순수 ES 모듈이라 `file://`로는 열리지 않으므로 반드시 로컬 서버로 연다.

- 실행: `python -m http.server 8000` → http://localhost:8000
- 테스트: 서버를 띄운 상태에서 http://localhost:8000/tests/ 를 브라우저로 연다 (`tests/tests.js`, 결과는 `body[data-result]`에 pass/fail로도 남는다)
- 헤드리스로 테스트: `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --virtual-time-budget=5000 --dump-dom http://127.0.0.1:8000/tests/`
- 데이터 검증: `python scripts/validate_data.py` — 재료 id 참조, 동의어 중복, 레시피 100개 이상·"15분 이하·쉬움" 70% 이상을 검사한다. `data/*.json`을 고치면 항상 실행할 것.

## 배포

GitHub Pages (공개 저장소 `ljy100879-boop/fridge-recipe`, `main` 브랜치 루트). `main`에 푸시하면 1~2분 뒤 https://ljy100879-boop.github.io/fridge-recipe/ 에 반영된다. PRD 문서는 `.gitignore`로 제외되어 있으니 올리지 말 것. 서비스 워커가 네트워크 우선이라 배포 후 캐시 버전을 올리지 않아도 최신 파일이 내려간다.

## 코드 구조

기준 문서는 `냉장고 레시피 추천 사이트 PRD.md`.

- `js/matcher.js` — 매칭·정렬 순수 함수 (DOM 의존 없음, 테스트 대상)
- `js/dictionary.js` — 동의어 해석(`resolve`)과 자동완성(`search`). 한 글자 동의어(파·무·김 등)는 부분 일치에 쓰지 않는다
- `js/app.js` — 상태(`state`)와 렌더링·이벤트 전부. 상태 변경 후 해당 `render*()`를 다시 호출하는 단순 구조 (프레임워크 없음)
- `js/storage.js` — localStorage 래퍼 (실패해도 앱이 동작해야 함)
- `sw.js` — 네트워크 우선 서비스 워커. 앱 파일을 추가·이름 변경하면 `APP_SHELL` 목록과 `CACHE` 버전도 갱신
- 사전에 없는 재료/조미료는 `custom:이름` id로 저장되며 매칭에는 쓰이지 않는다
- 레시피에는 PRD 스키마 외에 사진 대신 쓰는 `emoji` 필드가 있다 (`image`가 비어 있으면 emoji 표시). `optional`·`timer_sec`는 생략하면 false/없음

## 프로젝트 개요

"냉장고 레시피": 사용자가 가진 재료 + 보유 조미료만으로 만들 수 있는 쉽고 빠른 레시피를 먼저 보여주는 반응형 단일 페이지 웹사이트.

- **서버 없음.** 정적 사이트(HTML/CSS/JS 또는 React), 데이터는 정적 JSON, 사용자 상태는 localStorage. 배포는 GitHub Pages 또는 Netlify.
- 매칭·정렬은 전부 브라우저에서 수행하며, 재료 입력 후 결과 표시까지 0.5초 이내여야 한다. 재료 추가/삭제 시 페이지 이동 없이 즉시 재정렬한다.

## 데이터 모델

- `ingredients.json`: `id`, `name`, `aliases`(동의어 — 자동완성·매칭에 사용), `type`(`ingredient` / `seasoning`), `category`(조미료 칩 묶음: 기본/한식/양식), `substitutes`(대체 재료 id).
- `recipes.json`: `id`, `title`, `image`, `time_min`, `difficulty`(`easy`/`normal`/`hard`), `meal_type`(`rice`/`noodle`/`side`/`snack`), `ingredients[{id, amount, optional}]`, `steps[{text, timer_sec}]`.
- localStorage 키: `mySeasonings`(조미료 id 배열), `recentInputs`(최근 재료 조합 최대 5개), `favorites`(레시피 id 배열).

## 핵심 로직: 매칭과 정렬 (가장 중요)

정렬은 엄격한 사전식 순서다. **1차 키가 다르면 2차 키는 보지 않는다.**

1. **매칭** — 레시피 재료별로: 보유 조미료에 있음 / 입력 재료에 있음(동의어 포함) / `optional: true` → 충족. 그 외 → 부족 재료. 조미료는 재료와 분리해 판정한다.
2. **1차 키: 부족 재료 수 (오름차순).** 결과는 3그룹: 0개 "지금 바로 가능", 1개 "1개만 더 있으면"(부족 재료명 표시), 2개 이상(기본 접힘).
3. **2차 키: 간편 점수 (내림차순).** `0.5×S시간 + 0.3×S난이도 + 0.2×S단계`
   - S시간: ≤10분 100 / ≤20분 50 / 30분 초과 0 (21~30분은 PRD에 없어 중간값 25로 구현)
   - S난이도: 쉬움 100 / 보통 50 / 어려움 0
   - S단계: ≤4단계 100 / 5~7단계 50 / ≥8단계 0
   - 가중치는 초기값이며 이후 조정될 수 있으므로 상수로 분리해 둘 것.
4. **동점:** 입력 재료를 더 많이 사용하는 레시피가 먼저.
5. **예외:** "꼭 써야 하는 재료" 핀(F5)이 켜져 있으면 그 재료를 쓰지 않는 레시피는 제외.

결과가 0개일 때 빈 화면을 보여주지 않고 "1개만 더 있으면" 그룹으로 넘어간다. 입력 재료를 하나도 쓰지 않는 레시피는 결과에서 뺀다.

## 기능 요구사항 요약

- **F1 조미료 선택**: 재료 입력창 위에 카테고리별 칩 토글, "기본 조미료 전체 선택"(소금·설탕·후추·간장·식용유), 직접 추가, localStorage 저장.
- **F2 재료 입력**: 자동완성, 엔터/쉼표로 칩 추가, 동의어 통합(달걀=계란 등), 조미료를 입력하면 조미료 영역으로 자동 이동, 자주 쓰는 재료 빠른 추가 칩.
- **F3 결과**: 카드(요리명·사진·시간·난이도·단계 수·사용/부족 재료), 필터(시간·난이도·식사 유형), 정렬(추천순 기본, 빠른 순, 쉬운 순).
- **F4 상세**: 보유 재료 체크/부족 재료 강조, 단계별 타이머, 부족 재료의 대체 재료 표시, 조리 화면에서 Wake Lock.
- **F5 (MVP 이후)**: 즐겨찾기, 최근 재료 조합, 필수 재료 핀.

## UI·비기능 제약

- 모바일 우선 반응형: ≤767px 1단(조미료 접이식, 재료 입력창 하단 고정, 카드 1열) / 768~1023px 카드 2열 / ≥1024px 좌측 사이드바 + 카드 3열 + 상세는 우측 패널.
- 최소 너비 360px, 터치 영역 44px 이상, PWA(홈 화면에 추가) 지원.
- 접근성: 난이도·부족 재료를 색만으로 구분하지 말고 텍스트 라벨을 함께 쓴다.
- 키보드: 엔터로 재료 추가, Tab으로 칩 이동.
- 지원 브라우저: 크롬, iOS 사파리, 삼성 인터넷, 엣지 최신 2개 버전.
- 콘텐츠: MVP 레시피 최소 100개, 70% 이상 "15분 이하·쉬움". 타 사이트 레시피·사진 복제 금지(직접 작성 또는 공공데이터).
