#!/usr/bin/env bash
# SessionStart hook — 한 사람 두 PC (Windows 본관 + macOS 별관) 환경 동기화 사고 차단.
#
# 동작:
#   1. 프로젝트 .git 있는지
#   2. 현재 브랜치의 원격 추적 브랜치 fetch
#   3. local vs remote 비교 → 4가지 케이스 분류:
#      - 동기:  조용히 통과
#      - 뒤짐:  자동 pull --rebase (단순 fast-forward 케이스)
#      - 앞섬:  안내만 (작업 후 push 권장)
#      - 분기:  ⚠ 경고 + pull --rebase 권장 (충돌 가능성 안내)
#
# 의도:
#   - 사장님이 *다른 PC 에서 push 한 변경* 을 *자동으로 가져옴*
#   - 분기 시 *작업 시작 전* 사장님이 인지하도록 — 작업 후 push 사고 차단
#   - 강제 차단 X — 사장님 결정 존중

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -d .git ] || exit 0

BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && exit 0

# 원격 추적 브랜치 있는지
UPSTREAM=$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null)
[ -z "$UPSTREAM" ] && exit 0

# fetch (출력 숨김)
if ! git fetch --quiet 2>/dev/null; then
  echo "[git 시작] ⚠ fetch 실패 — 원격 접근 불가 (오프라인?). 작업 가능하나 동기화 미확인"
  exit 0
fi

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse "$UPSTREAM" 2>/dev/null)
[ -z "$LOCAL" ] || [ -z "$REMOTE" ] && exit 0

if [ "$LOCAL" = "$REMOTE" ]; then
  # 동기 — 조용히
  exit 0
fi

BASE=$(git merge-base HEAD "$UPSTREAM" 2>/dev/null)

if [ "$LOCAL" = "$BASE" ]; then
  # local 이 뒤짐 — pull --rebase 가능 (fast-forward)
  AHEAD=$(git rev-list --count "HEAD..$UPSTREAM" 2>/dev/null)
  echo "[git 시작] ⬇ 원격이 ${AHEAD}개 앞섭니다. pull --rebase 자동 실행…"
  if git pull --rebase --quiet 2>&1 | grep -v "Successfully rebased"; then
    NEW_HEAD=$(git rev-parse --short HEAD)
    echo "[git 시작] ✅ pull 완료 — HEAD: $NEW_HEAD"
  else
    echo "[git 시작] ❌ pull --rebase 실패 — 수동 확인 필요"
  fi
elif [ "$REMOTE" = "$BASE" ]; then
  # local 이 앞섬 — 작업 후 push 권장
  AHEAD=$(git rev-list --count "$UPSTREAM..HEAD" 2>/dev/null)
  echo "[git 시작] ⬆ local 이 ${AHEAD}개 앞섭니다 — 작업 끝나면 push 권장"
else
  # 분기 — 충돌 가능성 안내
  LA=$(git rev-list --count "$BASE..HEAD" 2>/dev/null)
  RA=$(git rev-list --count "$BASE..$UPSTREAM" 2>/dev/null)
  echo "[git 시작] 🚨 분기 감지 — local ${LA}개 / remote ${RA}개 (공통 조상: ${BASE:0:7})"
  echo "[git 시작]    'git pull --rebase' 후 작업 권장. 작업 후 push 시 충돌 위험"
fi

exit 0
