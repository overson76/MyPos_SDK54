#!/usr/bin/env bash
# 매장용 PC 웹 배포 한 줄 스크립트.
# 실행: npm run deploy:web
#
# 절차:
#   1. 옛 빌드 산출물 + Metro 캐시 클리어
#   2. expo export --platform web (production 빌드)
#   3. Firebase API 키가 빌드에 inline 됐는지 grep 검증 (← 함정 2 방지)
#   4. wrangler deploy → Cloudflare Workers 라이브 URL 갱신
#
# Why grep 검증: babel-preset-expo 의 EXPO_PUBLIC inline transformer 가 직접
# 참조 패턴만 인식. 옛 우회 패턴 잔재 / .env 누락 / 캐시 잔재 시 dev 는 OK 인데
# production 빌드만 키 누락 → 라이브 URL 의 Firebase init 실패. 배포 전에 1초 만에
# 잡아낸다.

set -euo pipefail

# 프로젝트 루트로 이동 (스크립트 위치 기준)
cd "$(dirname "$0")/.."

YEL="\033[33m"; GRN="\033[32m"; RED="\033[31m"; CLR="\033[0m"
note()  { echo -e "${YEL}▶ $*${CLR}"; }
ok()    { echo -e "${GRN}✓ $*${CLR}"; }
fail()  { echo -e "${RED}✗ $*${CLR}" >&2; exit 1; }

# .env 존재 확인 (없으면 즉시 abort — 이게 함정 2 의 가장 흔한 원인)
if [ ! -f ".env" ]; then
  fail ".env 파일이 없습니다. EXPO_PUBLIC_FIREBASE_* 키를 채운 .env 를 프로젝트 루트에 두세요. (.env.example 참고)"
fi

if ! grep -q "EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSy" .env 2>/dev/null; then
  fail ".env 의 EXPO_PUBLIC_FIREBASE_API_KEY 가 비어있거나 형식이 이상합니다."
fi

note "1/4 dist/ + Metro 캐시 클리어"
rm -rf dist node_modules/.cache
ok "클리어 완료"

note "2/4 expo export --platform web"
npx expo export --platform web

JS_DIR="dist/_expo/static/js/web"
if [ ! -d "$JS_DIR" ]; then
  fail "빌드 산출물 폴더 없음: $JS_DIR"
fi

note "3/4 빌드 산출물 검증 — Firebase API 키 inline 여부"
MATCHED=$(grep -l "AIzaSy" "$JS_DIR"/*.js 2>/dev/null | wc -l | tr -d ' ')
if [ "${MATCHED:-0}" -eq 0 ]; then
  echo ""
  fail "Firebase API 키가 빌드 산출물에 inline 안 됨. 가능한 원인:
  - .env 누락 또는 키 비어있음
  - utils/firebase.web.js 에 process.env 우회 패턴 (const env = process.env) 잔재
  - Metro 캐시가 옛 빌드 보존 (이번 클리어 후에도 발생 시 보고)
  배포 중단."
fi
ok "API 키 inline 확인 (${MATCHED} 개 JS 청크에서 매칭)"

note "4/4 wrangler deploy → Cloudflare 라이브 URL 갱신"
npx wrangler deploy

echo ""
ok "배포 완료. 라이브 URL 에서 Ctrl+F5 (또는 시크릿 창) 으로 새 빌드 확인하세요."
echo "  - 카운터 PC 에서 매장 코드 입력 흐름 한 번 점검 (가입은 1회만 필요했었음)"
echo "  - F12 콘솔에 'Firebase web init OK' 류 로그 또는 에러 없는지 확인"
