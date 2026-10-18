"""레시피·재료 데이터 검증 스크립트.

사용법: python scripts/validate_data.py
문제가 있으면 목록을 출력하고 종료 코드 1로 끝난다.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIFFICULTIES = {"easy", "normal", "hard"}
MEAL_TYPES = {"rice", "noodle", "side", "snack"}
SEASONING_CATEGORIES = {"기본", "한식", "양식·기타"}
MIN_RECIPES = 100
MIN_QUICK_EASY_RATIO = 0.7


def norm(text):
    return "".join(text.split()).lower()


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔에서 한글 깨짐 방지
    ingredients = json.loads((ROOT / "data/ingredients.json").read_text(encoding="utf-8"))
    recipes = json.loads((ROOT / "data/recipes.json").read_text(encoding="utf-8"))
    errors = []

    ids = {}
    alias_owner = {}
    for ing in ingredients:
        if ing["id"] in ids:
            errors.append(f"재료 id 중복: {ing['id']}")
        ids[ing["id"]] = ing
        if ing["type"] not in ("ingredient", "seasoning"):
            errors.append(f"{ing['id']}: type 값 오류 {ing['type']}")
        if ing["type"] == "seasoning" and ing.get("category") not in SEASONING_CATEGORIES:
            errors.append(f"{ing['id']}: 조미료 category 값 오류 {ing.get('category')}")
        for alias in [ing["name"], *ing["aliases"]]:
            key = norm(alias)
            if key in alias_owner and alias_owner[key] != ing["id"]:
                errors.append(f"동의어 '{alias}'가 {alias_owner[key]}와 {ing['id']}에 중복")
            alias_owner[key] = ing["id"]

    for ing in ingredients:
        for sub in ing["substitutes"]:
            if sub not in ids:
                errors.append(f"{ing['id']}: 없는 대체 재료 {sub}")

    recipe_ids = set()
    for r in recipes:
        rid = r["id"]
        if rid in recipe_ids:
            errors.append(f"레시피 id 중복: {rid}")
        recipe_ids.add(rid)
        if r["difficulty"] not in DIFFICULTIES:
            errors.append(f"{rid}: difficulty 값 오류")
        if r["meal_type"] not in MEAL_TYPES:
            errors.append(f"{rid}: meal_type 값 오류")
        if not isinstance(r["time_min"], (int, float)) or r["time_min"] <= 0:
            errors.append(f"{rid}: time_min 값 오류")
        if not r["steps"]:
            errors.append(f"{rid}: 조리 단계 없음")
        seen = set()
        required_main = 0
        for item in r["ingredients"]:
            if item["id"] not in ids:
                errors.append(f"{rid}: 사전에 없는 재료 {item['id']}")
                continue
            if item["id"] in seen:
                errors.append(f"{rid}: 재료 중복 {item['id']}")
            seen.add(item["id"])
            if ids[item["id"]]["type"] == "ingredient" and not item.get("optional"):
                required_main += 1
        if required_main == 0:
            errors.append(f"{rid}: 필수 일반 재료가 하나도 없음")

    quick_easy = sum(1 for r in recipes if r["time_min"] <= 15 and r["difficulty"] == "easy")
    ratio = quick_easy / len(recipes) if recipes else 0
    if len(recipes) < MIN_RECIPES:
        errors.append(f"레시피 수 부족: {len(recipes)} < {MIN_RECIPES}")
    if ratio < MIN_QUICK_EASY_RATIO:
        errors.append(f"15분 이하·쉬움 비율 부족: {ratio:.0%}")

    print(f"재료 {len(ingredients)}개, 레시피 {len(recipes)}개, 15분 이하·쉬움 {quick_easy}개 ({ratio:.0%})")
    if errors:
        print(f"\n오류 {len(errors)}건:")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("검증 통과")


if __name__ == "__main__":
    main()
