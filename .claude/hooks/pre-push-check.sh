#!/usr/bin/env bash
# PreToolUse hook (Bash matcher) — git push 명령 직전 자동 fetch + non-fast-forward 검증.
#
# 동작:
#   1. tool_input.command 에 'git push' 포함 여부 확인 — 아니면 즉시 통과
#   2. 현재 브랜치 원격 추적 브랜치 fetch
#   3. 원격이 분기 / 앞서있으면 push 차단 + 사장님 안내 (exit 2)
#
# 의도:
#   - 사장님이 *옛 base 위에 작업* 한 후 push 하다 *force update 사고* 차단
#   - --force 또는 --force-with-lease 명시 시는 통과 (사장님 의도 force)

# Claude Code hook 은 stdin 으로 JSON 받음 — tool_input.command 추출.
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# command 에 'git push' 가 없으면 통과
echo "$COMMAND" | grep -qE '\bgit push\b' || exit 0

# --force / --force-with-lease 명시면 사장님 의도 force — 통과
echo "$COMMAND" | grep -qE -- '--force(-with-lease)?\b|--force\b|-f\b' && exit 0

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -d .git ] || exit 0

BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && exit 0

UPSTREAM=$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null)
[ -z "$UPSTREAM" ] && exit 0

# fetch (출력 숨김)
if ! git fetch --quiet 2>/dev/null; then
  # fetch 실패 — 오프라인일 수 있음. 차단 X (사장님이 push 의도면 시도)
  exit 0
fi

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse "$UPSTREAM" 2>/dev/null)
BASE=$(git merge-base HEAD "$UPSTREAM" 2>/dev/null)

# 정상 케이스: local 이 remote 와 같거나 앞섬 (fast-forward 가능)
if [ "$LOCAL" = "$REMOTE" ] || [ "$REMOTE" = "$BASE" ]; then
  exit 0
fi

# 분기 또는 뒤짐 — push 차단
LA=$(git rev-list --count "$BASE..HEAD" 2>/dev/null)
RA=$(git rev-list --count "$BASE..$UPSTREAM" 2>/dev/null)

cat >&2 <<EOF
🚨 push 차단 — 원격이 분기 상태 (어제 같은 force-update 사고 차단)

  공통 조상:  ${BASE:0:7}
  local 추가: ${LA}개 commit
  remote 추가: ${RA}개 commit (다른 PC 작업?)

해결 순서:
  1. git pull --rebase origin $BRANCH   ← 원격 변경 가져오기
  2. (필요 시 conflict 해결)
  3. git push                            ← 다시 시도

사장님이 *의도적으로 force* 면 --force-with-lease 명시.
EOF

exit 2
