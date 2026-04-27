#!/usr/bin/env bash
# Stop hook — Claude 응답 마무리 시점에 깃 상태 한 줄 경고.
# 미커밋 / 미푸시 / 별관(워크트리) 미머지 가 있으면 알림.
# 사용자가 의도해서 둔 경우 무시 가능 — 강제 차단 X.

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -d .git ] || exit 0

UNCOMMITTED=$(git status --porcelain 2>/dev/null | grep -c .)
UPSTREAM=$(git rev-parse --abbrev-ref @{u} 2>/dev/null)
UNPUSHED=0
if [ -n "$UPSTREAM" ]; then
  UNPUSHED=$(git log "${UPSTREAM}..HEAD" --oneline 2>/dev/null | grep -c .)
fi
EXTRA_WT=$(($(git worktree list 2>/dev/null | grep -c .) - 1))

WARN=""
[ "$UNCOMMITTED" -gt 0 ] && WARN="$WARN 미커밋 $UNCOMMITTED개 /"
[ "$UNPUSHED" -gt 0 ] && WARN="$WARN 미푸시 $UNPUSHED개 /"
[ "$EXTRA_WT" -gt 0 ] && WARN="$WARN 별관 $EXTRA_WT개 (머지 확인) /"

if [ -n "$WARN" ]; then
  echo "[git 상태] ⚠${WARN%/}"
fi
exit 0
