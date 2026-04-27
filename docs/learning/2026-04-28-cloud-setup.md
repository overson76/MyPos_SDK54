# 2026-04-28 — 클라우드 백업·배포 셋업

> **세션 한 줄 요약**: 100% 로컬 git 리포만 있던 프로젝트를 깃허브(코드 백업)와 클라우드플레어 워커즈(라이브 URL)로 갈아탔다. 부수로 예약/포장/배달 슬롯의 컴팩트 버그도 한 줄 수정.

---

## 🕐 시간순 흐름

| 단계 | 한 줄 설명 |
|---|---|
| 1 | 본관/별관(워크트리) 상태 확인 — 본관 깔끔, 별관 0개 |
| 2 | 미리보기에서 발견한 버그 분석 — 배달 슬롯 첫 칸이 비어있고 뒷 슬롯이 안 당겨짐 |
| 3 | 코드 추적 — `clearTable` 에 `compactSlots` 디스패치 누락 발견 |
| 4 | 한 줄(+ 주석) 수정해서 컴팩트 호출 추가 |
| 5 | 미리보기 빌드 / 콘솔 에러 없음 + 컴팩트 로직 시뮬레이션으로 동작 확인 |
| 6 | 깃허브 vs NAS 차이 학습 (편집 수락 묻는 이유, 동기화 모델 차이) |
| 7 | 프로젝트 용량 점검 — 추적 파일은 1.35 MB (node_modules 506 MB 는 .gitignore) |
| 8 | 깃허브로 갈아타기 결정 — 비공개, main 브랜치, 이름 그대로 |
| 9 | `git remote add origin` + `git push -u origin main` 으로 첫 푸시 성공 |
| 10 | 클라우드플레어 셋업 시도 — Pages 가 Workers 로 통합돼 새 UI 적응 |
| 11 | `wrangler.jsonc` 추가해서 정적 자산 호스팅 셋업 |
| 12 | 자동 빌드가 17분 큐 대기로 막힘 — 차선책으로 로컬 직접 배포로 전환 |
| 13 | `npx wrangler login` (브라우저 OAuth) → `npx wrangler deploy` 13초만에 라이브 |
| 14 | 라이브 URL `mypos-sdk54.overson76.workers.dev` 정상 동작 확인 |
| 15 | 깃 태그 `cloud-setup-v1` 찍어서 시점 표시 |

---

## 📚 새로 배운 개념

### 1) Git 의 3단계 모델

데스크톱 개발의 "파일 저장" 과 다르게, 깃은 **세 단계**로 분리되어있다.

```
[로컬 작업 디렉터리]
       ↓ git add <파일>          ← 1) 스테이징(staging)
[스테이징 영역 (보낼 후보)]
       ↓ git commit -m "메시지"   ← 2) 커밋(commit, 로컬 저장)
[로컬 .git 이력]
       ↓ git push                ← 3) 푸시(push, 원격 업로드)
[깃허브 등 원격 저장소]
```

| 단계 | 비유 (AutoCAD) |
|---|---|
| add | "이 파일들 백업할게" 체크하기 |
| commit | "다른 이름으로 저장 — 메모 적기" |
| push | "회사 NAS 로 복사" |

→ **commit 만 하면 로컬에만 머문다. push 까지 해야 깃허브 도달.**

### 2) 깃허브 vs NAS — 본질적 모델 차이

| | 시놀로지 NAS | 깃허브 |
|---|---|---|
| 동기화 모델 | "저장하면 즉시" (passive) | "내가 보낼 때만" (active) |
| 변경 이력 | 없음 (덮어쓰기) | 영구 보존 |
| 충돌 처리 | 마지막 저장이 이김 | 머지(merge)로 안전하게 합침 |
| 보안 다이얼로그 | OS 가 끼어듦, 매번 묻기 가능 | 첫 인증 한 번만 |

깃허브의 "내가 보낼 때만" 정책은 **단점이 아니라 안전장치**. 미완성 코드가 자동으로 클라우드에 반영되지 않는다.

### 3) Cloudflare 의 새 통합 UI

2024 후반부터 Workers + Pages 가 통합됨. 옛날엔 정적 사이트는 Pages, 서버리스 함수는 Workers 였지만, 지금은 **Workers 의 Static Assets 기능으로 정적 사이트도 호스팅**.

- 필요한 설정 파일: `wrangler.jsonc` (또는 `wrangler.toml`)
- 핵심 항목:
  - `name`: URL 의 일부가 됨 (`<name>.<subdomain>.workers.dev`)
  - `assets.directory`: 정적 파일 폴더 (우리는 `./dist`)
  - `assets.not_found_handling: "single-page-application"`: SPA 라우팅 (새로고침 / 딥링크 시 404 안 뜸)

### 4) Metro 캐시

리액트 네이티브의 번들러(bundler) Metro 가 564 개 자바스크립트 파일을 한 파일로 묶을 때:

- **변환 단계**: JSX/최신 JS → 호환 가능한 코드
- **번들 단계**: 모든 변환 결과를 하나로 합침

각 단계 결과를 `%TEMP%/metro-cache` 같은 곳에 저장 → **다음 빌드 시 안 바뀐 모듈은 재변환 X**.

이번 빌드가 3.5초만에 끝난 이유: 미리보기 서버가 계속 돌면서 캐시 채워둔 상태였기 때문. 첫 빌드는 보통 1~3분.

### 5) 깃 태그 (tag)

특정 시점에 의미있는 라벨을 붙이는 기능.

```
git tag -a cloud-setup-v1 -m "클라우드 셋업 완료"   # 로컬 태그 생성
git push origin cloud-setup-v1                      # 깃허브에도 푸시
```

활용:
- `git checkout cloud-setup-v1` — 그 시점 코드로 잠시 돌아가기
- `git log cloud-setup-v1..HEAD` — 그 시점 이후 변경만 보기
- 깃허브 페이지에서 자동으로 release 항목 생성

비유: **AutoCAD 의 의미있는 백업 파일명** (`도면_납품완료_2026-04-28.dwg`).

---

## 🛠 사용한 명령어 모음

### 깃 관련
```bash
# 상태 확인
git status                      # 변경 파일 목록
git remote -v                   # 원격 저장소 연결 확인
git log --oneline -5            # 최근 커밋 5개

# 스테이징·커밋·푸시
git add <파일>                  # 특정 파일만 스테이징 (git add . 는 위험)
git commit -m "메시지"          # 로컬 커밋
git push                        # 원격으로 보내기

# 브랜치 관리
git branch -m master main       # master → main 이름 변경
git branch --show-current       # 현재 브랜치

# 원격 저장소 연결
git remote add origin <URL>     # 원격 등록
git push -u origin main         # 첫 푸시 (-u = upstream 추적 설정)

# 빈 커밋으로 빌드 재트리거
git commit --allow-empty -m "..."
git push

# 태그
git tag -a <이름> -m "메시지"    # annotated tag 생성
git push origin <태그이름>       # 태그 푸시
```

### Expo·Cloudflare 관련
```bash
# 웹 빌드 (dist/ 생성)
npx expo export --platform web

# Cloudflare 인증 (브라우저 OAuth, 첫 1회)
npx wrangler login
npx wrangler whoami             # 인증 상태 확인

# 직접 배포
npx wrangler deploy             # wrangler.jsonc 의 설정대로 배포
```

### 일상 흐름 (앞으로 쓸 것)
```bash
# 코드 수정 후 깃허브 백업
git add <파일>; git commit -m "..."; git push

# 라이브 URL 즉시 갱신
npx expo export --platform web; npx wrangler deploy
```

---

## 🐛 발견한 버그 + 해결

### 증상
배달/포장 슬롯에서 **테이블 비우기 후 빈자리가 그대로 남고 뒷 슬롯이 앞으로 당겨지지 않음**. 사용자는 "예약은 되는 것 같다" 고 느꼈지만 사실은 우연히 빈자리가 끝(y2)에 있어서 그랬을 뿐, 동일한 버그.

### 원인
`utils/OrderContext.js` 의 `clearTable` 함수에서 **`compactSlots` 디스패치(dispatch, 액션 발송) 호출이 빠져있었음**.

`compactSlots` 가 호출되는 다른 경로는 모두 정상이었음:
- 자리이동(`moveOrder`)
- 포장 결제완료(`markPaid` prefix='p')
- 배달 자동정리(`useAutoClearDelivery` 5분 후)

→ 사용자 수동 "테이블 비우기" 만 누락됨.

### 수정 (1줄 + 주석)
```js
// utils/OrderContext.js — clearTable 끝부분
dispatch({ type: 'orders/removeTable', tableId: targetId });
maybeUnsplitAfter(targetId, nextOrders);
// ▼ 추가
const prefix = detectDynamicSlotPrefix(targetId);
if (prefix) {
  dispatch({ type: 'orders/compactSlots', prefix });
}
```

### 검증
- 빌드 / 콘솔 에러 없음
- 컴팩트 로직 시뮬레이션: `[d1, d3, d4, d5, d6]` → 비우기 → 컴팩트 → `[d1, d2, d3, d4]` ✅

---

## 🔑 환경 정보 (다음에 다시 찾을 때)

| 항목 | 값 |
|---|---|
| 깃허브 리포 | https://github.com/overson76/MyPos_SDK54 (Private) |
| 라이브 URL | https://mypos-sdk54.overson76.workers.dev |
| 기본 브랜치 | `main` |
| Cloudflare 계정 | overson76@naver.com (subdomain: overson76.workers.dev) |
| 워커 이름 | `mypos-sdk54` (`wrangler.jsonc` 의 `name`) |
| 첫 마일스톤 태그 | `cloud-setup-v1` (커밋 `c1fcddb`) |

---

## 🧠 자기 점검 (다음 번에도 떠올릴 것)

1. **add → commit → push** 가 한 흐름. 셋 다 해야 깃허브 도달.
2. 라이브 URL 갱신은 깃 푸시만으로는 부족 — 클라우드플레어 빌드까지 끝나야. 자동 빌드 큐가 막히면 **`npx wrangler deploy`** 로 우회.
3. `wrangler.jsonc` 의 `name` 이 URL 의 일부 (`<name>.overson76.workers.dev`).
4. 의미있는 시점은 **깃 태그**로 라벨 — AutoCAD 의 `_납품완료.dwg` 와 같은 개념.
5. 미커밋 변경이 있으면 푸시해도 안 올라감 — `git status` 로 항상 확인.

---

## 🚀 다음에 해볼 만한 것 (후보)

| 후보 | 한 줄 설명 |
|---|---|
| `firestore.rules` 검토 | 매장 코드 + member 권한 모델이 제대로 막히는지 확인 |
| 두 기기 실시간 동기화 테스트 | 폰 A 주문 → 폰 B 즉시 반영 확인 / 트랜잭션 충돌 동작 |
| EAS 운영 빌드 | 사장님 폰에 실제 설치 가능한 APK/IPA (SENTRY_AUTH_TOKEN EAS Secret 등록 포함) |
| Cloudflare 자동 배포 큐 안정화 | 큐 막힘 자주 발생 시 GitHub Actions 로 빌드 + Cloudflare API 직접 배포로 우회 |

각 후보가 끝나면 `cloud-sync-v1`, `prod-build-v1` 같은 다음 태그를 찍어두면 시점 추적 가능.

---

_세션 시작 시각·종료 시각은 메모하지 않음. Claude Code 세션 원본을 자동 보관 중이므로 자세한 대화는 세션 검색으로._
